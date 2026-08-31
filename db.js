import dotenv from 'dotenv';
dotenv.config();

import pkg from 'pg';
const { Pool } = pkg;

// Support both DATABASE_URL (for Neon) and individual env vars (for local dev)
const pool = new Pool(
    process.env.DATABASE_URL || {
        user: process.env.DB_USER || 'postgres',
        password: String(process.env.DB_PASSWORD || ''),
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        database: process.env.DB_NAME || 'quran'
    }
);

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
});

export default pool;
