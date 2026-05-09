import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(__dirname, '..', 'prompts');
const client = new Anthropic({ apiKey: config.anthropicApiKey });

function extractJson(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    return JSON.parse(match[0]);
  } catch {
    return [];
  }
}

export async function runPass1(transcript, metadata, showCriteria) {
  const template = readFileSync(join(promptsDir, 'editorial-pass1.txt'), 'utf-8');
  const system = template
    .replace('{show_criteria}', showCriteria)
    .replace('{episode_title}', metadata.title || 'Untitled')
    .replace('{guest_name}', metadata.guestName || 'N/A')
    .replace('{transcript}', transcript);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    system,
    messages: [{ role: 'user', content: 'Run Pass 1 hard-cut analysis.' }],
  });
  return extractJson(response.content[0].text);
}

export async function runPass2(transcript, metadata, showCriteria, keepList) {
  const template = readFileSync(join(promptsDir, 'editorial-pass2.txt'), 'utf-8');
  const keepListText = keepList.length === 0
    ? 'None yet.'
    : keepList.map(k => `- "${k.pattern}" — ${k.reason}`).join('\n');

  const system = template
    .replace('{show_criteria}', showCriteria)
    .replace('{keep_list}', keepListText)
    .replace('{episode_title}', metadata.title || 'Untitled')
    .replace('{guest_name}', metadata.guestName || 'N/A')
    .replace('{transcript}', transcript);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    system,
    messages: [{ role: 'user', content: 'Run Pass 2 soft-cut analysis.' }],
  });
  return extractJson(response.content[0].text);
}

export function generateSuggestedEditsMarkdown(episode, pass1Flags, pass2Flags, pass1Decisions, pass2Decisions) {
  const lines = [];
  lines.push(`# ${episode.title} — Suggested Edits`);
  if (episode.guest_name) lines.push(`Guest: ${episode.guest_name}`);
  lines.push('');

  const p1Accepted = pass1Flags.filter(f => (pass1Decisions[f.id]?.action ?? 'accept') === 'accept');
  const p2Accepted = pass2Flags.filter(f => (pass2Decisions[f.id]?.action ?? 'accept') === 'accept');
  const p2Relocated = pass2Flags.filter(f => pass2Decisions[f.id]?.action === 'relocate');

  lines.push(`## Pass 1: Hard Cuts (${p1Accepted.length} of ${pass1Flags.length} accepted)`);
  lines.push('');
  if (p1Accepted.length === 0) {
    lines.push('_No hard cuts._');
  } else {
    for (const f of p1Accepted) {
      lines.push(`~~[${f.start_time} – ${f.end_time}] ${f.speaker}: "${f.text}"~~`);
      lines.push(`> CUT · ${f.category} · ${f.reason}`);
      lines.push('');
    }
  }

  lines.push(`## Pass 2: Soft Cuts (${p2Accepted.length} of ${pass2Flags.length} accepted)`);
  lines.push('');
  if (p2Accepted.length === 0) {
    lines.push('_No soft cuts._');
  } else {
    for (const f of p2Accepted) {
      lines.push(`~~[${f.start_time} – ${f.end_time}] ${f.speaker}: "${f.text}"~~`);
      lines.push(`> CUT · ${f.category} · ${f.confidence} · ${f.reason}`);
      if (f.audio_signal) lines.push(`> Audio: ${f.audio_signal}`);
      lines.push('');
    }
  }

  if (p2Relocated.length > 0) {
    lines.push('## Relocations');
    lines.push('');
    for (const f of p2Relocated) {
      lines.push(`[${f.start_time} – ${f.end_time}] ${f.speaker}: "${f.text}"`);
      lines.push(`> RELOCATE · ${f.reason}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}
