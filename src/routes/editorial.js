import { Router } from 'express';
import { existsSync } from 'fs';
import multer from 'multer';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db from '../db.js';
import { runPass1, runPass2, generateSuggestedEditsMarkdown, generateTuningProposals } from '../services/editorial.js';
import { applyEditorialCuts, cleanTranscriptForCopywriter } from '../services/transcript.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const upload = multer({ dest: join(__dirname, '..', '..', 'uploads') });
const transcriptUpload = multer({ storage: multer.memoryStorage() });
const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// Ensure a stub episode exists for a recording (needed for editorial_sessions FK)
function ensureEpisode(recordingId) {
  let episode = db.prepare('SELECT * FROM episodes WHERE recording_id = ?').get(recordingId);
  if (!episode) {
    const rec = db.prepare('SELECT * FROM recordings WHERE id = ?').get(recordingId);
    if (!rec) return null;
    const result = db.prepare(`
      INSERT INTO episodes (title, guest_name, recording_date, transcript_raw, recording_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(rec.title, rec.guest_name, rec.recording_date, rec.raw_transcript, recordingId);
    episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(result.lastInsertRowid);
  }
  return episode;
}

// Get or create editorial session by recording_id
function getOrCreateSession(recordingId) {
  let session = db.prepare('SELECT * FROM editorial_sessions WHERE recording_id = ?').get(recordingId);
  if (!session) {
    const episode = ensureEpisode(recordingId);
    if (!episode) return null;
    db.prepare('INSERT INTO editorial_sessions (episode_id, recording_id) VALUES (?, ?)').run(episode.id, recordingId);
    session = db.prepare('SELECT * FROM editorial_sessions WHERE recording_id = ?').get(recordingId);
  }
  return session;
}

// ─── Settings router (kept at /settings/editorial) ────────────────────────────

router.get('/settings/editorial', (req, res) => {
  const criteria = db.prepare('SELECT criteria_text FROM show_criteria WHERE id = 1').get()?.criteria_text ?? '';
  const keepList = db.prepare('SELECT * FROM keep_list ORDER BY created_at DESC').all();
  res.render('settings-editorial', { title: 'Editorial Settings', criteria, keepList });
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

// ─── Backward compat: redirect old episode-based editorial URLs ───────────────

router.get('/episodes/:id/editorial', (req, res) => {
  const ep = db.prepare('SELECT recording_id FROM episodes WHERE id = ?').get(req.params.id);
  if (ep?.recording_id) return res.redirect(`/recordings/${ep.recording_id}/editorial`);
  res.redirect('/recordings');
});

// ─── GET /recordings/:id/editorial ───────────────────────────────────────────

router.get('/recordings/:id/editorial', (req, res) => {
  const recording = db.prepare('SELECT * FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) return res.status(404).send('Recording not found');

  const episode = ensureEpisode(req.params.id);
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

  const withSecs = (flags) => flags.map(f => ({
    ...f,
    start_secs: f.start_time ? f.start_time.split(':').reduce((a, v, i) => a + parseFloat(v) * [3600, 60, 1][i], 0) : 0,
    end_secs: f.end_time ? f.end_time.split(':').reduce((a, v, i) => a + parseFloat(v) * [3600, 60, 1][i], 0) : 0,
  }));

  const tuningProposals = JSON.parse(session.tuning_proposals || '{}');

  res.render('editorial', {
    title: `Editorial: ${recording.title}`,
    recording,
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
    tuningProposals,
    tuningStatus: session.tuning_status || 'none',
  });
});

// ─── POST /recordings/:id/editorial/upload-audio ─────────────────────────────

router.post('/recordings/:id/editorial/upload-audio', upload.single('audio'), (req, res) => {
  if (!req.file) return res.redirect(`/recordings/${req.params.id}/editorial`);
  db.prepare(`UPDATE editorial_sessions SET audio_file_path = ?, audio_file_name = ?, updated_at = datetime('now') WHERE recording_id = ?`)
    .run(req.file.path, req.file.originalname, req.params.id);
  res.redirect(`/recordings/${req.params.id}/editorial`);
});

// ─── POST /recordings/:id/editorial/upload-transcript ────────────────────────

router.post('/recordings/:id/editorial/upload-transcript', transcriptUpload.single('transcript'), (req, res) => {
  if (!req.file) return res.redirect(`/recordings/${req.params.id}/editorial`);
  const content = req.file.buffer.toString('utf-8');
  const pass = req.body.pass || '1';

  if (pass === '2') {
    db.prepare(`UPDATE editorial_sessions SET transcript_v1 = ?, status = 'pass1_applied', updated_at = datetime('now') WHERE recording_id = ?`)
      .run(content, req.params.id);
  } else {
    // Save raw transcript to the recording
    db.prepare(`UPDATE recordings SET raw_transcript = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(content, req.params.id);
    // Also update the stub episode's transcript_raw
    const episode = db.prepare('SELECT id FROM episodes WHERE recording_id = ?').get(req.params.id);
    if (episode) {
      db.prepare(`UPDATE episodes SET transcript_raw = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(content, episode.id);
    }
  }

  res.redirect(`/recordings/${req.params.id}/editorial`);
});

// ─── POST /recordings/:id/editorial/run-pass/1 ───────────────────────────────

router.post('/recordings/:id/editorial/run-pass/1', async (req, res, next) => {
  try {
    const recording = db.prepare('SELECT * FROM recordings WHERE id = ?').get(req.params.id);
    if (!recording) return res.status(404).send('Recording not found');

    const transcript = recording.raw_transcript;
    if (!transcript) return res.status(400).send('No transcript available — upload one first');

    const flags = await runPass1(transcript, { title: recording.title, guestName: recording.guest_name }, getShowCriteria());

    db.prepare(`UPDATE editorial_sessions SET pass1_json = ?, pass1_decisions = '{}', status = 'pass1_pending', updated_at = datetime('now') WHERE recording_id = ?`)
      .run(JSON.stringify(flags), req.params.id);

    res.redirect(`/recordings/${req.params.id}/editorial`);
  } catch (err) { next(err); }
});

// ─── POST /recordings/:id/editorial/run-pass/2 ───────────────────────────────

router.post('/recordings/:id/editorial/run-pass/2', async (req, res, next) => {
  try {
    const recording = db.prepare('SELECT * FROM recordings WHERE id = ?').get(req.params.id);
    if (!recording) return res.status(404).send('Recording not found');

    const session = db.prepare('SELECT * FROM editorial_sessions WHERE recording_id = ?').get(req.params.id);
    const transcript = session?.transcript_v1 || recording.raw_transcript;
    if (!transcript) return res.status(400).send('No transcript available');

    const keepList = getKeepList();
    const flags = await runPass2(
      transcript,
      { title: recording.title, guestName: recording.guest_name },
      getShowCriteria(),
      keepList
    );

    db.prepare(`UPDATE editorial_sessions SET pass2_json = ?, pass2_decisions = '{}', status = 'pass2_pending', updated_at = datetime('now') WHERE recording_id = ?`)
      .run(JSON.stringify(flags), req.params.id);

    res.redirect(`/recordings/${req.params.id}/editorial`);
  } catch (err) { next(err); }
});

// ─── POST /recordings/:id/editorial/decide (HTMX) ────────────────────────────

router.post('/recordings/:id/editorial/decide', (req, res) => {
  const { flagId, action, pass, reason } = req.body;
  const recId = req.params.id;
  const sessionCol = pass === '2' ? 'pass2_decisions' : 'pass1_decisions';

  const session = db.prepare('SELECT * FROM editorial_sessions WHERE recording_id = ?').get(recId);
  const decisions = parseDecisions(session?.[sessionCol]);
  decisions[flagId] = { action, reason: reason || undefined };

  db.prepare(`UPDATE editorial_sessions SET ${sessionCol} = ?, updated_at = datetime('now') WHERE recording_id = ?`)
    .run(JSON.stringify(decisions), recId);

  if (action === 'reject' && reason && reason.trim() && pass === '2') {
    const flags = parseFlags(session.pass2_json);
    const flag = flags.find(f => f.id === flagId);
    if (flag) {
      db.prepare('INSERT INTO keep_list (pattern, reason) VALUES (?, ?)').run(flag.text.slice(0, 150), reason.trim());
    }
  }

  const cfg = {
    accept:   { label: 'Cut',      color: '#ba1a1a', bg: '#fde8d6' },
    reject:   { label: 'Keep',     color: '#065f46', bg: '#d1fae5' },
    relocate: { label: 'Relocate', color: '#92400e', bg: '#fef3c7' },
  };
  const { label, color, bg } = cfg[action];
  res.send(`<div id="decision-${flagId}" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
    <span style="font-size:12px;font-weight:600;padding:3px 10px;border-radius:4px;color:${color};background:${bg};">${label}</span>
    <button
      hx-post="/recordings/${recId}/editorial/undecide"
      hx-vals='{"flagId":"${flagId}","pass":"${pass}"}'
      hx-target="#decision-${flagId}"
      hx-swap="outerHTML"
      style="font-size:12px;color:#777587;background:none;border:none;cursor:pointer;padding:0;text-decoration:underline;">Undo</button>
  </div>`);
});

// ─── POST /recordings/:id/editorial/undecide (HTMX) ──────────────────────────

router.post('/recordings/:id/editorial/undecide', (req, res) => {
  const { flagId, pass } = req.body;
  const recId = req.params.id;
  const sessionCol = pass === '2' ? 'pass2_decisions' : 'pass1_decisions';

  const session = db.prepare('SELECT * FROM editorial_sessions WHERE recording_id = ?').get(recId);
  const decisions = parseDecisions(session?.[sessionCol]);
  delete decisions[flagId];

  db.prepare(`UPDATE editorial_sessions SET ${sessionCol} = ?, updated_at = datetime('now') WHERE recording_id = ?`)
    .run(JSON.stringify(decisions), recId);

  const isPass2 = pass === '2';
  const reasonInput = isPass2
    ? `<input id="reason-${flagId}" name="reason" type="text" placeholder="Reason to keep (optional — adds to keep list)" style="flex:1;padding:5px 10px;border:1px solid #c7c4d8;border-radius:5px;font-family:'Inter',sans-serif;font-size:12px;color:#1f1b17;background:#fff;min-width:200px;">`
    : '';
  const rejectInclude = isPass2 ? `hx-include="#reason-${flagId}"` : '';
  const relocateBtn = isPass2 ? `<button
    hx-post="/recordings/${recId}/editorial/decide"
    hx-vals='{"flagId":"${flagId}","action":"relocate","pass":"${pass}"}'
    hx-target="#decision-${flagId}"
    hx-swap="outerHTML"
    style="font-size:12px;font-weight:600;padding:5px 14px;border-radius:5px;background:none;color:#92400e;border:1px solid #fde68a;cursor:pointer;">Relocate</button>` : '';

  res.send(`<div id="decision-${flagId}" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
    ${reasonInput}
    <button
      hx-post="/recordings/${recId}/editorial/decide"
      hx-vals='{"flagId":"${flagId}","action":"accept","pass":"${pass}"}'
      hx-target="#decision-${flagId}"
      hx-swap="outerHTML"
      style="font-size:12px;font-weight:600;padding:5px 14px;border-radius:5px;background:#ba1a1a;color:#fff;border:none;cursor:pointer;">Cut</button>
    <button
      hx-post="/recordings/${recId}/editorial/decide"
      hx-vals='{"flagId":"${flagId}","action":"reject","pass":"${pass}"}'
      ${rejectInclude}
      hx-target="#decision-${flagId}"
      hx-swap="outerHTML"
      style="font-size:12px;font-weight:600;padding:5px 14px;border-radius:5px;background:none;color:#464555;border:1px solid #c7c4d8;cursor:pointer;">Keep</button>
    ${relocateBtn}
  </div>`);
});

// ─── POST /recordings/:id/editorial/apply/1 ──────────────────────────────────

router.post('/recordings/:id/editorial/apply/1', (req, res) => {
  const recording = db.prepare('SELECT * FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) return res.status(404).send('Recording not found');

  const session = db.prepare('SELECT * FROM editorial_sessions WHERE recording_id = ?').get(req.params.id);
  const flags = parseFlags(session.pass1_json);
  const decisions = parseDecisions(session.pass1_decisions);

  const accepted = flags.filter(f => (decisions[f.id]?.action ?? 'accept') === 'accept');
  const rawTranscript = recording.raw_transcript;
  const v1 = applyEditorialCuts(rawTranscript, accepted);

  db.prepare(`UPDATE editorial_sessions SET transcript_v1 = ?, status = 'pass1_applied', updated_at = datetime('now') WHERE recording_id = ?`)
    .run(v1, req.params.id);

  res.redirect(`/recordings/${req.params.id}/editorial`);
});

// ─── POST /recordings/:id/editorial/apply/2 ──────────────────────────────────

router.post('/recordings/:id/editorial/apply/2', (req, res) => {
  const recording = db.prepare('SELECT * FROM recordings WHERE id = ?').get(req.params.id);
  if (!recording) return res.status(404).send('Recording not found');

  const session = db.prepare('SELECT * FROM editorial_sessions WHERE recording_id = ?').get(req.params.id);
  const flags = parseFlags(session.pass2_json);
  const decisions = parseDecisions(session.pass2_decisions);

  const accepted = flags.filter(f => (decisions[f.id]?.action ?? 'accept') === 'accept');
  const baseTranscript = session.transcript_v1 || recording.raw_transcript;
  const v2 = applyEditorialCuts(baseTranscript, accepted);

  db.prepare(`UPDATE editorial_sessions SET transcript_v2 = ?, status = 'pass2_applied', updated_at = datetime('now') WHERE recording_id = ?`)
    .run(v2, req.params.id);

  res.redirect(`/recordings/${req.params.id}/editorial`);
});

// ─── POST /recordings/:id/editorial/send-to-copywriter ───────────────────────

router.post('/recordings/:id/editorial/send-to-copywriter', (req, res) => {
  const session = db.prepare('SELECT * FROM editorial_sessions WHERE recording_id = ?').get(req.params.id);
  if (!session?.transcript_v2) return res.status(400).send('No v2 transcript available');

  const episode = ensureEpisode(req.params.id);
  const clean = cleanTranscriptForCopywriter(session.transcript_v2);
  db.prepare(`UPDATE episodes SET transcript_clean = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(clean, episode.id);

  res.redirect(`/recordings/${req.params.id}/distribution`);
});

// ─── POST /recordings/:id/editorial/submit-feedback ──────────────────────────

router.post('/recordings/:id/editorial/submit-feedback', async (req, res, next) => {
  try {
    const { feedback } = req.body;
    if (!feedback?.trim()) return res.redirect(`/recordings/${req.params.id}/editorial`);

    const criteria = getShowCriteria();
    const proposals = await generateTuningProposals(feedback.trim(), criteria);

    db.prepare(`UPDATE editorial_sessions SET tuning_proposals = ?, tuning_status = 'pending', updated_at = datetime('now') WHERE recording_id = ?`)
      .run(JSON.stringify({ feedback: feedback.trim(), ...proposals }), req.params.id);

    res.redirect(`/recordings/${req.params.id}/editorial`);
  } catch (err) { next(err); }
});

// ─── POST /recordings/:id/editorial/apply-tuning ─────────────────────────────

router.post('/recordings/:id/editorial/apply-tuning', (req, res) => {
  const session = db.prepare('SELECT * FROM editorial_sessions WHERE recording_id = ?').get(req.params.id);
  const proposals = JSON.parse(session?.tuning_proposals || '{}');

  if (req.body.apply_pass1 && proposals.pass1_prompt) {
    db.prepare(`INSERT INTO prompts (name, content, updated_at) VALUES ('editorial-pass1', ?, datetime('now'))
      ON CONFLICT(name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`)
      .run(proposals.pass1_prompt);
  }
  if (req.body.apply_pass2 && proposals.pass2_prompt) {
    db.prepare(`INSERT INTO prompts (name, content, updated_at) VALUES ('editorial-pass2', ?, datetime('now'))
      ON CONFLICT(name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`)
      .run(proposals.pass2_prompt);
  }
  if (req.body.apply_criteria && proposals.show_criteria) {
    db.prepare(`UPDATE show_criteria SET criteria_text = ?, updated_at = datetime('now') WHERE id = 1`)
      .run(proposals.show_criteria);
  }
  if (proposals.keep_list_additions?.length) {
    for (const entry of proposals.keep_list_additions) {
      if (entry.pattern) {
        db.prepare('INSERT INTO keep_list (pattern, reason) VALUES (?, ?)')
          .run(entry.pattern.slice(0, 150), entry.reason || '');
      }
    }
  }

  db.prepare(`UPDATE editorial_sessions SET tuning_status = 'applied', updated_at = datetime('now') WHERE recording_id = ?`)
    .run(req.params.id);

  res.redirect(`/recordings/${req.params.id}/editorial`);
});

// ─── GET /recordings/:id/editorial/skip-tuning ───────────────────────────────

router.get('/recordings/:id/editorial/skip-tuning', (req, res) => {
  db.prepare(`UPDATE editorial_sessions SET tuning_status = 'applied', updated_at = datetime('now') WHERE recording_id = ?`)
    .run(req.params.id);
  res.redirect(`/recordings/${req.params.id}/editorial`);
});

// ─── GET /recordings/:id/editorial/audio ─────────────────────────────────────

router.get('/recordings/:id/editorial/audio', (req, res) => {
  const session = db.prepare('SELECT audio_file_path, audio_file_name FROM editorial_sessions WHERE recording_id = ?').get(req.params.id);
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
