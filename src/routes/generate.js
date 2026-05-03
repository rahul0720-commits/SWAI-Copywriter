import { Router } from 'express';
import db from '../db.js';
import { generateAllContent } from '../services/claude.js';

const router = Router();

router.post('/:id/generate', async (req, res, next) => {
  try {
    const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(req.params.id);
    if (!episode) return res.status(404).send('Episode not found');
    if (!episode.transcript_clean) return res.status(400).send('No transcript available');

    const metadata = { title: episode.title, guestName: episode.guest_name };
    const content = await generateAllContent(episode.transcript_clean, metadata);

    db.prepare(
      `UPDATE episodes SET
        blog_post = ?,
        twitter_thread = ?,
        linkedin_post = ?,
        substack_draft = ?,
        youtube_options = ?,
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      content.blogPost,
      JSON.stringify(content.twitterThread),
      content.linkedinPost,
      content.substackDraft,
      JSON.stringify(content.youtubeOptions),
      req.params.id
    );

    res.redirect(`/episodes/${req.params.id}/review`);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/regenerate/:platform', async (req, res, next) => {
  try {
    const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(req.params.id);
    if (!episode) return res.status(404).send('Episode not found');

    const metadata = { title: episode.title, guestName: episode.guest_name };
    const { platform } = req.params;

    let content;
    let column;

    if (platform === 'blog') {
      const { generateBlogPost } = await import('../services/claude.js');
      content = await generateBlogPost(episode.transcript_clean, metadata);
      column = 'blog_post';
    } else if (platform === 'twitter') {
      const { generateTwitterThread } = await import('../services/claude.js');
      content = JSON.stringify(await generateTwitterThread(episode.transcript_clean, metadata));
      column = 'twitter_thread';
    } else if (platform === 'linkedin') {
      const { generateLinkedInPost } = await import('../services/claude.js');
      content = await generateLinkedInPost(episode.transcript_clean, metadata);
      column = 'linkedin_post';
    } else if (platform === 'youtube') {
      const { generateYouTubeOptions } = await import('../services/claude.js');
      content = JSON.stringify(await generateYouTubeOptions(episode.transcript_clean, metadata));
      column = 'youtube_options';
    } else {
      return res.status(400).send('Invalid platform');
    }

    db.prepare(`UPDATE episodes SET ${column} = ?, updated_at = datetime('now') WHERE id = ?`).run(
      content,
      req.params.id
    );

    res.redirect(`/episodes/${req.params.id}/review`);
  } catch (err) {
    next(err);
  }
});

export default router;
