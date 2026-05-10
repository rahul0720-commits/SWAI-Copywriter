import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbDir = join(__dirname, '..', 'data');
mkdirSync(dbDir, { recursive: true });

const db = new Database(join(dbDir, 'uvc.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    guest_name TEXT,
    recording_date TEXT,
    transcript_raw TEXT,
    transcript_clean TEXT,
    rahul_x TEXT,
    gautham_x TEXT,
    brand_x TEXT,
    x_article TEXT,
    linkedin_post TEXT,
    youtube TEXT,
    rahul_x_approved INTEGER DEFAULT 0,
    gautham_x_approved INTEGER DEFAULT 0,
    brand_x_approved INTEGER DEFAULT 0,
    x_article_approved INTEGER DEFAULT 0,
    linkedin_approved INTEGER DEFAULT 0,
    youtube_approved INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS oauth_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL UNIQUE,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TEXT,
    extra_data TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS publish_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL,
    platform TEXT NOT NULL,
    status TEXT NOT NULL,
    response_data TEXT,
    error_message TEXT,
    published_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (episode_id) REFERENCES episodes(id)
  );

  CREATE TABLE IF NOT EXISTS prompts (
    name TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS editorial_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id INTEGER NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'idle',
    audio_file_path TEXT,
    audio_file_name TEXT,
    pass1_json TEXT,
    pass2_json TEXT,
    pass1_decisions TEXT NOT NULL DEFAULT '{}',
    pass2_decisions TEXT NOT NULL DEFAULT '{}',
    transcript_v1 TEXT,
    transcript_v2 TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (episode_id) REFERENCES episodes(id)
  );

  CREATE TABLE IF NOT EXISTS keep_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT NOT NULL,
    reason TEXT NOT NULL,
    episode_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS show_criteria (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    criteria_text TEXT NOT NULL DEFAULT 'Shipping with AI show criteria:
1. Keep all moments of genuine insight, vulnerability, and lived experience.
2. Remove logistics, tech issues, restarts, and repeated questions.
3. Preserve energy and banter that reflects the show tone — warmth matters.
4. Prioritise the guest''s strongest 3–5 insights per act.',
    updated_at TEXT DEFAULT (datetime('now'))
  );

  INSERT OR IGNORE INTO show_criteria (id, criteria_text) VALUES (1, 'Shipping with AI show criteria:
1. Keep all moments of genuine insight, vulnerability, and lived experience.
2. Remove logistics, tech issues, restarts, and repeated questions.
3. Preserve energy and banter that reflects the show tone — warmth matters.
4. Prioritise the guest''s strongest 3–5 insights per act.');
`);

// Add tuning columns to editorial_sessions
for (const [col, type] of [['tuning_proposals', 'TEXT'], ['tuning_status', "TEXT DEFAULT 'none'"]]) {
  try { db.exec(`ALTER TABLE editorial_sessions ADD COLUMN ${col} ${type}`); } catch { /* already exists */ }
}

// Add intro_script column
try { db.exec(`ALTER TABLE episodes ADD COLUMN intro_script TEXT`); } catch { /* already exists */ }

// Add new columns to existing DBs (ALTER TABLE ignores duplicates via try/catch)
const newCols = [
  ['rahul_x', 'TEXT'],
  ['gautham_x', 'TEXT'],
  ['brand_x', 'TEXT'],
  ['x_article', 'TEXT'],
  ['linkedin_post', 'TEXT'],
  ['youtube', 'TEXT'],
  ['rahul_x_approved', 'INTEGER DEFAULT 0'],
  ['gautham_x_approved', 'INTEGER DEFAULT 0'],
  ['brand_x_approved', 'INTEGER DEFAULT 0'],
  ['x_article_approved', 'INTEGER DEFAULT 0'],
  ['linkedin_approved', 'INTEGER DEFAULT 0'],
  ['youtube_approved', 'INTEGER DEFAULT 0'],
];
for (const [col, type] of newCols) {
  try { db.exec(`ALTER TABLE episodes ADD COLUMN ${col} ${type}`); } catch { /* already exists */ }
}

export default db;
