import pool from '../db.js';

async function clearData() {
  try {
    console.log('🗑️  Clearing data...\n');

    // Clear submissions table
    const submissionsResult = await pool.query('DELETE FROM submissions');
    console.log(`✅ Deleted ${submissionsResult.rowCount} submissions`);

    // Reset all users' pages_read to 0
    const usersResult = await pool.query('UPDATE users SET pages_read = 0');
    console.log(`✅ Reset ${usersResult.rowCount} users pages_read to 0`);

    console.log('\n✅ Data cleared successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

clearData();
