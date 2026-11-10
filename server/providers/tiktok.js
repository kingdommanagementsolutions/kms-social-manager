import { api, qs } from '../http.js';

export const meta = {
  id: 'tiktok', name: 'TikTok', short: '♪', color: '#FE2C55',
  charLimit: 2200, mediaRequired: true, videoOnly: true,
  features: { publish: true, posts: true, comments: false, followers: true },
  env: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
  docs: 'https://developers.tiktok.com/doc/content-posting-api-get-started',
  note: 'Video posts from a public URL. Unaudited apps can only post privately (set TIKTOK_PRIVACY after audit). TikTok has no comment API.',
};
export const configured = () => !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);

const API = 'https://open.tiktokapis.com/v2';
export const authUrl = ({ state, redirectUri }) =>
  'https://www.tiktok.com/v2/auth/authorize/?' + qs({
    client_key: process.env.TIKTOK_CLIENT_KEY, response_type: 'code', state, redirect_uri: redirectUri,
    scope: 'user.info.basic,user.info.profile,user.info.stats,video.publish,video.list',
  });

const tokensFrom = (t) => ({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000 });
const bearer = (a) => ({ authorization: `Bearer ${a.tokens.access_token}` });
const tokenForm = (extra) => ({ client_key: process.env.TIKTOK_CLIENT_KEY, client_secret: process.env.TIKTOK_CLIENT_SECRET, ...extra });

export async function connect({ code, redirectUri }) {
  const t = await api(`${API}/oauth/token/`, { method: 'POST', form: tokenForm({ code, grant_type: 'authorization_code', redirect_uri: redirectUri }) });
  const me = await api(`${API}/user/info/`, { headers: { authorization: `Bearer ${t.access_token}` }, query: { fields: 'open_id,display_name,avatar_url,username' } });
  const u = me.data.user;
  return [{ externalId: u.open_id, name: u.display_name, handle: u.username ? `@${u.username}` : u.display_name, avatar: u.avatar_url, tokens: tokensFrom(t) }];
}

export async function refresh(acct) {
  const t = await api(`${API}/oauth/token/`, { method: 'POST', form: tokenForm({ grant_type: 'refresh_token', refresh_token: acct.tokens.refresh_token }) });
  return tokensFrom(t);
}

export async function publish(acct, { text, mediaUrl }) {
  if (!mediaUrl) throw new Error('TikTok posts require a video URL');
  const r = await api(`${API}/post/publish/video/init/`, {
    method: 'POST', headers: bearer(acct),
    json: {
      post_info: { title: text.slice(0, 2200), privacy_level: process.env.TIKTOK_PRIVACY || 'SELF_ONLY', disable_comment: false },
      source_info: { source: 'PULL_FROM_URL', video_url: mediaUrl },
    },
  });
  if (r.error?.code && r.error.code !== 'ok') throw new Error(r.error.message);
  return { id: r.data.publish_id, url: null };
}

export async function fetchProfile(acct) {
  const r = await api(`${API}/user/info/`, { headers: bearer(acct), query: { fields: 'follower_count' } });
  return { followers: r.data?.user?.follower_count ?? null };
}

export async function fetchPosts(acct, limit = 20) {
  const r = await api(`${API}/video/list/`, {
    method: 'POST', headers: bearer(acct),
    query: { fields: 'id,title,video_description,create_time,share_url,cover_image_url,view_count,like_count,comment_count,share_count' },
    json: { max_count: Math.min(limit, 20) },
  });
  return (r.data?.videos || []).map((v) => ({
    id: v.id, text: v.title || v.video_description || '', url: v.share_url, image: v.cover_image_url,
    publishedAt: new Date(v.create_time * 1000).toISOString(),
    metrics: { likes: v.like_count ?? 0, comments: v.comment_count ?? 0, shares: v.share_count ?? 0, views: v.view_count ?? 0 },
  }));
}
