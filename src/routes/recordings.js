import { Router } from 'express';
import multer from 'multer';
import db from '../db.js';
import { generateIntroScript } from '../services/claude.js';
import { getOutput, getOutputs, generateOne, generateSection } from '../services/outputs.js';
import { currentPromptVersion } from '../services/promptStore.js';
import { parseTranscript } from '../services/transcript.js';
import { isConnected as twitterConnected } from '../services/twitter.js';
import { isConnected as linkedinConnected } from '../services/linkedin.js';

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

const APPROVED_BADGE = `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:500;color:#065f46;background:#d1fae5;padding:4px 10px;border-radius:99px;"><span style="width:7px;height:7px;border-radius:50%;background:#059669;flex-shrink:0;"></span>Approved</span>`;
const DRAFT_BADGE    = `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:500;color:#777587;background:#f0e6e0;padding:4px 10px;border-radius:99px;"><span style="width:7px;height:7px;border-radius:50%;background:#c7c4d8;flex-shrink:0;"></span>Draft</span>`;
const SAVED_BADGE    = `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:500;color:#8c3213;background:#fde8d6;padding:4px 10px;border-radius:99px;"><span style="width:7px;height:7px;border-radius:50%;background:#ba4b1d;flex-shrink:0;"></span>Saved — re-approve</span>`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getEpisode(recordingId) {
  return db.prepare('SELECT * FROM episodes WHERE recording_id = ?').get(recordingId);
}

function getSession(recordingId) {
  return db.prepare('SELECT * FROM editorial_sessions WHERE recording_id = ?').get(recordingId);
}

// ─── GET /recordings ──────────────────────────────────────────────────────────

router.get('/recordings', (req, res) => {
  const recordings = db.prepare(`
    SELECT r.*,
      es.status as editorial_status,
      CASE WHEN e.id IS NOT NULL THEN 1 ELSE 0 END as has_episode,
      CASE WHEN e.rahul_x IS NOT NULL THEN 1 ELSE 0 END as has_content
    FROM recordings r
    LEFT JOIN editorial_sessions es ON es.recording_id = r.id
    LEFT JOIN episodes e ON e.recording_id = r.id
    ORDER BY r.created_at DESC
  `).all();

  res.render('recordings', {
    title: 'Recordings',
    recordings,
    twitterConnected: twitterConnected(),
    linkedinConnected: linkedinConnected(),
  });
});

// ─── POST /recordings ─────────────────────────────────────────────────────────

router.post('/recordings', upload.single('transcript'), (req, res) => {
  const { title, guest_name, recording_date } = req.body;
  if (!title?.trim()) return res.redirect('/recordings');

  let rawTranscript = null;
  if (req.file) {
    rawTranscript = parseTranscript(req.file.buffer, req.file.originalname);
  }

  const result = db.prepare(`
    INSERT INTO recordings (title, guest_name, recording_date, raw_transcript, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(title.trim(), guest_name?.trim() || null, recording_date || null, rawTranscript);

  res.redirect(`/recordings/${result.lastInsertRowid}`);
});

// ─── GET /recordings/:id (intro script) ──────────────────────────────────────

router.get('/recordings/:id', (req, res) => {
  const recording = db.prepare('SELECT * FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) return res.status(404).render('error', { title: 'Not Found', message: 'Recording not found' });

  const episode = getEpisode(req.params.id);
  const session = getSession(req.params.id);

  res.render('recording', {
    title: `${recording.title} — Intro Script`,
    recording,
    episode,
    session,
    error: null,
  });
});

// ─── POST /recordings/:id/intro/upload-transcript ────────────────────────────

router.post('/recordings/:id/intro/upload-transcript', upload.single('transcript'), (req, res) => {
  if (!req.file) return res.redirect(`/recordings/${req.params.id}`);
  const parsed = parseTranscript(req.file.buffer, req.file.originalname);
  db.prepare(`UPDATE recordings SET raw_transcript = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(parsed, req.params.id);
  res.redirect(`/recordings/${req.params.id}`);
});

// ─── POST /recordings/:id/intro/generate ─────────────────────────────────────

router.post('/recordings/:id/intro/generate', upload.single('transcript'), async (req, res) => {
  const recording = db.prepare('SELECT * FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) return res.status(404).render('error', { title: 'Not Found', message: 'Recording not found' });

  let transcript = recording.raw_transcript;

  if (req.file) {
    const parsed = parseTranscript(req.file.buffer, req.file.originalname);
    db.prepare(`UPDATE recordings SET raw_transcript = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(parsed, recording.id);
    transcript = parsed;
  }

  if (!transcript) {
    return res.render('recording', {
      title: `${recording.title} — Intro Script`,
      recording,
      episode: getEpisode(recording.id),
      session: getSession(recording.id),
      error: 'Please upload a transcript file first.',
    });
  }

  try {
    const introScript = await generateIntroScript(transcript, {
      title: recording.title,
      guestName: recording.guest_name,
    });
    db.prepare(`UPDATE recordings SET intro_script = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(introScript, recording.id);
    res.redirect(`/recordings/${recording.id}`);
  } catch (err) {
    console.error('Intro script generation error:', err);
    res.render('recording', {
      title: `${recording.title} — Intro Script`,
      recording,
      episode: getEpisode(recording.id),
      session: getSession(recording.id),
      error: 'Generation failed. Please try again.',
    });
  }
});

// ─── POST /recordings/:id/intro/save ─────────────────────────────────────────

router.post('/recordings/:id/intro/save', (req, res) => {
  db.prepare(`UPDATE recordings SET intro_script = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(req.body.intro_script || null, req.params.id);
  res.redirect(`/recordings/${req.params.id}`);
});

// ─── POST /recordings/:id/delete ─────────────────────────────────────────────

router.post('/recordings/:id/delete', (req, res) => {
  const id = req.params.id;
  const episode = getEpisode(id);
  if (episode) {
    db.prepare('DELETE FROM editorial_sessions WHERE episode_id = ?').run(episode.id);
    db.prepare('DELETE FROM episodes WHERE id = ?').run(episode.id);
  }
  db.prepare('DELETE FROM editorial_sessions WHERE recording_id = ?').run(id);
  db.prepare('DELETE FROM content_feedback WHERE recording_id = ?').run(id);
  db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
  res.redirect('/recordings');
});

// ─── GET /recordings/:id/distribution ────────────────────────────────────────

router.get('/recordings/:id/distribution', (req, res) => {
  const recording = db.prepare('SELECT * FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) return res.status(404).render('error', { title: 'Not Found', message: 'Recording not found' });

  const episode = getEpisode(req.params.id);
  const session = getSession(req.params.id);

  res.render('distribution', {
    title: `${recording.title} — Distribution Copy`,
    recording,
    episode,
    session,
    outputs: getOutputs('distribution'),
    twitterConnected: twitterConnected(),
    linkedinConnected: linkedinConnected(),
    approvedBadge: APPROVED_BADGE,
    draftBadge: DRAFT_BADGE,
    savedBadge: SAVED_BADGE,
  });
});

// ─── POST /recordings/:id/distribution/create ────────────────────────────────

router.post('/recordings/:id/distribution/create', upload.single('transcript'), (req, res) => {
  const recording = db.prepare('SELECT * FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) return res.status(404).send('Recording not found');

  let transcriptClean = null;
  if (req.file) {
    transcriptClean = parseTranscript(req.file.buffer, req.file.originalname);
  } else if (req.body.use_editorial_output === '1') {
    const session = getSession(req.params.id);
    transcriptClean = session?.transcript_v2 || null;
  }

  let episode = getEpisode(req.params.id);
  if (episode) {
    if (transcriptClean) {
      db.prepare(`UPDATE episodes SET transcript_clean = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(transcriptClean, episode.id);
    }
  } else {
    db.prepare(`
      INSERT INTO episodes (title, guest_name, recording_date, transcript_raw, transcript_clean, recording_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(recording.title, recording.guest_name, recording.recording_date, recording.raw_transcript, transcriptClean, req.params.id);
  }

  res.redirect(`/recordings/${req.params.id}/distribution`);
});

// ─── POST /recordings/:id/distribution/generate ──────────────────────────────

router.post('/recordings/:id/distribution/generate', async (req, res, next) => {
  try {
    const episode = getEpisode(req.params.id);
    if (!episode?.transcript_clean) return res.status(400).send('No final transcript — upload one first');

    const metadata = { title: episode.title, guestName: episode.guest_name };
    const body = req.body || {};
    const extras = { mode: body.mode || 'full', hostName: body.host_name || 'Rahul' };
    const results = await generateSection('distribution', episode.transcript_clean, metadata, extras);

    const setClause = results.map(r => `${r.output.dbColumn} = ?`).join(', ');
    const values = results.map(r => r.content);
    db.prepare(`UPDATE episodes SET ${setClause}, updated_at = datetime('now') WHERE id = ?`)
      .run(...values, episode.id);

    res.redirect(`/recordings/${req.params.id}/distribution`);
  } catch (err) { next(err); }
});

// ─── POST /recordings/:id/distribution/generate/:platform (one output) ───────
// Same handler powers first-time "Generate" and "Regenerate" for a single output.

async function generateSingleOutput(req, res, next) {
  try {
    const episode = getEpisode(req.params.id);
    if (!episode?.transcript_clean) return res.status(400).send('No transcript available');

    const output = getOutput(req.params.platform);
    if (!output) return res.status(400).send('Invalid output');

    const metadata = { title: episode.title, guestName: episode.guest_name };
    const body = req.body || {};
    const extras = { mode: body.mode || 'full', hostName: body.host_name || 'Rahul' };
    const content = await generateOne(output, episode.transcript_clean, metadata, extras);
    db.prepare(`UPDATE episodes SET ${output.dbColumn} = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(content, episode.id);

    res.redirect(`/recordings/${req.params.id}/distribution`);
  } catch (err) { next(err); }
}

router.post('/recordings/:id/distribution/generate/:platform', generateSingleOutput);
router.post('/recordings/:id/distribution/regenerate/:platform', generateSingleOutput);

// ─── POST /recordings/:id/distribution/approve/:platform (HTMX) ──────────────

router.post('/recordings/:id/distribution/approve/:platform', (req, res) => {
  const output = getOutput(req.params.platform);
  if (!output) return res.status(400).send('Invalid platform');
  const episode = getEpisode(req.params.id);
  if (!episode) return res.status(404).send('No distribution copy');

  db.prepare(`UPDATE episodes SET ${output.approvedColumn} = 1, updated_at = datetime('now') WHERE id = ?`).run(episode.id);

  if (req.headers['hx-request']) return res.send(APPROVED_BADGE);
  res.redirect(`/recordings/${req.params.id}/distribution`);
});

// ─── POST /recordings/:id/distribution/edit/:platform (HTMX) ─────────────────

router.post('/recordings/:id/distribution/edit/:platform', (req, res) => {
  const output = getOutput(req.params.platform);
  if (!output) return res.status(400).send('Invalid platform');
  const episode = getEpisode(req.params.id);
  if (!episode) return res.status(404).send('No distribution copy');

  db.prepare(`UPDATE episodes SET ${output.dbColumn} = ?, ${output.approvedColumn} = 0, updated_at = datetime('now') WHERE id = ?`)
    .run(req.body.content, episode.id);

  if (req.headers['hx-request']) return res.send(SAVED_BADGE);
  res.redirect(`/recordings/${req.params.id}/distribution`);
});

// ─── POST /recordings/:id/distribution/feedback (HTMX) ───────────────────────

router.post('/recordings/:id/distribution/feedback', (req, res) => {
  const body = req.body || {};
  const { content_type, rating } = body;
  const note = (body.note || '').trim() || null;
  const episode = getEpisode(req.params.id);
  const promptVersion = currentPromptVersion(content_type);
  db.prepare(`INSERT INTO content_feedback (recording_id, episode_id, content_type, rating, note, prompt_version) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(req.params.id, episode?.id || null, content_type, parseInt(rating), note, promptVersion);
  if (req.headers['hx-request']) {
    return res.send(`<span style="font-size:12px;color:#065f46;font-family:'Inter',sans-serif;">✓ Thanks — feedback saved</span>`);
  }
  res.redirect(`/recordings/${req.params.id}/distribution`);
});

// ─── POST /recordings/:id/feedback (intro/editorial) ────────────────────────

router.post('/recordings/:id/feedback', (req, res) => {
  const { content_type, rating } = req.body;
  db.prepare(`INSERT INTO content_feedback (recording_id, content_type, rating) VALUES (?, ?, ?)`)
    .run(req.params.id, content_type, parseInt(rating));
  if (req.headers['hx-request']) return res.send('');
  res.redirect(`/recordings/${req.params.id}`);
});

export default router;
