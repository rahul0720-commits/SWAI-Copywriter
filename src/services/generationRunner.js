// ─── Generation runner ────────────────────────────────────────────────────────
// Shared, UI-independent generation logic so the agent CLI and (later) web routes
// run identical behaviour against the same DB. All output definitions come from the
// registry ([[outputs.js]]); nothing here hardcodes the output list.

import db from '../db.js';
import { getOutput, getOutputs, generateOne, generateSection } from './outputs.js';
import { generateIntroScript } from './claude.js';

const DEFAULT_EXTRAS = { mode: 'full', hostName: 'Rahul' };

function getRecording(id) {
  return db.prepare('SELECT * FROM recordings WHERE id = ?').get(id);
}

function getEpisode(recordingId) {
  return db.prepare('SELECT * FROM episodes WHERE recording_id = ?').get(recordingId);
}

// Recordings with coarse status flags (registry-driven has_content).
export function listRecordings() {
  const cols = getOutputs('distribution').map((o) => `e.${o.dbColumn}`).join(', ');
  return db.prepare(`
    SELECT r.id, r.title, r.guest_name, r.created_at,
      CASE WHEN r.intro_script IS NOT NULL THEN 1 ELSE 0 END AS has_intro,
      CASE WHEN e.transcript_clean IS NOT NULL THEN 1 ELSE 0 END AS has_final,
      CASE WHEN COALESCE(${cols}) IS NOT NULL THEN 1 ELSE 0 END AS has_content
    FROM recordings r
    LEFT JOIN episodes e ON e.recording_id = r.id
    ORDER BY r.created_at DESC
  `).all();
}

// Per-output generated/approved status for one recording.
export function recordingStatus(recordingId) {
  const recording = getRecording(recordingId);
  if (!recording) return null;
  const episode = getEpisode(recordingId);
  const outputs = getOutputs('distribution').map((o) => ({
    key: o.key,
    label: o.tabLabel,
    section: o.section,
    generated: !!(episode && episode[o.dbColumn]),
    approved: !!(episode && episode[o.approvedColumn]),
  }));
  return {
    recording,
    hasIntro: !!recording.intro_script,
    hasFinalTranscript: !!(episode && episode.transcript_clean),
    outputs,
  };
}

export async function generateIntroForRecording(recordingId) {
  const recording = getRecording(recordingId);
  if (!recording) throw new Error(`Recording ${recordingId} not found`);
  if (!recording.raw_transcript) throw new Error('No raw transcript on this recording — upload one in the app first');

  const content = await generateIntroScript(recording.raw_transcript, {
    title: recording.title,
    guestName: recording.guest_name,
  });
  db.prepare(`UPDATE recordings SET intro_script = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(content, recordingId);
  return content;
}

function requireFinalEpisode(recordingId) {
  const episode = getEpisode(recordingId);
  if (!episode) throw new Error('No distribution episode yet — set a final transcript in the app first');
  if (!episode.transcript_clean) throw new Error('No final transcript — set one in the app first');
  return episode;
}

export async function generateOutputForRecording(recordingId, key, extras = {}) {
  const output = getOutput(key);
  if (!output) {
    const valid = getOutputs('distribution').map((o) => o.key).join(', ');
    throw new Error(`Unknown output "${key}". Valid keys: ${valid}`);
  }
  const episode = requireFinalEpisode(recordingId);

  const metadata = { title: episode.title, guestName: episode.guest_name };
  const content = await generateOne(output, episode.transcript_clean, metadata, { ...DEFAULT_EXTRAS, ...extras });
  db.prepare(`UPDATE episodes SET ${output.dbColumn} = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(content, episode.id);
  return { key: output.key, content };
}

export async function generateAllForRecording(recordingId, extras = {}) {
  const episode = requireFinalEpisode(recordingId);
  const metadata = { title: episode.title, guestName: episode.guest_name };
  const results = await generateSection('distribution', episode.transcript_clean, metadata, { ...DEFAULT_EXTRAS, ...extras });

  for (const r of results) {
    db.prepare(`UPDATE episodes SET ${r.output.dbColumn} = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(r.content, episode.id);
  }
  return results.map((r) => ({ key: r.output.key, content: r.content }));
}
