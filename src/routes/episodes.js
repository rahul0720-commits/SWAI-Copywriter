import { Router } from 'express';
import { readFileSync } from 'fs';
import multer from 'multer';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { parseTranscript } from '../services/transcript.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const upload = multer({ dest: join(__dirname, '..', '..', 'uploads') });

const router = Router();

router.post('/', upload.single('transcript'), (req, res) => {
  const { title, guest_name, recording_date } = req.body;

  if (!req.file) return res.status(400).send('No transcript file uploaded');

  const buffer = readFileSync(req.file.path);
  const cleanTranscript = parseTranscript(buffer, req.file.originalname);
  const rawTranscript = buffer.toString('utf-8');

  const result = db
    .prepare(
      `INSERT INTO episodes (title, guest_name, recording_date, transcript_raw, transcript_clean)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(title, guest_name || null, recording_date || null, rawTranscript, cleanTranscript);

  res.redirect(`/episodes/${result.lastInsertRowid}/review`);
});

router.post('/:id/delete', (req, res) => {
  db.prepare('DELETE FROM episodes WHERE id = ?').run(req.params.id);
  res.redirect('/');
});

export default router;
