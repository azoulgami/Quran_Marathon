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
                class_id INTEGER NOT NULL REFERENCES classes(id),
                pages_read INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('✅ Database tables created successfully');

        // Insert classes if they don't exist
        const classNames = ['Saida', 'Nabila', 'Aziza', 'Faiza', 'Shahd', 'Soussen', 'Amira'];
        
        for (const className of classNames) {
            await pool.query(
                'INSERT INTO classes (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
                [className]
            );
        }

        console.log('✅ Classes initialized');
    } catch (err) {
        console.error('Database initialization error:', err);
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
export const createUser = async (email, fullName, classId, hashedPassword) => {
    const result = await pool.query(
        'INSERT INTO users (email, full_name, class_id, password) VALUES ($1, $2, $3, $4) RETURNING id, email, full_name, class_id, pages_read',
        [email, fullName, classId, hashedPassword]
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
    const result = await pool.query('SELECT id, email, full_name, class_id, pages_read, created_at FROM users WHERE id = $1', [userId]);
    return result.rows[0];
};

// Get students by class ID (sorted by pages read)
export const getStudentsByClass = async (classId) => {
    const result = await pool.query(
        'SELECT id, full_name, pages_read FROM users WHERE class_id = $1 ORDER BY pages_read DESC',
        [classId]
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
        SELECT c.id, c.name, COUNT(u.id) as student_count
        FROM classes c
        LEFT JOIN users u ON c.id = u.class_id
        GROUP BY c.id, c.name
        ORDER BY c.id
    `);
    return result.rows;
};

// Get all students sorted by pages read (global leaderboard)
export const getAllStudents = async () => {
    const result = await pool.query(
        'SELECT id, full_name, pages_read, class_id FROM users ORDER BY pages_read DESC LIMIT 50'
    );
    return result.rows;
};
