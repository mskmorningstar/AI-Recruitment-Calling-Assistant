const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

async function runMigrations() {
  console.log('[Migration] Starting database migration...');
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('[Migration] Migration completed successfully! All tables created.');
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('\n❌ [Migration] Migration failed:', error.message);
    if (error.message.includes('tenant/user') && error.message.includes('not found')) {
      console.error('\n💡 [Supabase Notice]: Your Supabase project tenant was not found by the pooler.');
      console.error('   This usually happens when:');
      console.error('   1. The Supabase project is currently PAUSED in the Supabase Dashboard (free tier auto-pauses after inactivity).');
      console.error('      👉 Go to https://supabase.com/dashboard and click "Restore project" or "Resume".');
      console.error('   2. Or the project ref / credentials in .env need to be refreshed.');
    }
    process.exit(1);
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations();
}

module.exports = runMigrations;
