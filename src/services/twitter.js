import { TwitterApi } from 'twitter-api-v2';
import crypto from 'crypto';
import db from '../db.js';
import { config } from '../config.js';

// In-memory store for PKCE verifiers (per-session)
const pkceStore = new Map();

export function getAuthUrl() {
  const client = new TwitterApi({
    clientId: config.twitter.clientId,
    clientSecret: config.twitter.clientSecret,
  });

  const { url, codeVerifier, state } = client.generateOAuth2AuthLink(
    config.twitter.callbackUrl,
    { scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'] }
  );

  pkceStore.set(state, codeVerifier);
  return { url, state };
}

export async function handleCallback(code, state) {
  const codeVerifier = pkceStore.get(state);
  if (!codeVerifier) throw new Error('Invalid OAuth state — please try connecting again.');
  pkceStore.delete(state);

  const client = new TwitterApi({
    clientId: config.twitter.clientId,
    clientSecret: config.twitter.clientSecret,
  });

  const { accessToken, refreshToken, expiresIn } = await client.loginWithOAuth2({
    code,
    codeVerifier,
    redirectUri: config.twitter.callbackUrl,
  });

  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  db.prepare(
    `INSERT INTO oauth_tokens (platform, access_token, refresh_token, expires_at, updated_at)
     VALUES ('twitter', ?, ?, ?, datetime('now'))
     ON CONFLICT(platform) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       updated_at = datetime('now')`
  ).run(accessToken, refreshToken, expiresAt);

  return { accessToken, refreshToken, expiresAt };
}

export async function getClient() {
  const row = db.prepare('SELECT * FROM oauth_tokens WHERE platform = ?').get('twitter');
  if (!row) throw new Error('Twitter not connected. Please authorize first.');

  let { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt } = row;

  if (new Date(expiresAt) < new Date(Date.now() + 5 * 60 * 1000)) {
    const client = new TwitterApi({
      clientId: config.twitter.clientId,
      clientSecret: config.twitter.clientSecret,
    });

    const refreshed = await client.refreshOAuth2Token(refreshToken);
    accessToken = refreshed.accessToken;
    refreshToken = refreshed.refreshToken;
    expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();

    db.prepare(
      `UPDATE oauth_tokens SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = datetime('now')
       WHERE platform = 'twitter'`
    ).run(accessToken, refreshToken, expiresAt);
  }

  return new TwitterApi(accessToken);
}

export async function postThread(tweets) {
  const client = await getClient();
  return client.v2.tweetThread(tweets);
}

export function isConnected() {
  const row = db.prepare('SELECT id FROM oauth_tokens WHERE platform = ?').get('twitter');
  return !!row;
}
