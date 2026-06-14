// ─── Prompt store + versioning ────────────────────────────────────────────────
// Central place to read/write prompts so every change (manual edit or tuned-from-
// feedback) also records a version in prompt_versions. The `prompts` table holds the
// current active override that loadPrompt() reads; prompt_versions is the history.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(__dirname, '..', 'prompts');

// Current active content for a prompt: DB override if present, else the default file.
export function getPromptContent(name, file) {
  const row = db.prepare('SELECT content FROM prompts WHERE name = ?').get(name);
  if (row) return row.content;
  return file ? readFileSync(join(promptsDir, file), 'utf-8') : '';
}

// Highest version number recorded for a prompt (0 = never customised / default).
export function currentPromptVersion(name) {
  const row = db.prepare('SELECT MAX(version_number) AS v FROM prompt_versions WHERE prompt_name = ?').get(name);
  return row?.v || 0;
}

// Save a prompt: upsert the active override AND append a version row. Returns the
// new version number.
export function savePromptVersion(name, content, note) {
  const next = currentPromptVersion(name) + 1;
  db.prepare(`
    INSERT INTO prompts (name, content, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
  `).run(name, content);
  db.prepare(`
    INSERT INTO prompt_versions (prompt_name, content, version_number, note)
    VALUES (?, ?, ?, ?)
  `).run(name, content, next, note || null);
  return next;
}
