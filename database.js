import pool from './db.js';

export const initializeDatabase = async () => {
    try {
        // Create tables if they don't exist
        await pool.query(`
            CREATE TABLE IF NOT EXISTS classes (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL UNIQUE
            );
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) NOT NULL UNIQUE,
                full_name VARCHAR(255) NOT NULL,
                password VARCHAR(255) NOT NULL,
                role VARCHAR(20) DEFAULT 'student',
                class_id INTEGER NOT NULL REFERENCES classes(id),
                pages_read INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Add role column if it doesn't exist (migration for existing databases)
        try {
            await pool.query(`
                ALTER TABLE users
                ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'student';
            `);
        } catch (e) {
            console.log('Role column migration: Column may already exist or is being skipped');
        }

        // Migrate pages_read to DECIMAL to support half-page increments
        try {
            await pool.query(`
                ALTER TABLE users
                ALTER COLUMN pages_read TYPE DECIMAL(10, 2);
            `);
            console.log('✅ Converted pages_read to DECIMAL for half-page support');
        } catch (e) {
            console.log('Pages read migration: Column may already be DECIMAL or skipped');
        }

        await pool.query(`
            CREATE TABLE IF NOT EXISTS homework (
                id SERIAL PRIMARY KEY,
                class_id INTEGER NOT NULL REFERENCES classes(id),
                start_page DECIMAL(10, 2) NOT NULL,
                end_page DECIMAL(10, 2) NOT NULL,
                created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Migration: replace old columns with new page range columns
        try {
            await pool.query(`
                ALTER TABLE homework
                DROP COLUMN IF EXISTS surah CASCADE;
            `);
            await pool.query(`
                ALTER TABLE homework
                DROP COLUMN IF EXISTS pages CASCADE;
            `);
            await pool.query(`
                ALTER TABLE homework
                DROP COLUMN IF EXISTS verses CASCADE;
            `);
            await pool.query(`
                ALTER TABLE homework
                ADD COLUMN IF NOT EXISTS start_page DECIMAL(10, 2);
            `);
            await pool.query(`
                ALTER TABLE homework
                ADD COLUMN IF NOT EXISTS end_page DECIMAL(10, 2);
            `);
            // Alter existing columns to DECIMAL if they are INTEGER
            await pool.query(`
                ALTER TABLE homework
                ALTER COLUMN start_page TYPE DECIMAL(10, 2);
            `);
            await pool.query(`
                ALTER TABLE homework
                ALTER COLUMN end_page TYPE DECIMAL(10, 2);
            `);
            console.log('✅ Updated homework table to use page ranges with decimal support');
        } catch (e) {
            console.log('Homework table migration: Columns may already exist or is being skipped');
        }

        // Fix foreign key constraint for existing homework tables (migration)
        try {
            await pool.query(`
                ALTER TABLE homework
                DROP CONSTRAINT IF EXISTS homework_created_by_fkey;
            `);
            await pool.query(`
                ALTER TABLE homework
                ADD CONSTRAINT homework_created_by_fkey 
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE;
            `);
            console.log('✅ Updated homework foreign key constraint');
        } catch (e) {
            console.log('Foreign key constraint migration: May already exist or skipped');
        }

        // Clean up orphaned homework records (homework where created_by user no longer exists)
        try {
            const result = await pool.query(`
                DELETE FROM homework
                WHERE created_by NOT IN (SELECT id FROM users);
            `);
            if (result.rowCount > 0) {
                console.log(`✅ Cleaned up ${result.rowCount} orphaned homework record(s)`);
            }
        } catch (e) {
            console.log('Orphaned homework cleanup: Skipped or already clean');
        }

        // Create submissions table for tracking page entries
        await pool.query(`
            CREATE TABLE IF NOT EXISTS submissions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                class_id INTEGER NOT NULL REFERENCES classes(id),
                from_page DECIMAL(10, 2) NOT NULL,
                to_page DECIMAL(10, 2) NOT NULL,
                pages_read DECIMAL(10, 2) NOT NULL,
                surah VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('✅ Database tables created successfully');
    } catch (err) {
        console.error('Database initialization error:', err.message);
        throw err;
    }
};

// Get all classes
export const getAllClasses = async () => {
    const result = await pool.query('SELECT * FROM classes ORDER BY id');
    return result.rows;
};

// Get class by ID
export const getClassById = async (classId) => {
    const result = await pool.query('SELECT * FROM classes WHERE id = $1', [classId]);
    return result.rows[0];
};

// Create user
export const createUser = async (email, fullName, classId, hashedPassword, role = 'student') => {
    const result = await pool.query(
        'INSERT INTO users (email, full_name, class_id, password, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, full_name, class_id, role, pages_read',
        [email, fullName, classId, hashedPassword, role]
    );
    return result.rows[0];
};

// Get user by email
export const getUserByEmail = async (email) => {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0];
};

// Get user by ID
export const getUserById = async (userId) => {
    const result = await pool.query('SELECT id, email, full_name, class_id, role, pages_read, created_at FROM users WHERE id = $1', [userId]);
    return result.rows[0];
};

// Get students by class ID (sorted by pages read)
export const getStudentsByClass = async (classId) => {
    const result = await pool.query(
        'SELECT id, full_name, pages_read FROM users WHERE class_id = $1 AND role = $2 ORDER BY pages_read DESC',
        [classId, 'student']
    );
    return result.rows;
};

// Update user pages read (adds to current total)
export const updateUserPages = async (userId, pages) => {
    const result = await pool.query(
        'UPDATE users SET pages_read = pages_read + $1 WHERE id = $2 RETURNING pages_read',
        [pages, userId]
    );
    return result.rows[0];
};

// Get classes with student count
export const getClassesWithCounts = async () => {
    const result = await pool.query(`
        SELECT c.id, c.name, COUNT(u.id) as student_count, COALESCE(SUM(u.pages_read), 0) as total_pages
        FROM classes c
        LEFT JOIN users u ON c.id = u.class_id AND u.role = 'student'
        GROUP BY c.id, c.name
        ORDER BY c.id
    `);
    return result.rows;
};

// Get all students sorted by pages read (global leaderboard)
export const getAllStudents = async () => {
    const result = await pool.query(
        'SELECT id, full_name, pages_read, class_id FROM users WHERE role = $1 ORDER BY pages_read DESC LIMIT 50',
        ['student']
    );
    return result.rows;
};

// Homework functions
// Get homework for a class
export const getHomeworkByClass = async (classId) => {
    const result = await pool.query(
        'SELECT id, class_id, start_page, end_page, created_by, created_at FROM homework WHERE class_id = $1 ORDER BY created_at DESC LIMIT 1',
        [classId]
    );
    return result.rows[0] || null;
};

// Create homework (replaces existing homework for the class)
export const createHomework = async (classId, startPage, endPage, createdBy) => {
    // Delete existing homework for this class
    await pool.query('DELETE FROM homework WHERE class_id = $1', [classId]);
    
    // Create new homework
    const result = await pool.query(
        'INSERT INTO homework (class_id, start_page, end_page, created_by) VALUES ($1, $2, $3, $4) RETURNING id, class_id, start_page, end_page, created_by, created_at',
        [classId, startPage, endPage, createdBy]
    );
    return result.rows[0];
};

// Update homework
export const updateHomework = async (homeworkId, startPage, endPage) => {
    const result = await pool.query(
        'UPDATE homework SET start_page = $1, end_page = $2 WHERE id = $3 RETURNING id, class_id, start_page, end_page, created_by, created_at',
        [startPage, endPage, homeworkId]
    );
    return result.rows[0];
};

// Delete homework
export const deleteHomework = async (homeworkId) => {
    await pool.query('DELETE FROM homework WHERE id = $1', [homeworkId]);
};

// Change user class (resets progress)
export const changeUserClass = async (userId, newClassId) => {
    const result = await pool.query(
        'UPDATE users SET class_id = $1, pages_read = 0 WHERE id = $2 RETURNING id, email, full_name, class_id, role, pages_read',
        [newClassId, userId]
    );
    return result.rows[0];
};

// Submission management functions
// Get all submissions for a class (for teacher dashboard)
export const getSubmissionsByClass = async (classId) => {
    const result = await pool.query(`
        SELECT s.id, s.user_id, s.from_page, s.to_page, s.pages_read, s.surah, s.created_at, s.updated_at, u.full_name
        FROM submissions s
        JOIN users u ON s.user_id = u.id
        WHERE s.class_id = $1
        ORDER BY s.created_at DESC
    `, [classId]);
    return result.rows;
};

// Get submissions for a specific student
export const getSubmissionsByStudent = async (userId) => {
    const result = await pool.query(`
        SELECT id, user_id, class_id, from_page, to_page, pages_read, surah, created_at, updated_at
        FROM submissions
        WHERE user_id = $1
        ORDER BY created_at DESC
    `, [userId]);
    return result.rows;
};

// Create a submission
export const createSubmission = async (userId, classId, fromPage, toPage, pagesRead, surah) => {
    const result = await pool.query(`
        INSERT INTO submissions (user_id, class_id, from_page, to_page, pages_read, surah)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, user_id, class_id, from_page, to_page, pages_read, surah, created_at, updated_at
    `, [userId, classId, fromPage, toPage, pagesRead, surah]);
    return result.rows[0];
};

// Update a submission
export const updateSubmission = async (submissionId, fromPage, toPage, pagesRead, surah) => {
    const result = await pool.query(`
        UPDATE submissions
        SET from_page = $1, to_page = $2, pages_read = $3, surah = $4, updated_at = CURRENT_TIMESTAMP
        WHERE id = $5
        RETURNING id, user_id, class_id, from_page, to_page, pages_read, surah, created_at, updated_at
    `, [fromPage, toPage, pagesRead, surah, submissionId]);
    return result.rows[0];
};

// Delete a submission and adjust user's pages_read
export const deleteSubmission = async (submissionId) => {
    // Get submission details first
    const subResult = await pool.query('SELECT user_id, pages_read FROM submissions WHERE id = $1', [submissionId]);
    if (subResult.rows.length === 0) {
        throw new Error('Submission not found');
    }
    
    const { user_id, pages_read } = subResult.rows[0];
    
    // Delete the submission
    await pool.query('DELETE FROM submissions WHERE id = $1', [submissionId]);
    
    // Adjust user's total pages_read
    await pool.query(
        'UPDATE users SET pages_read = pages_read - $1 WHERE id = $2',
        [pages_read, user_id]
    );
    
    return { success: true };
};
