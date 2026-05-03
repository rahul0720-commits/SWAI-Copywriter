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
    blog_post TEXT,
    twitter_thread TEXT,
    linkedin_post TEXT,
    substack_draft TEXT,
    blog_approved INTEGER DEFAULT 0,
    twitter_approved INTEGER DEFAULT 0,
    linkedin_approved INTEGER DEFAULT 0,
    substack_approved INTEGER DEFAULT 0,
    twitter_published INTEGER DEFAULT 0,
    linkedin_published INTEGER DEFAULT 0,
    substack_status TEXT DEFAULT 'draft',
    youtube_options TEXT,
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

export default db;
