import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import db from '../db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(__dirname, '..', 'prompts');
const client = new Anthropic({ apiKey: config.anthropicApiKey });

function getPrompt(name, file) {
  const row = db.prepare('SELECT content FROM prompts WHERE name = ?').get(name);
  return row ? row.content : readFileSync(join(promptsDir, file), 'utf-8');
}

function extractObject(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

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
  const template = getPrompt('editorial-pass1', 'editorial-pass1.txt');
  const system = template
    .replace('{show_criteria}', showCriteria)
    .replace('{episode_title}', metadata.title || 'Untitled')
    .replace('{guest_name}', metadata.guestName || 'N/A')
    .replace('{transcript}', transcript);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system,
    messages: [{ role: 'user', content: 'Run Pass 1 hard-cut analysis.' }],
  });
  return extractJson(response.content[0].text);
}

export async function runPass2(transcript, metadata, showCriteria, keepList) {
  const template = getPrompt('editorial-pass2', 'editorial-pass2.txt');
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
    model: 'claude-sonnet-4-6',
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

// Single content-generation prompt improver, driven by manual feedback on the
// outputs that prompt produced. Analogous to generateTuningProposals but for one
// standalone prompt (Rahul X, YouTube, Substack show notes, ...).
export async function improveContentPrompt(label, currentPrompt, feedbackText) {
  const system = `You improve a single AI prompt used to generate "${label}" content for a podcast repurposing tool.
You will be given the current prompt and feedback from a human editor about the outputs it produced.
Propose minimal, targeted edits that fix the specific issues raised. Do not rewrite parts that aren't called out.
Keep the same structure and any template tokens (e.g. {transcript}, {host_name}, {mode}) intact.
Return ONLY a valid JSON object, no prose outside it, in this exact shape:
{
  "proposed_prompt": "the full updated prompt text, or null if no change is warranted",
  "summary": "one sentence describing what you changed and why"
}`;

  const userMsg = `CURRENT PROMPT:
${currentPrompt}

EDITOR FEEDBACK ON RECENT OUTPUTS:
${feedbackText}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system,
    messages: [{ role: 'user', content: userMsg }],
  });

  const result = extractObject(response.content[0].text);
  if (!result) return null;
  return {
    proposed: result.proposed_prompt || null,
    summary: result.summary || '',
  };
}

export async function generateTuningProposals(feedback, showCriteria) {
  const pass1Prompt = getPrompt('editorial-pass1', 'editorial-pass1.txt');
  const pass2Prompt = getPrompt('editorial-pass2', 'editorial-pass2.txt');

  const system = `You are an expert at improving AI prompts for podcast editorial work.
You will be given the current prompts used for two editorial passes, the current show criteria, and feedback from a human editor about what went wrong in the latest session.
Your job is to propose minimal, targeted improvements to fix the specific issues raised.

Rules:
- Only change what the feedback specifically calls out. Don't rewrite things that aren't broken.
- Keep the same structure and format of each prompt.
- For keep_list_additions, only add entries if the feedback mentions specific content Claude shouldn't have flagged.
- Return ONLY a valid JSON object, no explanation outside it.

Return this exact JSON shape:
{
  "pass1_prompt": "full updated prompt text, or null if no changes needed",
  "pass2_prompt": "full updated prompt text, or null if no changes needed",
  "show_criteria": "full updated criteria text, or null if no changes needed",
  "keep_list_additions": [{"pattern": "short excerpt or description", "reason": "why to keep"}],
  "summary": "one sentence: what you changed and why"
}`;

  const userMsg = `CURRENT PASS 1 PROMPT:
${pass1Prompt}

CURRENT PASS 2 PROMPT:
${pass2Prompt}

CURRENT SHOW CRITERIA:
${showCriteria}

EDITOR FEEDBACK:
${feedback}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system,
    messages: [{ role: 'user', content: userMsg }],
  });

  const proposals = extractObject(response.content[0].text);
  if (!proposals) return null;

  return {
    pass1_prompt: proposals.pass1_prompt || null,
    pass2_prompt: proposals.pass2_prompt || null,
    show_criteria: proposals.show_criteria || null,
    keep_list_additions: proposals.keep_list_additions || [],
    summary: proposals.summary || '',
    current_pass1: pass1Prompt,
    current_pass2: pass2Prompt,
    current_criteria: showCriteria,
  };
}
