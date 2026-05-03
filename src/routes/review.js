import { Router } from 'express';
import db from '../db.js';
import { config } from '../config.js';
import { isConnected as twitterConnected } from '../services/twitter.js';
import { isConnected as linkedinConnected } from '../services/linkedin.js';

const router = Router();

router.get('/:id/review', (req, res) => {
  const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(req.params.id);
  if (!episode) return res.status(404).send('Episode not found');

  let twitterThread = [];
  try { twitterThread = episode.twitter_thread ? JSON.parse(episode.twitter_thread) : []; } catch { twitterThread = []; }

  let youtubeOptions = { titles: [], thumbnails: [] };
  try { youtubeOptions = episode.youtube_options ? JSON.parse(episode.youtube_options) : { titles: [], thumbnails: [] }; } catch { youtubeOptions = { titles: [], thumbnails: [] }; }

  res.render('review', {
    title: `Review: ${episode.title}`,
    episode,
    twitterThread,
    youtubeOptions,
    twitterConnected: twitterConnected(),
    linkedinConnected: linkedinConnected(),
    substackUrl: config.substackUrl,
  });
});

router.post('/:id/approve/:platform', (req, res) => {
  const { platform } = req.params;
  const validPlatforms = ['blog', 'twitter', 'linkedin', 'substack', 'youtube'];
  if (!validPlatforms.includes(platform)) return res.status(400).send('Invalid platform');

  db.prepare(`UPDATE episodes SET ${platform}_approved = 1, updated_at = datetime('now') WHERE id = ?`).run(
    req.params.id
  );

  if (req.headers['hx-request']) {
    return res.send('<span class="inline-block px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">Approved</span>');
  }
  res.redirect(`/episodes/${req.params.id}/review`);
});

router.post('/:id/edit/:platform', (req, res) => {
  const { platform } = req.params;
  const { content } = req.body;

  const columnMap = {
    blog: 'blog_post',
    twitter: 'twitter_thread',
    linkedin: 'linkedin_post',
    substack: 'substack_draft',
    youtube: 'youtube_options',
  };

  const column = columnMap[platform];
  if (!column) return res.status(400).send('Invalid platform');

  db.prepare(`UPDATE episodes SET ${column} = ?, ${platform}_approved = 0, updated_at = datetime('now') WHERE id = ?`).run(
    content,
    req.params.id
  );

  if (req.headers['hx-request']) {
    return res.send('<span class="inline-block px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">Saved (re-approve)</span>');
  }
  res.redirect(`/episodes/${req.params.id}/review`);
});

export default router;
