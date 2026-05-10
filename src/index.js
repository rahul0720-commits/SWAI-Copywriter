import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import db from './db.js';
import dashboardRouter from './routes/dashboard.js';
import episodesRouter from './routes/episodes.js';
import generateRouter from './routes/generate.js';
import reviewRouter from './routes/review.js';
import publishRouter from './routes/publish.js';
import authRouter from './routes/auth.js';
import promptsRouter from './routes/prompts.js';
import editorialRouter from './routes/editorial.js';
import introRouter from './routes/intro.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// View engine
app.set('view engine', 'ejs');
app.set('views', join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Routes
app.use('/', dashboardRouter);
app.use(editorialRouter);
app.use('/episodes', episodesRouter);
app.use('/episodes', introRouter);
app.use('/episodes', generateRouter);
app.use('/episodes', reviewRouter);
app.use('/episodes', publishRouter);
app.use('/auth', authRouter);
app.use('/', promptsRouter);

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(500).render('error', {
    title: 'Error',
    message: err.message,
  });
});

app.listen(config.port, () => {
  console.log(`\n  SWAI Copywriter running at http://localhost:${config.port}\n`);
});
