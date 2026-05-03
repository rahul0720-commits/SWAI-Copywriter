import { Router } from 'express';
import db from '../db.js';
import { postThread } from '../services/twitter.js';
import { createPost as createLinkedInPost } from '../services/linkedin.js';

const router = Router();

router.post('/:id/publish', async (req, res, next) => {
  try {
    const episode = db.prepare('SELECT * FROM episodes WHERE id = ?').get(req.params.id);
    if (!episode) return res.status(404).send('Episode not found');

    const results = [];

    if (episode.twitter_approved && !episode.twitter_published) {
      try {
        const tweets = JSON.parse(episode.twitter_thread);
        const result = await postThread(tweets);
        db.prepare(`UPDATE episodes SET twitter_published = 1, updated_at = datetime('now') WHERE id = ?`).run(episode.id);
        db.prepare('INSERT INTO publish_log (episode_id, platform, status, response_data) VALUES (?, ?, ?, ?)').run(episode.id, 'twitter', 'success', JSON.stringify(result));
        results.push({ platform: 'twitter', status: 'success' });
      } catch (err) {
        db.prepare('INSERT INTO publish_log (episode_id, platform, status, error_message) VALUES (?, ?, ?, ?)').run(episode.id, 'twitter', 'error', err.message);
        results.push({ platform: 'twitter', status: 'error', message: err.message });
      }
    }

    if (episode.linkedin_approved && !episode.linkedin_published) {
      try {
        const result = await createLinkedInPost(episode.linkedin_post);
        db.prepare(`UPDATE episodes SET linkedin_published = 1, updated_at = datetime('now') WHERE id = ?`).run(episode.id);
        db.prepare('INSERT INTO publish_log (episode_id, platform, status, response_data) VALUES (?, ?, ?, ?)').run(episode.id, 'linkedin', 'success', JSON.stringify(result));
        results.push({ platform: 'linkedin', status: 'success' });
      } catch (err) {
        db.prepare('INSERT INTO publish_log (episode_id, platform, status, error_message) VALUES (?, ?, ?, ?)').run(episode.id, 'linkedin', 'error', err.message);
        results.push({ platform: 'linkedin', status: 'error', message: err.message });
      }
    }

    if (episode.substack_approved && episode.substack_status === 'draft') {
      db.prepare(`UPDATE episodes SET substack_status = 'ready', updated_at = datetime('now') WHERE id = ?`).run(episode.id);
      results.push({ platform: 'substack', status: 'ready' });
    }

    if (req.headers['hx-request']) {
      const html = results
        .map((r) => {
          const color = r.status === 'success' ? 'green' : r.status === 'error' ? 'red' : 'blue';
          return `<div class="px-3 py-2 bg-${color}-50 text-${color}-800 rounded mb-2">${r.platform}: ${r.status}${r.message ? ` — ${r.message}` : ''}</div>`;
        })
        .join('');
      return res.send(html || '<div class="px-3 py-2 bg-gray-50 text-gray-600 rounded">Nothing to publish. Approve content first.</div>');
    }

    res.redirect(`/episodes/${req.params.id}/review`);
  } catch (err) {
    next(err);
  }
});

export default router;
