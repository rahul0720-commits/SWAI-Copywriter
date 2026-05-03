import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';
import db from '../db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(__dirname, '..', 'prompts');

const client = new Anthropic({ apiKey: config.anthropicApiKey });

function loadPrompt(name, filename, subs = {}) {
  const row = db.prepare('SELECT content FROM prompts WHERE name = ?').get(name);
  let prompt = row ? row.content : readFileSync(join(promptsDir, filename), 'utf-8');
  for (const [k, v] of Object.entries(subs)) {
    prompt = prompt.replaceAll(`{{${k}}}`, v);
  }
  return prompt;
}

function userMessage(transcript, metadata) {
  return `Episode: "${metadata.title}"${metadata.guestName ? ` with ${metadata.guestName}` : ''}\n\nTranscript:\n${transcript}`;
}

export async function generateRahulX(transcript, metadata) {
  const system = loadPrompt('rahul-x', 'rahul-x.txt');
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system,
    messages: [{ role: 'user', content: userMessage(transcript, metadata) }],
  });
  return response.content[0].text;
}

export async function generateGauthamX(transcript, metadata, mode = 'full') {
  const system = loadPrompt('gautham-x', 'gautham-x.txt', { mode });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system,
    messages: [{ role: 'user', content: userMessage(transcript, metadata) }],
  });
  return response.content[0].text;
}

export async function generateBrandX(transcript, metadata) {
  const system = loadPrompt('brand-x', 'brand-x.txt');
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system,
    messages: [{ role: 'user', content: userMessage(transcript, metadata) }],
  });
  return response.content[0].text;
}

export async function generateXArticle(transcript, metadata, hostName = 'Rahul') {
  const system = loadPrompt('x-article', 'x-article.txt', { host_name: hostName });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system,
    messages: [{ role: 'user', content: userMessage(transcript, metadata) }],
  });
  return response.content[0].text;
}

export async function generateLinkedIn(transcript, metadata, hostName = 'Rahul') {
  const system = loadPrompt('linkedin', 'linkedin.txt', { host_name: hostName });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system,
    messages: [{ role: 'user', content: userMessage(transcript, metadata) }],
  });
  return response.content[0].text;
}

export async function generateYouTube(transcript, metadata) {
  const system = loadPrompt('youtube', 'youtube.txt');
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system,
    messages: [{ role: 'user', content: userMessage(transcript, metadata) }],
  });
  return response.content[0].text;
}

export async function generateAllContent(transcript, metadata, hostName = 'Rahul') {
  const [rahulX, gauthamX, brandX, xArticle, linkedInPost, youtube] = await Promise.all([
    generateRahulX(transcript, metadata),
    generateGauthamX(transcript, metadata, 'full'),
    generateBrandX(transcript, metadata),
    generateXArticle(transcript, metadata, hostName),
    generateLinkedIn(transcript, metadata, hostName),
    generateYouTube(transcript, metadata),
  ]);
  return { rahulX, gauthamX, brandX, xArticle, linkedInPost, youtube };
}
