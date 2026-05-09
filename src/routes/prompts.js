import { Router } from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(__dirname, '..', 'prompts');

const PROMPTS = [
  { name: 'rahul-x',        label: "Rahul's X",        file: 'rahul-x.txt' },
  { name: 'gautham-x',      label: "Gautham's X",       file: 'gautham-x.txt' },
  { name: 'brand-x',        label: 'Brand X',           file: 'brand-x.txt' },
  { name: 'x-article',      label: 'X Article',         file: 'x-article.txt' },
  { name: 'linkedin',       label: 'LinkedIn',          file: 'linkedin.txt' },
  { name: 'youtube',        label: 'YouTube',           file: 'youtube.txt' },
  { name: 'editorial-pass1', label: 'Editorial Pass 1', file: 'editorial-pass1.txt' },
  { name: 'editorial-pass2', label: 'Editorial Pass 2', file: 'editorial-pass2.txt' },
];

const router = Router();

router.get('/settings/prompts', (req, res) => {
  const prompts = PROMPTS.map((p) => {
    const defaultContent = readFileSync(join(promptsDir, p.file), 'utf-8');
    const row = db.prepare('SELECT content FROM prompts WHERE name = ?').get(p.name);
    return {
      ...p,
      content: row ? row.content : defaultContent,
      isCustom: !!row,
      defaultContent,
    };
  });

  res.render('prompts', {
    title: 'Prompts',
    prompts,
    saved: req.query.saved || null,
    reset: req.query.reset || null,
  });
});

router.post('/settings/prompts/:name', (req, res) => {
  const { name } = req.params;
  const { content } = req.body;
  const valid = PROMPTS.find((p) => p.name === name);
  if (!valid) return res.status(404).send('Unknown prompt');

  db.prepare(`
    INSERT INTO prompts (name, content, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
  `).run(name, content.trim());

  res.redirect(`/settings/prompts?saved=${name}`);
});

router.post('/settings/prompts/:name/reset', (req, res) => {
  const { name } = req.params;
  const valid = PROMPTS.find((p) => p.name === name);
  if (!valid) return res.status(404).send('Unknown prompt');

  db.prepare('DELETE FROM prompts WHERE name = ?').run(name);
  res.redirect(`/settings/prompts?reset=${name}`);
});

export default router;
