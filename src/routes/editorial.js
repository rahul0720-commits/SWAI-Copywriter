import { Router } from 'express';
import { existsSync } from 'fs';
import multer from 'multer';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { runPass1, runPass2, generateSuggestedEditsMarkdown } from '../services/editorial.js';
import { applyEditorialCuts, cleanTranscriptForCopywriter } from '../services/transcript.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const upload = multer({ dest: join(__dirname, '..', '..', 'uploads') });
const transcriptUpload = multer({ storage: multer.memoryStorage() });
const router = Router();

// ─── helpers ──────────────────────────────────────────────────────────────────

function getOrCreateSession(episodeId) {
  let session = db.prepare('SELECT * FROM editorial_sessions WHERE episode_id = ?').get(episodeId);
  if (!session) {
    db.prepare('INSERT INTO editorial_sessions (episode_id) VALUES (?)').run(episodeId);
    session = db.prepare('SELECT * FROM editorial_sessions WHERE episode_id = ?').get(episodeId);
  }
  return session;
}

function getShowCriteria() {
  return db.prepare('SELECT criteria_text FROM show_criteria WHERE id = 1').get()?.criteria_text ?? '';
}

function getKeepList() {
  return db.prepare('SELECT pattern, reason, created_at FROM keep_list ORDER BY created_at DESC').all();
}

function parseDecisions(json) {
  try { return JSON.parse(json || '{}'); } catch { return {}; }
}

function parseFlags(json) {
  try { return JSON.parse(json || '[]'); } catch { return []; }
}

function countAccepted(flags, decisions) {
  return flags.filter(f => (decisions[f.id]?.action ?? 'accept') === 'accept').length;
}

// ─── Settings router (separate instance — mounted at '/' in index.js) ─────────

router.get('/settings/editorial', (req, res) => {
  const criteria = getShowCriteria();
  const keepList = getKeepList();
  res.render('settings-editorial', { title: 'Editorial Criteria', criteria, keepList });
});

router.post('/settings/editorial', (req, res) => {
  const { criteria_text } = req.body;
  db.prepare(`UPDATE show_criteria SET criteria_text = ?, updated_at = datetime('now') WHERE id = 1`)
    .run(criteria_text || '');
  res.redirect('/settings/editorial');
});

router.post('/settings/editorial/keep-list/delete', (req, res) => {
  db.prepare('DELETE FROM keep_list WHERE id = ?').run(req.body.id);
  res.redirect('/settings/editorial');
});

// ─── HTMX response helpers ────────────────────────────────────────────────────

function decisionBadgeHtml(episodeId, flagId, action, pass) {
  const cfg = {
    accept:   { label: 'Cut',      color: '#ba1a1a', bg: '#fde8d6' },
    reject:   { label: 'Keep',     color: '#065f46', bg: '#d1fae5' },
    relocate: { label: 'Relocate', color: '#92400e', bg: '#fef3c7' },
  };
  const { label, color, bg } = cfg[action];
  return `<div id="decision-${flagId}" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
    <span style="font-size:12px;font-weight:600;padding:3px 10px;border-radius:4px;color:${color};background:${bg};">${label}</span>
    <button
      hx-post="/episodes/${episodeId}/editorial/undecide"
      hx-vals='{"flagId":"${flagId}","pass":"${pass}"}'
      hx-target="#decision-${flagId}"
      hx-swap="outerHTML"
      style="font-size:12px;color:#777587;background:none;border:none;cursor:pointer;padding:0;text-decoration:underline;">Undo</button>
  </div>`;
}

function undecidedButtonsHtml(episodeId, flagId, pass, isPass2 = false) {
  const rejectExtras = isPass2
    ? `hx-include="#reason-${flagId}"`
    : '';
  const reasonInput = isPass2
    ? `<input id="reason-${flagId}" name="reason" type="text" placeholder="Reason to keep (optional — adds to keep list)" style="flex:1;padding:5px 10px;border:1px solid #c7c4d8;border-radius:5px;font-family:'Inter',sans-serif;font-size:12px;color:#1f1b17;background:#fff;min-width:200px;">`
    : '';
  return `<div id="decision-${flagId}" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
    ${reasonInput}
    <button
      hx-post="/episodes/${episodeId}/editorial/decide"
      hx-vals='{"flagId":"${flagId}","action":"accept","pass":"${pass}"}'
      hx-target="#decision-${flagId}"
      hx-swap="outerHTML"
      style="font-size:12px;font-weight:600;padding:5px 14px;border-radius:5px;background:#ba1a1a;color:#fff;border:none;cursor:pointer;">Cut</button>
    <button
      hx-post="/episodes/${episodeId}/editorial/decide"
      hx-vals='{"flagId":"${flagId}","action":"reject","pass":"${pass}"}'
      ${rejectExtras}
      hx-target="#decision-${flagId}"
      hx-swap="outerHTML"
      style="font-size:12px;font-weight:600;padding:5px 14px;border-radius:5px;background:none;color:#464555;border:1px solid #c7c4d8;cursor:pointer;">Keep</button>
    ${isPass2 ? `<button
      hx-post="/episodes/${episodeId}/editorial/decide"
      hx-vals='{"flagId":"${flagId}","action":"relocate","pass":"${pass}"}'
      hx-target="#decision-${flagId}"
      hx-swap="outerHTML"
      style="font-size:12px;font-weight:600;padding:5px 14px;border-radius:5px;background:none;color:#92400e;border:1px solid #fde68a;cursor:pointer;">Relocate</button>` : ''}
  </div>`;
}

// ─── GET /:id/editorial ───────────────────────────────────────────────────────

router.get('/episodes/:id/editorial', (req, res) => {
  const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(req.params.id);
  if (!episode) return res.status(404).send('Distribution copy not found');

  const session = getOrCreateSession(req.params.id);
  const showCriteria = getShowCriteria();
  const keepList = getKeepList();

  const pass1Flags = parseFlags(session.pass1_json);
  const pass2Flags = parseFlags(session.pass2_json);
  const pass1Decisions = parseDecisions(session.pass1_decisions);
  const pass2Decisions = parseDecisions(session.pass2_decisions);

  const pass1Accepted = countAccepted(pass1Flags, pass1Decisions);
  const pass2Accepted = countAccepted(pass2Flags, pass2Decisions);

  let suggestedEditsMarkdown = null;
  if (session.status === 'pass2_applied') {
    suggestedEditsMarkdown = generateSuggestedEditsMarkdown(episode, pass1Flags, pass2Flags, pass1Decisions, pass2Decisions);
  }

  // Add computed secs for audio playback
  const withSecs = (flags) => flags.map(f => ({
    ...f,
    start_secs: f.start_time ? f.start_time.split(':').reduce((a, v, i) => a + parseFloat(v) * [3600, 60, 1][i], 0) : 0,
    end_secs: f.end_time ? f.end_time.split(':').reduce((a, v, i) => a + parseFloat(v) * [3600, 60, 1][i], 0) : 0,
  }));

  res.render('editorial', {
    title: `Editorial: ${episode.title}`,
    episode,
    session,
    showCriteria,
    keepList,
    pass1Flags: withSecs(pass1Flags),
    pass2Flags: withSecs(pass2Flags),
    pass1Decisions,
    pass2Decisions,
    pass1Accepted,
    pass2Accepted,
    suggestedEditsMarkdown,
  });
});

// ─── POST /:id/editorial/upload-audio ─────────────────────────────────────────

router.post('/episodes/:id/editorial/upload-audio', upload.single('audio'), (req, res) => {
  if (!req.file) return res.redirect(`/episodes/${req.params.id}/editorial`);
  db.prepare(`UPDATE editorial_sessions SET audio_file_path = ?, audio_file_name = ?, updated_at = datetime('now') WHERE episode_id = ?`)
    .run(req.file.path, req.file.originalname, req.params.id);
  res.redirect(`/episodes/${req.params.id}/editorial`);
});

// ─── POST /:id/editorial/upload-transcript ────────────────────────────────────

router.post('/episodes/:id/editorial/upload-transcript', transcriptUpload.single('transcript'), (req, res) => {
  if (!req.file) return res.redirect(`/episodes/${req.params.id}/editorial`);
  const content = req.file.buffer.toString('utf-8');
  const pass = req.body.pass || '1';

  if (pass === '2') {
    db.prepare(`UPDATE editorial_sessions SET transcript_v1 = ?, status = 'pass1_applied', updated_at = datetime('now') WHERE episode_id = ?`)
      .run(content, req.params.id);
  } else {
    db.prepare(`UPDATE episodes SET transcript_raw = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(content, req.params.id);
  }

  res.redirect(`/episodes/${req.params.id}/editorial`);
});

// ─── POST /:id/editorial/run-pass/1 ───────────────────────────────────────────

router.post('/episodes/:id/editorial/run-pass/1', async (req, res, next) => {
  try {
    const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(req.params.id);
    if (!episode) return res.status(404).send('Distribution copy not found');

    const transcript = episode.transcript_raw || episode.transcript_clean;
    if (!transcript) return res.status(400).send('No transcript available');

    const flags = await runPass1(transcript, { title: episode.title, guestName: episode.guest_name }, getShowCriteria());

    db.prepare(`UPDATE editorial_sessions SET pass1_json = ?, pass1_decisions = '{}', status = 'pass1_pending', updated_at = datetime('now') WHERE episode_id = ?`)
      .run(JSON.stringify(flags), req.params.id);

    res.redirect(`/episodes/${req.params.id}/editorial`);
  } catch (err) { next(err); }
});

// ─── POST /:id/editorial/run-pass/2 ───────────────────────────────────────────

router.post('/episodes/:id/editorial/run-pass/2', async (req, res, next) => {
  try {
    const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(req.params.id);
    if (!episode) return res.status(404).send('Distribution copy not found');

    const session = db.prepare('SELECT * FROM editorial_sessions WHERE episode_id = ?').get(req.params.id);
    const transcript = session?.transcript_v1 || episode.transcript_raw || episode.transcript_clean;
    if (!transcript) return res.status(400).send('No transcript available');

    const keepList = getKeepList();
    const flags = await runPass2(
      transcript,
      { title: episode.title, guestName: episode.guest_name },
      getShowCriteria(),
      keepList
    );

    db.prepare(`UPDATE editorial_sessions SET pass2_json = ?, pass2_decisions = '{}', status = 'pass2_pending', updated_at = datetime('now') WHERE episode_id = ?`)
      .run(JSON.stringify(flags), req.params.id);

    res.redirect(`/episodes/${req.params.id}/editorial`);
  } catch (err) { next(err); }
});

// ─── POST /:id/editorial/decide (HTMX) ────────────────────────────────────────

router.post('/episodes/:id/editorial/decide', (req, res) => {
  const { flagId, action, pass, reason } = req.body;
  const epId = req.params.id;
  const sessionCol = pass === '2' ? 'pass2_decisions' : 'pass1_decisions';

  const session = db.prepare('SELECT * FROM editorial_sessions WHERE episode_id = ?').get(epId);
  const decisions = parseDecisions(session?.[sessionCol]);
  decisions[flagId] = { action, reason: reason || undefined };

  db.prepare(`UPDATE editorial_sessions SET ${sessionCol} = ?, updated_at = datetime('now') WHERE episode_id = ?`)
    .run(JSON.stringify(decisions), epId);

  if (action === 'reject' && reason && reason.trim() && pass === '2') {
    const flags = parseFlags(session.pass2_json);
    const flag = flags.find(f => f.id === flagId);
    if (flag) {
      db.prepare('INSERT INTO keep_list (pattern, reason, episode_id) VALUES (?, ?, ?)')
        .run(flag.text.slice(0, 150), reason.trim(), epId);
    }
  }

  res.send(decisionBadgeHtml(epId, flagId, action, pass));
});

// ─── POST /:id/editorial/undecide (HTMX) ─────────────────────────────────────

router.post('/episodes/:id/editorial/undecide', (req, res) => {
  const { flagId, pass } = req.body;
  const epId = req.params.id;
  const sessionCol = pass === '2' ? 'pass2_decisions' : 'pass1_decisions';

  const session = db.prepare('SELECT * FROM editorial_sessions WHERE episode_id = ?').get(epId);
  const decisions = parseDecisions(session?.[sessionCol]);
  delete decisions[flagId];

  db.prepare(`UPDATE editorial_sessions SET ${sessionCol} = ?, updated_at = datetime('now') WHERE episode_id = ?`)
    .run(JSON.stringify(decisions), epId);

  res.send(undecidedButtonsHtml(epId, flagId, pass, pass === '2'));
});

// ─── POST /:id/editorial/apply/1 ─────────────────────────────────────────────

router.post('/episodes/:id/editorial/apply/1', (req, res) => {
  const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(req.params.id);
  if (!episode) return res.status(404).send('Distribution copy not found');

  const session = db.prepare('SELECT * FROM editorial_sessions WHERE episode_id = ?').get(req.params.id);
  const flags = parseFlags(session.pass1_json);
  const decisions = parseDecisions(session.pass1_decisions);

  const accepted = flags.filter(f => (decisions[f.id]?.action ?? 'accept') === 'accept');
  const rawTranscript = episode.transcript_raw || episode.transcript_clean;
  const v1 = applyEditorialCuts(rawTranscript, accepted);

  db.prepare(`UPDATE editorial_sessions SET transcript_v1 = ?, status = 'pass1_applied', updated_at = datetime('now') WHERE episode_id = ?`)
    .run(v1, req.params.id);

  res.redirect(`/episodes/${req.params.id}/editorial`);
});

// ─── POST /:id/editorial/apply/2 ─────────────────────────────────────────────

router.post('/episodes/:id/editorial/apply/2', (req, res) => {
  const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(req.params.id);
  if (!episode) return res.status(404).send('Distribution copy not found');

  const session = db.prepare('SELECT * FROM editorial_sessions WHERE episode_id = ?').get(req.params.id);
  const flags = parseFlags(session.pass2_json);
  const decisions = parseDecisions(session.pass2_decisions);

  const accepted = flags.filter(f => (decisions[f.id]?.action ?? 'accept') === 'accept');
  const baseTranscript = session.transcript_v1 || episode.transcript_raw || episode.transcript_clean;
  const v2 = applyEditorialCuts(baseTranscript, accepted);

  db.prepare(`UPDATE editorial_sessions SET transcript_v2 = ?, status = 'pass2_applied', updated_at = datetime('now') WHERE episode_id = ?`)
    .run(v2, req.params.id);

  res.redirect(`/episodes/${req.params.id}/editorial`);
});

// ─── POST /:id/editorial/send-to-copywriter ───────────────────────────────────

router.post('/episodes/:id/editorial/send-to-copywriter', (req, res) => {
  const session = db.prepare('SELECT * FROM editorial_sessions WHERE episode_id = ?').get(req.params.id);
  if (!session?.transcript_v2) return res.status(400).send('No v2 transcript available');

  const clean = cleanTranscriptForCopywriter(session.transcript_v2);
  db.prepare(`UPDATE episodes SET transcript_clean = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(clean, req.params.id);

  res.redirect(`/episodes/${req.params.id}/review`);
});

// ─── GET /:id/editorial/audio ────────────────────────────────────────────────

router.get('/episodes/:id/editorial/audio', (req, res) => {
  const session = db.prepare('SELECT audio_file_path, audio_file_name FROM editorial_sessions WHERE episode_id = ?').get(req.params.id);
  if (!session?.audio_file_path || !existsSync(session.audio_file_path)) {
    return res.status(404).send('No audio file');
  }
  const ext = (session.audio_file_name || 'audio.mp3').split('.').pop().toLowerCase();
  const mimes = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg' };
  res.setHeader('Content-Type', mimes[ext] || 'audio/mpeg');
  res.setHeader('Accept-Ranges', 'bytes');
  res.sendFile(session.audio_file_path, { root: '/' });
});

export default router;
