// ─── Output registry ──────────────────────────────────────────────────────────
// Single source of truth for every content output the app generates.
// Generation, routing, UI rendering, and (later) analytics all derive from here.
// Add an output = add a prompt file + a generator in claude.js + an entry below
// + its DB columns in db.js. Nothing else should hardcode the output list.
//
// Entry shape:
//   key              content_type used in URLs, feedback, and analytics (kebab-case)
//   section          'post_production' | 'distribution'
//   tabLabel         short label for the tab strip
//   heading          panel heading
//   dbColumn         episodes column holding the generated text
//   approvedColumn   episodes column holding the 0/1 approved flag
//   transcriptSource 'raw' | 'final' — which transcript feeds this output
//   host             'rahul' | 'gautham' | null — host-specific outputs (show/hide)
//   modes            null | ['full','lite'] — exposes a mode <select>
//   usesHost         true if the generator takes the active host name
//   generate         (transcript, metadata, extras) => Promise<string>

import {
  generateRahulX, generateGauthamX, generateBrandX,
  generateXArticle, generateLinkedIn, generateYouTube,
  generateYouTubeDescription, generateSubstackShowNotes,
} from './claude.js';

export const OUTPUTS = [
  {
    key: 'rahul-x', section: 'distribution',
    tabLabel: 'Rahul X', heading: "Rahul's Personal X",
    dbColumn: 'rahul_x', approvedColumn: 'rahul_x_approved',
    transcriptSource: 'final', host: 'rahul', modes: null, usesHost: false,
    generate: (t, m) => generateRahulX(t, m),
  },
  {
    key: 'gautham-x', section: 'distribution',
    tabLabel: 'Gautham X', heading: "Gautham's Personal X",
    dbColumn: 'gautham_x', approvedColumn: 'gautham_x_approved',
    transcriptSource: 'final', host: 'gautham', modes: ['full', 'lite'], usesHost: false,
    generate: (t, m, x) => generateGauthamX(t, m, x.mode),
  },
  {
    key: 'brand-x', section: 'distribution',
    tabLabel: 'Brand X', heading: '@shippingwithai Brand X',
    dbColumn: 'brand_x', approvedColumn: 'brand_x_approved',
    transcriptSource: 'final', host: null, modes: null, usesHost: false,
    generate: (t, m) => generateBrandX(t, m),
  },
  {
    key: 'x-article', section: 'distribution',
    tabLabel: 'X Article', heading: 'X Article',
    dbColumn: 'x_article', approvedColumn: 'x_article_approved',
    transcriptSource: 'final', host: null, modes: null, usesHost: true,
    generate: (t, m, x) => generateXArticle(t, m, x.hostName),
  },
  {
    key: 'linkedin', section: 'distribution',
    tabLabel: 'LinkedIn', heading: 'LinkedIn Post',
    dbColumn: 'linkedin_post', approvedColumn: 'linkedin_approved',
    transcriptSource: 'final', host: null, modes: null, usesHost: true,
    generate: (t, m, x) => generateLinkedIn(t, m, x.hostName),
  },
  {
    key: 'youtube', section: 'distribution',
    tabLabel: 'YouTube', heading: 'YouTube Titles & Thumbnails',
    dbColumn: 'youtube', approvedColumn: 'youtube_approved',
    transcriptSource: 'final', host: null, modes: null, usesHost: false,
    generate: (t, m) => generateYouTube(t, m),
  },
  {
    key: 'youtube-description', section: 'distribution',
    tabLabel: 'YT Description', heading: 'YouTube Description',
    dbColumn: 'youtube_description', approvedColumn: 'youtube_description_approved',
    transcriptSource: 'final', host: null, modes: null, usesHost: false,
    generate: (t, m) => generateYouTubeDescription(t, m),
  },
  {
    key: 'substack-show-notes', section: 'distribution',
    tabLabel: 'Show Notes', heading: 'Substack Show Notes',
    dbColumn: 'substack_show_notes', approvedColumn: 'substack_show_notes_approved',
    transcriptSource: 'final', host: null, modes: null, usesHost: false,
    generate: (t, m) => generateSubstackShowNotes(t, m),
  },
];

const BY_KEY = new Map(OUTPUTS.map(o => [o.key, o]));

export function getOutputs(section) {
  return section ? OUTPUTS.filter(o => o.section === section) : OUTPUTS;
}

export function getOutput(key) {
  return BY_KEY.get(key) || null;
}

// Generate a single output and return its text.
export function generateOne(output, transcript, metadata, extras = {}) {
  return output.generate(transcript, metadata, extras);
}

// Generate every output in a section in parallel.
// Returns [{ output, content }] preserving registry order.
export async function generateSection(section, transcript, metadata, extras = {}) {
  const outputs = getOutputs(section);
  const results = await Promise.all(
    outputs.map(o => o.generate(transcript, metadata, extras))
  );
  return outputs.map((output, i) => ({ output, content: results[i] }));
}
