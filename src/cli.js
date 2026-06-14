#!/usr/bin/env node
// ─── SWAI Copywriter — agent CLI ──────────────────────────────────────────────
// Drive content generation from the terminal against the SAME SQLite DB the web
// app uses, so the app and the agent stay in sync. This is the "agent" half of the
// hybrid interface (app for the team, CLI/agent for fast ad-hoc runs).
//
//   node src/cli.js list                         list recordings + status
//   node src/cli.js outputs                      list output keys
//   node src/cli.js show <recordingId>           per-output status for a recording
//   node src/cli.js intro <recordingId>          generate the intro script (raw transcript)
//   node src/cli.js generate <recordingId> <key|all>   generate one output, or all distribution
//   node src/cli.js feedback <recordingId> <key> up|down [note]   record feedback

import db from './db.js';
import { getOutputs, getOutput } from './services/outputs.js';
import { currentPromptVersion } from './services/promptStore.js';
import {
  listRecordings, recordingStatus,
  generateIntroForRecording, generateOutputForRecording, generateAllForRecording,
} from './services/generationRunner.js';

const [, , cmd, ...args] = process.argv;

function usage() {
  console.log(`SWAI Copywriter — agent CLI

Usage:
  node src/cli.js list
  node src/cli.js outputs
  node src/cli.js show <recordingId>
  node src/cli.js intro <recordingId>
  node src/cli.js generate <recordingId> <key|all>
  node src/cli.js feedback <recordingId> <key> up|down [note...]

Output keys (distribution):
  ${getOutputs('distribution').map((o) => o.key).join(', ')}
`);
}

function snippet(text, n = 220) {
  const s = (text || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function cmdList() {
  const rows = listRecordings();
  if (!rows.length) return console.log('No recordings yet.');
  console.log('ID   Intro  Final  Content  Title');
  for (const r of rows) {
    const mark = (v) => (v ? ' ✓ ' : ' · ');
    console.log(`${String(r.id).padEnd(4)}${mark(r.has_intro)}   ${mark(r.has_final)}   ${mark(r.has_content)}     ${r.title}${r.guest_name ? ` (with ${r.guest_name})` : ''}`);
  }
}

function cmdOutputs() {
  for (const o of getOutputs('distribution')) {
    console.log(`${o.key.padEnd(22)} ${o.heading}  [${o.transcriptSource} transcript]`);
  }
}

function cmdShow(id) {
  const status = recordingStatus(id);
  if (!status) return console.error(`Recording ${id} not found`);
  console.log(`"${status.recording.title}"${status.recording.guest_name ? ` with ${status.recording.guest_name}` : ''}`);
  console.log(`  Intro script:     ${status.hasIntro ? 'generated ✓' : 'not yet'}`);
  console.log(`  Final transcript: ${status.hasFinalTranscript ? 'set ✓' : 'not set'}`);
  console.log('  Distribution outputs:');
  for (const o of status.outputs) {
    const state = !o.generated ? 'not generated' : o.approved ? 'approved ✓' : 'draft';
    console.log(`    ${o.key.padEnd(22)} ${state}`);
  }
}

async function cmdIntro(id) {
  console.log(`Generating intro script for recording ${id}…`);
  const content = await generateIntroForRecording(id);
  console.log('\nDone. Intro script:\n');
  console.log(content);
}

async function cmdGenerate(id, key) {
  if (!id || !key) return usage();
  if (key === 'all') {
    console.log(`Generating ALL distribution outputs for recording ${id}…`);
    const results = await generateAllForRecording(id);
    console.log(`\nDone — generated ${results.length} outputs:`);
    for (const r of results) console.log(`  • ${r.key}: ${snippet(r.content, 80)}`);
    return;
  }
  console.log(`Generating "${key}" for recording ${id}…`);
  const { content } = await generateOutputForRecording(id, key);
  console.log('\nDone:\n');
  console.log(content);
}

function cmdFeedback(id, key, dir, noteParts) {
  if (!id || !key || !['up', 'down'].includes(dir)) return usage();
  if (!getOutput(key)) return console.error(`Unknown output "${key}"`);
  const rating = dir === 'up' ? 1 : -1;
  const note = (noteParts || []).join(' ').trim() || null;
  const episode = db.prepare('SELECT id FROM episodes WHERE recording_id = ?').get(id);
  db.prepare(`INSERT INTO content_feedback (recording_id, episode_id, content_type, rating, note, prompt_version) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, episode?.id || null, key, rating, note, currentPromptVersion(key));
  console.log(`Recorded ${dir === 'up' ? '👍' : '👎'} on ${key}${note ? ` — "${note}"` : ''}. Tune the prompt from it on the Taste Prompts page.`);
}

async function main() {
  switch (cmd) {
    case 'list': return cmdList();
    case 'outputs': return cmdOutputs();
    case 'show': return cmdShow(args[0]);
    case 'intro': return cmdIntro(args[0]);
    case 'generate': return cmdGenerate(args[0], args[1]);
    case 'feedback': return cmdFeedback(args[0], args[1], args[2], args.slice(3));
    default: return usage();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('Error:', err.message); process.exit(1); });
