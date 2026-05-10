import { Router } from 'express';
import db from '../db.js';
import { isConnected as twitterConnected } from '../services/twitter.js';
import { isConnected as linkedinConnected } from '../services/linkedin.js';
import { config } from '../config.js';

const router = Router();

router.get('/', (req, res) => {
  res.redirect('/recordings');
});

export default router;
