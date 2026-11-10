import { api, qs } from '../http.js';

export const meta = {
  id: 'x', name: 'X (Twitter)', short: 'X', color: '#111111',
  charLimit: 280, mediaRequired: false,
  features: { publish: true, posts: true, comments: true, followers: true },
  env: ['X_CLIENT_ID', 'X_CLIENT_SECRET'],
  docs: 'https://docs.x.com/x-api/introduction',
  note: 'Text posts and replies. Reading timelines/mentions requires a paid X API tier. Media upload is not included.',
};
export const configured = () => !!process.env.X_CLIENT_ID;
export const usesPkce = true;

const BASE = 'https://api.x.com/2';
const basic = () => (process.env.X_CLIENT_SECRET
  ? { authorization: 'Basic ' + Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString('base64') }
  : {});

export const authUrl = ({ state, redirectUri, challenge }) =>
  'https://x.com/i/oauth2/authorize?' + qs({
    response_type: 'code', client_id: process.env.X_CLIENT_ID, redirect_uri: redirectUri,
    scope: 'tweet.read tweet.write users.read offline.access', state,
    code_challenge: challenge, code_challenge_method: 'S256',
  });

const tokensFrom = (t) => ({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in || 7200) * 1000 });

export async function connect({ code, redirectUri, verifier }) {
  const t = await api(`${BASE}/oauth2/token`, {
    method: 'POST', headers: basic(),
    form: { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, client_id: process.env.X_CLIENT_ID },
  });
  const me = await api(`${BASE}/users/me`, { headers: { authorization: `Bearer ${t.access_token}` }, query: { 'user.fields': 'profile_image_url,username,name' } });
  return [{ externalId: me.data.id, name: me.data.name, handle: `@${me.data.username}`, avatar: me.data.profile_image_url, tokens: tokensFrom(t) }];
}

export async function refresh(acct) {
  const t = await api(`${BASE}/oauth2/token`, {
    method: 'POST', headers: basic(),
    form: { grant_type: 'refresh_token', refresh_token: acct.tokens.refresh_token, client_id: process.env.X_CLIENT_ID },
  });
  return tokensFrom(t);
}

const auth = (a) => ({ authorization: `Bearer ${a.tokens.access_token}` });

export async function publish(acct, { text }) {
  const r = await api(`${BASE}/tweets`, { method: 'POST', headers: auth(acct), json: { text } });
  return { id: r.data.id, url: `https://x.com/${acct.handle.replace('@', '')}/status/${r.data.id}` };
}

export async function fetchProfile(acct) {
  const r = await api(`${BASE}/users/me`, { headers: auth(acct), query: { 'user.fields': 'public_metrics' } });
  return { followers: r.data.public_metrics?.followers_count ?? null };
}

export async function fetchPosts(acct, limit = 25) {
  const r = await api(`${BASE}/users/${acct.externalId}/tweets`, {
    headers: auth(acct),
    query: { max_results: Math.max(5, Math.min(limit, 100)), exclude: 'retweets,replies', 'tweet.fields': 'created_at,public_metrics' },
  });
  return (r.data || []).map((t) => ({
    id: t.id, text: t.text, url: `https://x.com/${acct.handle.replace('@', '')}/status/${t.id}`, publishedAt: t.created_at,
    metrics: {
      likes: t.public_metrics.like_count, comments: t.public_metrics.reply_count,
      shares: t.public_metrics.retweet_count + t.public_metrics.quote_count, views: t.public_metrics.impression_count ?? null,
    },
  }));
}

export async function fetchComments(acct) {
  const r = await api(`${BASE}/users/${acct.externalId}/mentions`, {
    headers: auth(acct),
    query: { max_results: 25, expansions: 'author_id', 'tweet.fields': 'created_at', 'user.fields': 'username,name' },
  });
  const users = Object.fromEntries((r.includes?.users || []).map((u) => [u.id, u]));
  return (r.data || []).map((t) => ({
    externalId: t.id, author: `@${users[t.author_id]?.username || 'unknown'}`, text: t.text, createdAt: t.created_at,
    url: `https://x.com/i/status/${t.id}`, postText: '',
  }));
}

export async function reply(acct, item, text) {
  const r = await api(`${BASE}/tweets`, { method: 'POST', headers: auth(acct), json: { text, reply: { in_reply_to_tweet_id: item.externalId } } });
  return { id: r.data.id };
}
