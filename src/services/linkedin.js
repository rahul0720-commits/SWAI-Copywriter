import db from '../db.js';
import { config } from '../config.js';

const LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const LINKEDIN_USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';
const LINKEDIN_POSTS_URL = 'https://api.linkedin.com/rest/posts';

export function getAuthUrl() {
  const state = Math.random().toString(36).slice(2);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.linkedin.clientId,
    redirect_uri: config.linkedin.callbackUrl,
    state,
    scope: 'openid profile w_member_social',
  });
  return { url: `${LINKEDIN_AUTH_URL}?${params}`, state };
}

export async function handleCallback(code) {
  const tokenRes = await fetch(LINKEDIN_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.linkedin.callbackUrl,
      client_id: config.linkedin.clientId,
      client_secret: config.linkedin.clientSecret,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`LinkedIn token exchange failed: ${err}`);
  }

  const tokenData = await tokenRes.json();
  const { access_token: accessToken, expires_in: expiresIn, refresh_token: refreshToken } = tokenData;
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  const userRes = await fetch(LINKEDIN_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!userRes.ok) throw new Error('Failed to get LinkedIn user info');

  const userData = await userRes.json();
  const memberUrn = `urn:li:person:${userData.sub}`;

  db.prepare(
    `INSERT INTO oauth_tokens (platform, access_token, refresh_token, expires_at, extra_data, updated_at)
     VALUES ('linkedin', ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(platform) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at,
       extra_data = excluded.extra_data,
       updated_at = datetime('now')`
  ).run(accessToken, refreshToken || null, expiresAt, JSON.stringify({ memberUrn, name: userData.name }));

  return { accessToken, memberUrn };
}

export function getCredentials() {
  const row = db.prepare('SELECT * FROM oauth_tokens WHERE platform = ?').get('linkedin');
  if (!row) throw new Error('LinkedIn not connected. Please authorize first.');
  const extraData = JSON.parse(row.extra_data || '{}');
  return { accessToken: row.access_token, memberUrn: extraData.memberUrn };
}

export async function createPost(text) {
  const { accessToken, memberUrn } = getCredentials();

  const res = await fetch(LINKEDIN_POSTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': '202601',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author: memberUrn,
      commentary: text,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LinkedIn post failed: ${err}`);
  }

  const postId = res.headers.get('x-restli-id');
  return { postId, status: res.status };
}

export function isConnected() {
  const row = db.prepare('SELECT id FROM oauth_tokens WHERE platform = ?').get('linkedin');
  return !!row;
}
