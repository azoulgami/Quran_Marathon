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
import { getAllClasses, getClassById, createUser, getUserByEmail, getUserById, getStudentsByClass, updateUserPages, getClassesWithCounts, getAllStudents, initializeDatabase } from "./database.js";

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
    const { email, fullName, classId, password, confirmPassword } = req.body;

    // Validation
    if (password !== confirmPassword) {
        return res.render("register.ejs", { message: "Passwords don't match!" });
    }

    try {
        const existingUser = await getUserByEmail(email);
        if (existingUser) {
            return res.render("register.ejs", { message: "Email already registered!" });
        }

        // Hash password and create user
        const hashedPassword = bcrypt.hashSync(password, 10);
        const newUser = await createUser(email, fullName, parseInt(classId), hashedPassword);
        
        console.log(`New user registered: ${email}`);

        // Auto-login after registration
        req.login({ 
            id: newUser.id, 
            email: newUser.email, 
            fullName: newUser.full_name,
            classId: newUser.class_id 
        }, (err) => {
            if (err) return res.render("register.ejs", { message: "Registration error!" });
            res.redirect("/");
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.render("register.ejs", { message: "An error occurred. Please try again." });
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
        const classes = await getClassesWithCounts();
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
        
        res.render("class.ejs", { classId, className, students, user: req.user });
    } catch (err) {
        console.error('Error fetching class:', err);
        res.render("class.ejs", { classId: 0, className: "Error", students: [], user: req.user });
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

app.listen(port, async () => {
    await initializeDatabase();
    console.log(`Server running on port ${port}`);
});