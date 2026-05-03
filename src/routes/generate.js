import { Router } from 'express';
import db from '../db.js';
import {
  generateAllContent,
  generateRahulX,
  generateGauthamX,
  generateBrandX,
  generateXArticle,
  generateLinkedIn,
  generateYouTube,
} from '../services/claude.js';

const router = Router();

router.post('/:id/generate', async (req, res, next) => {
  try {
    const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(req.params.id);
    if (!episode) return res.status(404).send('Episode not found');
    if (!episode.transcript_clean) return res.status(400).send('No transcript available');

    const metadata = { title: episode.title, guestName: episode.guest_name };
    const hostName = req.body.host_name || 'Rahul';
    const content = await generateAllContent(episode.transcript_clean, metadata, hostName);

    db.prepare(
      `UPDATE episodes SET
        rahul_x = ?, gautham_x = ?, brand_x = ?, x_article = ?, linkedin_post = ?, youtube = ?,
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      content.rahulX,
      content.gauthamX,
      content.brandX,
      content.xArticle,
      content.linkedInPost,
      content.youtube,
      req.params.id
    );

    res.redirect(`/episodes/${req.params.id}/review`);
  } catch (err) {
    next(err);
  }
});

const PLATFORM_MAP = {
  'rahul-x':   { fn: (t, m, b) => generateRahulX(t, m),              col: 'rahul_x' },
  'gautham-x': { fn: (t, m, b) => generateGauthamX(t, m, b.mode),    col: 'gautham_x' },
  'brand-x':   { fn: (t, m, b) => generateBrandX(t, m),              col: 'brand_x' },
  'x-article': { fn: (t, m, b) => generateXArticle(t, m, b.hostName), col: 'x_article' },
  'linkedin':  { fn: (t, m, b) => generateLinkedIn(t, m, b.hostName), col: 'linkedin_post' },
  'youtube':   { fn: (t, m, b) => generateYouTube(t, m),             col: 'youtube' },
};

router.post('/:id/regenerate/:platform', async (req, res, next) => {
  try {
    const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(req.params.id);
    if (!episode) return res.status(404).send('Episode not found');
    if (!episode.transcript_clean) return res.status(400).send('No transcript available');

    const entry = PLATFORM_MAP[req.params.platform];
    if (!entry) return res.status(400).send('Invalid platform');

    const metadata = { title: episode.title, guestName: episode.guest_name };
    const extras = {
      mode:     req.body.mode     || 'full',
      hostName: req.body.host_name || 'Rahul',
    };

    const content = await entry.fn(episode.transcript_clean, metadata, extras);
    db.prepare(`UPDATE episodes SET ${entry.col} = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(content, req.params.id);

    res.redirect(`/episodes/${req.params.id}/review`);
  } catch (err) {
    next(err);
  }
});

export default router;
