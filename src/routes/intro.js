import { Router } from 'express';
import multer from 'multer';
import db from '../db.js';
import { generateIntroScript } from '../services/claude.js';
import { parseTranscript } from '../services/transcript.js';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

router.get('/:id/intro', (req, res) => {
  const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(req.params.id);
  if (!episode) return res.status(404).render('error', { title: 'Not Found', message: 'Episode not found' });
  res.render('intro', { title: 'Intro Script', episode, error: null });
});

router.post('/:id/intro/generate', upload.single('transcript'), async (req, res) => {
  const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(req.params.id);
  if (!episode) return res.status(404).render('error', { title: 'Not Found', message: 'Episode not found' });

  let transcript;
  if (req.file) {
    const buffer = req.file.buffer;
    transcript = parseTranscript(buffer, req.file.originalname);
  } else if (episode.transcript_clean) {
    transcript = episode.transcript_clean;
  } else if (episode.transcript_raw) {
    transcript = episode.transcript_raw;
  } else {
    return res.render('intro', { title: 'Intro Script', episode, error: 'Please upload a transcript file.' });
  }

  try {
    const introScript = await generateIntroScript(transcript, {
      title: episode.title,
      guestName: episode.guest_name,
    });
    db.prepare('UPDATE episodes SET intro_script = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(introScript, episode.id);
    const updated = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episode.id);
    res.render('intro', { title: 'Intro Script', episode: updated, error: null });
  } catch (err) {
    console.error('Intro script generation error:', err);
    res.render('intro', { title: 'Intro Script', episode, error: 'Generation failed. Please try again.' });
  }
});

router.post('/:id/intro/save', (req, res) => {
  const { intro_script } = req.body;
  db.prepare('UPDATE episodes SET intro_script = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(intro_script || null, req.params.id);
  res.redirect(`/episodes/${req.params.id}/intro`);
});

export default router;
