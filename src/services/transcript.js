import SrtParser from 'srt-parser-2';

function timeToSeconds(t) {
  const parts = t.replace(',', '.').split(':');
  return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
}

function detectFormat(raw) {
  if (/\d{2}:\d{2}:\d{2}[,.]\d{3} --> \d{2}:\d{2}:\d{2}[,.]\d{3}/.test(raw)) return 'srt';
  return 'txt';
}

function applySrtCuts(content, cutRanges) {
  const blocks = content.split(/\n\s*\n/).filter(b => b.trim());
  const kept = [];

  for (const block of blocks) {
    const tsMatch = block.match(/(\d{1,2}:\d{2}:\d{2})[,.]\d{3} --> (\d{1,2}:\d{2}:\d{2})[,.]\d{3}/);
    if (!tsMatch) continue;

    const segStart = timeToSeconds(tsMatch[1]);
    const inCutRange = cutRanges.some(r => segStart >= r.start - 1 && segStart <= r.end + 1);
    if (!inCutRange) kept.push(block);
  }

  return kept
    .map((block, i) => block.replace(/^\d+/, String(i + 1)))
    .join('\n\n');
}

function applyTxtCuts(content, flags) {
  let result = content;
  for (const f of flags) {
    if (f.text && f.text.length > 20) {
      result = result.replace(f.text.slice(0, 100), '');
    }
  }
  return result.replace(/\n{3,}/g, '\n\n').trim();
}

export function applyEditorialCuts(rawTranscript, acceptedFlags) {
  if (!acceptedFlags || acceptedFlags.length === 0) return rawTranscript;

  const cutRanges = acceptedFlags
    .filter(f => f.start_time && f.end_time)
    .map(f => ({ start: timeToSeconds(f.start_time), end: timeToSeconds(f.end_time) }));

  if (detectFormat(rawTranscript) === 'srt') {
    return applySrtCuts(rawTranscript, cutRanges);
  }
  return applyTxtCuts(rawTranscript, acceptedFlags);
}

export function cleanTranscriptForCopywriter(rawTranscript) {
  const fmt = detectFormat(rawTranscript);
  const buf = Buffer.from(rawTranscript);
  if (fmt === 'srt') return parseSrt(buf);
  return parseTxt(buf);
}

/**
 * Parse an SRT file buffer into clean conversation text
 */
export function parseSrt(buffer) {
  const parser = new SrtParser();
  const text = buffer.toString('utf-8');
  const parsed = parser.fromSrt(text);
  return parsed.map((item) => item.text.replace(/<[^>]*>/g, '').trim()).filter(Boolean).join(' ');
}

/**
 * Parse a plain text transcript (Riverside TXT format)
 * Preserves speaker labels if present
 */
export function parseTxt(buffer) {
  const text = buffer.toString('utf-8');
  // Remove timestamps like [00:00:00] or (00:00:00) or 00:00:00
  return text
    .replace(/[\[\(]?\d{1,2}:\d{2}(:\d{2})?[\]\)]?\s*/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Auto-detect format and parse transcript
 */
export function parseTranscript(buffer, filename) {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'srt') {
    return parseSrt(buffer);
  }
  return parseTxt(buffer);
}
