import { Router } from 'express';
import db from '../db.js';
import { isConnected as twitterConnected } from '../services/twitter.js';
import { isConnected as linkedinConnected } from '../services/linkedin.js';
import { config } from '../config.js';

const router = Router();

router.get('/', (req, res) => {
  const episodes = db
    .prepare('SELECT * FROM episodes ORDER BY created_at DESC')
    .all();

  res.render('dashboard', {
    title: 'SWAI Copywriter',
    episodes,
    twitterConnected: twitterConnected(),
    linkedinConnected: linkedinConnected(),
    substackUrl: config.substackUrl,
  });
});

export default router;
