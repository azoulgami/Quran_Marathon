import { dirname } from "path";
import { fileURLToPath } from "url";
import express from "express"
import bodyParser from "body-parser";
import fs from "fs";
import pg from "pg";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import session from "express-session";
import bcrypt from "bcryptjs";
import pool from "./db.js";
import { getAllClasses, getClassById, createUser, getUserByEmail, getUserById, getStudentsByClass, updateUserPages, getClassesWithCounts, getAllStudents, initializeDatabase, getHomeworkByClass, createHomework, updateHomework, deleteHomework, changeUserClass } from "./database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;


app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.set("view engine", "ejs");

// Session middleware
app.use(session({
    secret: process.env.SESSION_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Mock users database (replace with real DB later)
const users = [];

// Passport LocalStrategy
passport.use(new LocalStrategy({
    usernameField: 'email',
    passwordField: 'password'
}, async (email, password, done) => {
    try {
        const user = await getUserByEmail(email);
        if (!user) {
            return done(null, false, { message: 'Email not found' });
        }
        if (!bcrypt.compareSync(password, user.password)) {
            return done(null, false, { message: 'Incorrect password' });
        }
        return done(null, user);
    } catch (err) {
        return done(err);
    }
}));

// Serialize user for sessions
passport.serializeUser((user, done) => {
    done(null, user.id);
});

// Deserialize user from sessions
passport.deserializeUser(async (id, done) => {
    try {
        const user = await getUserById(id);
        if (user) {
            // Transform snake_case to camelCase for templates
            user.fullName = user.full_name;
            user.classId = user.class_id;
            user.pagesRead = user.pages_read;
            user.createdAt = user.created_at;
            // user.role is already in camelCase
        }
        done(null, user);
    } catch (err) {
        done(err);
    }
});

// Middleware to check if authenticated
const ensureAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
};







// Mock data
const classes = [{ id: 1, name: "Saida" }, { id: 2, name: "Nabila" }, { id: 3, name: "Aziza" }, { id: 4, name: "Faiza" }, { id: 5, name: "Shahd" }, { id: 6, name: "Soussen" }, { id: 7, name: "Amira" }];
const mockStudents = [
    { id: 1, classId: 1, name: "Ahmed", pagesRead: 450 },
    { id: 2, classId: 1, name: "Fatima", pagesRead: 520 },
    { id: 3, classId: 1, name: "Muhammad", pagesRead: 380 },
    { id: 4, classId: 1, name: "Aisha", pagesRead: 600 },
    { id: 5, classId: 2, name: "Hassan", pagesRead: 200 },
    { id: 6, classId: 2, name: "Mariam", pagesRead: 290 },
    { id: 7, classId: 2, name: "Omar", pagesRead: 150 },
];

// ===== AUTH ROUTES =====

// Login page
app.get("/login", (req, res) => {
    res.render("login.ejs", { message: req.query.message || null });
});

// Register page
app.get("/register", (req, res) => {
    res.render("register.ejs", { message: req.query.message || null });
});

// Register new user
app.post("/register", async (req, res) => {
    const { email, fullName, classId, password, confirmPassword, role } = req.body;

    // Validation
    if (password !== confirmPassword) {
        return res.render("register.ejs", { message: "Passwords don't match!" });
    }

    try {
        const existingUser = await getUserByEmail(email);
        if (existingUser) {
            return res.render("register.ejs", { message: "Email already registered!" });
        }

        // Hash password and create user with role
        const hashedPassword = bcrypt.hashSync(password, 10);
        
        // Debug logging
        console.log('Registration attempt:', { email, fullName, classId, role });
        
        if (!classId) {
            console.error('ClassId is missing or empty');
            return res.render("register.ejs", { message: "Please select a class!" });
        }
        
        const newUser = await createUser(email, fullName, parseInt(classId), hashedPassword, role || 'student');
        
        console.log(`New user registered: ${email} as ${role || 'student'}`);

        // Auto-login after registration
        req.login({ 
            id: newUser.id, 
            email: newUser.email, 
            fullName: newUser.full_name,
            classId: newUser.class_id,
            role: newUser.role
        }, (err) => {
            if (err) return res.render("register.ejs", { message: "Registration error!" });
            res.redirect("/");
        });
    } catch (err) {
        console.error('Registration error:', err.message);
        console.error('Full error:', err);
        res.render("register.ejs", { message: "An error occurred: " + err.message });
    }
});

// Login user
app.post("/login", passport.authenticate('local', {
    successRedirect: "/",
    failureRedirect: "/login?message=Invalid+email+or+password"
}));

// Logout user
app.get("/logout", (req, res) => {
    req.logout((err) => {
        if (err) return res.send("Logout error");
        res.redirect("/");
    });
});

// ===== PROTECTED ROUTES =====

// MAIN PAGE - Show all classes (PUBLIC)
app.get("/", async (req, res) => {
    try {
        const classesData = await getClassesWithCounts();
        // Transform snake_case to camelCase
        const classes = classesData.map(cls => ({
            id: cls.id,
            name: cls.name,
            studentCount: cls.student_count,
            totalPages: cls.total_pages
        }));
        const globalLeaderboard = await getAllStudents();
        res.render("index.ejs", { classes, globalLeaderboard, user: req.user });
    } catch (err) {
        console.error('Error fetching classes:', err);
        res.render("index.ejs", { classes: [], globalLeaderboard: [], user: req.user });
    }
});

// CLASS DETAIL PAGE - Show class rankings & students (PUBLIC)
app.get("/class/:id", async (req, res) => {
    try {
        const classId = parseInt(req.params.id);
        const classData = await getClassById(classId);
        const className = classData ? classData.name : "Class Not Found";
        
        // Get students for this class, already sorted by pages read (descending)
        const students = await getStudentsByClass(classId);
        
        // Get homework for this class
        const homework = await getHomeworkByClass(classId);
        
        res.render("class.ejs", { classId, className, students, homework, user: req.user });
    } catch (err) {
        console.error('Error fetching class:', err);
        res.render("class.ejs", { classId: 0, className: "Error", students: [], homework: null, user: req.user });
    }
});

// API - Add/Update student entry
app.post("/api/entries", ensureAuthenticated, async (req, res) => {
    try {
        const { pages, surah } = req.body;
        const userId = req.user.id;
        
        // Update pages for logged-in user
        const result = await updateUserPages(userId, parseInt(pages));
        console.log(`Updated entry for user ${userId}: ${pages} pages (${surah})`);
        res.json({ success: true, message: "Pages added", pagesRead: result.pages_read });
    } catch (err) {
        console.error('Error updating entry:', err);
        res.json({ success: false, message: "Error saving entry" });
    }
});

// API - Create/Update homework (Teacher only)
app.post("/api/homework", ensureAuthenticated, async (req, res) => {
    try {
        // Check if user is teacher
        if (req.user.role !== 'teacher') {
            return res.json({ success: false, message: "Only teachers can post homework" });
        }

        const { classId, startPage, endPage } = req.body;
        const userId = req.user.id;
        
        // Verify teacher is assigned to this class
        if (req.user.classId !== parseInt(classId)) {
            return res.json({ success: false, message: "You can only post homework for your own class" });
        }

        // Create homework (removes old one)
        const homework = await createHomework(parseInt(classId), parseFloat(startPage), parseFloat(endPage), userId);
        console.log(`Homework created for class ${classId}: Pages ${startPage} to ${endPage}`);
        res.json({ success: true, message: "Homework posted", homework });
    } catch (err) {
        console.error('Error creating homework:', err);
        res.json({ success: false, message: "Error posting homework" });
    }
});

// API - Switch class (Student only)
app.post("/api/switch-class", ensureAuthenticated, async (req, res) => {
    try {
        // Check if user is student
        if (req.user.role !== 'student') {
            return res.json({ success: false, message: "Only students can switch classes" });
        }

        const { newClassId } = req.body;
        
        // Update user class and reset progress
        const updatedUser = await changeUserClass(req.user.id, parseInt(newClassId));
        
        // Update session
        req.user.classId = updatedUser.class_id;
        req.user.pagesRead = updatedUser.pages_read;
        
        console.log(`User ${req.user.id} switched to class ${newClassId}`);
        res.json({ success: true, message: "Class switched successfully", classId: updatedUser.class_id });
    } catch (err) {
        console.error('Error switching class:', err);
        res.json({ success: false, message: "Error switching class" });
    }
});

// ===== ERROR HANDLING =====
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).send(`Internal Server Error: ${err.message}`);
});

app.listen(port, async () => {
    await initializeDatabase();
    console.log(`Server running on port ${port}`);
});