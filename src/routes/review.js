import { Router } from 'express';
import db from '../db.js';
import { isConnected as twitterConnected } from '../services/twitter.js';
import { isConnected as linkedinConnected } from '../services/linkedin.js';

const router = Router();

const APPROVED_BADGE = '<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:500;color:#065f46;background:#d1fae5;padding:4px 10px;border-radius:99px;"><span style="width:7px;height:7px;border-radius:50%;background:#059669;flex-shrink:0;"></span>Approved</span>';
const DRAFT_BADGE    = '<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:500;color:#777587;background:#f0e6e0;padding:4px 10px;border-radius:99px;"><span style="width:7px;height:7px;border-radius:50%;background:#c7c4d8;flex-shrink:0;"></span>Draft</span>';
const SAVED_BADGE    = '<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:500;color:#8c3213;background:#fde8d6;padding:4px 10px;border-radius:99px;"><span style="width:7px;height:7px;border-radius:50%;background:#ba4b1d;flex-shrink:0;"></span>Saved \u2014 re-approve</span>';

const COLUMN_MAP = {
  'rahul-x':   { col: 'rahul_x',      approved: 'rahul_x_approved' },
  'gautham-x': { col: 'gautham_x',    approved: 'gautham_x_approved' },
  'brand-x':   { col: 'brand_x',      approved: 'brand_x_approved' },
  'x-article': { col: 'x_article',    approved: 'x_article_approved' },
  'linkedin':  { col: 'linkedin_post', approved: 'linkedin_approved' },
  'youtube':   { col: 'youtube',       approved: 'youtube_approved' },
};

router.get('/:id/review', (req, res) => {
  const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(req.params.id);
  if (!episode) return res.status(404).send('Episode not found');

  res.render('review', {
    title: `Review: ${episode.title}`,
    episode,
    twitterConnected: twitterConnected(),
    linkedinConnected: linkedinConnected(),
    approvedBadge: APPROVED_BADGE,
    draftBadge: DRAFT_BADGE,
  });
});

router.post('/:id/approve/:platform', (req, res) => {
  const entry = COLUMN_MAP[req.params.platform];
  if (!entry) return res.status(400).send('Invalid platform');

  db.prepare(`UPDATE episodes SET ${entry.approved} = 1, updated_at = datetime('now') WHERE id = ?`)
    .run(req.params.id);

  if (req.headers['hx-request']) return res.send(APPROVED_BADGE);
  res.redirect(`/episodes/${req.params.id}/review`);
});

router.post('/:id/edit/:platform', (req, res) => {
  const entry = COLUMN_MAP[req.params.platform];
  if (!entry) return res.status(400).send('Invalid platform');

  db.prepare(`UPDATE episodes SET ${entry.col} = ?, ${entry.approved} = 0, updated_at = datetime('now') WHERE id = ?`)
    .run(req.body.content, req.params.id);

  if (req.headers['hx-request']) return res.send(SAVED_BADGE);
  res.redirect(`/episodes/${req.params.id}/review`);
});

export default router;
