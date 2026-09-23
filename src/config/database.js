/**
 * Smart Database Adapter
 * Auto-detects Supabase availability and falls back to local SQLite.
 * Both databases share the exact same 6-table schema.
 */
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

let pgPool = null;
let sqliteDb = null;
let activeMode = null; // 'postgres' | 'sqlite'

// ─── PostgreSQL Setup ────────────────────────────────────────────────────────
function createPgPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 4000,
  });
}

// ─── SQLite Setup ─────────────────────────────────────────────────────────────
function createSQLiteDb() {
  const dbPath = path.resolve(process.env.SQLITE_DB_PATH || './data/recruitment.db');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create all 7 tables (same schema as Supabase)
  db.exec(`
    CREATE TABLE IF NOT EXISTS recruiters (
      recruiter_id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
      full_name TEXT NOT NULL,
      phone_number TEXT,
      email TEXT NOT NULL UNIQUE,
      company_name TEXT NOT NULL,
      password_hash TEXT,
      google_id TEXT,
      google_access_token TEXT,
      google_refresh_token TEXT,
      avatar_url TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS jobs (
      job_id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
      title TEXT NOT NULL,
      company_name TEXT NOT NULL,
      location TEXT,
      employment_type TEXT DEFAULT 'Full-time',
      salary_range TEXT,
      jd_text TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS candidates (
      candidate_id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
      full_name TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      email TEXT NOT NULL,
      source TEXT DEFAULT 'ATS',
      ats_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS call_sessions (
      call_id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
      candidate_id TEXT NOT NULL REFERENCES candidates(candidate_id) ON DELETE CASCADE,
      job_id TEXT REFERENCES jobs(job_id) ON DELETE SET NULL,
      twilio_call_sid TEXT,
      call_start_time TEXT,
      call_end_time TEXT,
      call_status TEXT DEFAULT 'initiated',
      recording_url TEXT,
      transcript_text TEXT,
      ai_confidence REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS candidate_responses (
      response_id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
      call_id TEXT NOT NULL REFERENCES call_sessions(call_id) ON DELETE CASCADE,
      question_code TEXT NOT NULL,
      response_text TEXT,
      response_value TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS interview_schedules (
      schedule_id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
      candidate_id TEXT NOT NULL REFERENCES candidates(candidate_id) ON DELETE CASCADE,
      job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
      interview_date TEXT NOT NULL,
      interview_time TEXT NOT NULL,
      interviewer_name TEXT,
      calendar_event_id TEXT,
      meet_link TEXT,
      calendar_event_url TEXT,
      status TEXT DEFAULT 'scheduled',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_audit_logs (
      log_id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
      method TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      status_code INTEGER,
      response_time_ms INTEGER,
      client_ip TEXT,
      user_agent TEXT,
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Safe migration for any missing columns on existing DB
  const migrations = [
    'ALTER TABLE recruiters ADD COLUMN password_hash TEXT',
    'ALTER TABLE recruiters ADD COLUMN google_id TEXT',
    'ALTER TABLE recruiters ADD COLUMN google_access_token TEXT',
    'ALTER TABLE recruiters ADD COLUMN google_refresh_token TEXT',
    'ALTER TABLE recruiters ADD COLUMN avatar_url TEXT',
    'ALTER TABLE interview_schedules ADD COLUMN meet_link TEXT',
    'ALTER TABLE interview_schedules ADD COLUMN calendar_event_url TEXT',
  ];
  for (const m of migrations) {
    try { db.exec(m); } catch (e) { /* column already exists */ }
  }

  console.log('[SQLite] Local database initialized at:', dbPath);
  return db;
}

// ─── Unified query wrapper ────────────────────────────────────────────────────
async function query(sql, params = []) {
  if (activeMode === 'postgres' && pgPool) {
    return pgPool.query(sql, params);
  }

  if (!sqliteDb) {
    sqliteDb = createSQLiteDb();
    if (!activeMode) activeMode = 'sqlite';
  }

  // SQLite: translate $1, $2... placeholders to ?
  const sqliteSql = sql.replace(/\$\d+/g, '?');
  const stmt = sqliteDb.prepare(sqliteSql);

  // Detect statement type
  const trimmed = sqliteSql.trim().toUpperCase();
  if (trimmed.startsWith('SELECT') || trimmed.startsWith('WITH') || trimmed.includes('RETURNING')) {
    const rows = stmt.all(...params);
    return { rows, rowCount: rows.length };
  }

  const info = stmt.run(...params);
  return { rows: [], rowCount: info.changes };
}

// ─── Initialize: try Postgres first, fallback to SQLite ───────────────────────
async function initDatabase() {
  // Try PostgreSQL first
  if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('your_')) {
    try {
      pgPool = createPgPool();
      const client = await pgPool.connect();
      await client.query('SELECT NOW()');
      client.release();
      activeMode = 'postgres';
      console.log('[Database] ✅ Connected to PostgreSQL (Supabase)');
      return;
    } catch (err) {
      console.warn('[Database] ⚠️  PostgreSQL unavailable:', err.message);
      console.warn('[Database] 🔄 Falling back to local SQLite database...');
      if (pgPool) await pgPool.end().catch(() => {});
      pgPool = null;
    }
  }

  // SQLite fallback
  sqliteDb = createSQLiteDb();
  activeMode = 'sqlite';
  console.log('[Database] ✅ Using local SQLite database (zero-cost, zero-config)');
}

module.exports = {
  query,
  initDatabase,
  getMode: () => activeMode,
  pool: new Proxy({}, {
    get: (_, prop) => {
      if (prop === 'query') return (sql, params) => query(sql, params);
      if (prop === 'end') return async () => {
        if (pgPool) await pgPool.end().catch(() => {});
        if (sqliteDb) sqliteDb.close();
      };
      return undefined;
    }
  }),
};
