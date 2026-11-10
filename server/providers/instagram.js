import { api, mediaKind } from '../http.js';
import { G, metaAuthUrl, metaConfigured, metaUserToken } from './metaCommon.js';

export const meta = {
  id: 'instagram', name: 'Instagram', short: 'ig', color: '#E1306C',
  charLimit: 2200, mediaRequired: true,
  features: { publish: true, posts: true, comments: true, followers: true },
  env: ['META_APP_ID', 'META_APP_SECRET'],
  docs: 'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login',
  note: 'Instagram Business/Creator account linked to a Facebook Page. Posts need a public image or video URL.',
};
export const configured = metaConfigured;

const SCOPES = ['instagram_basic', 'instagram_content_publish', 'instagram_manage_comments', 'pages_show_list', 'pages_read_engagement'];
export const authUrl = ({ state, redirectUri }) => metaAuthUrl({ state, redirectUri, scopes: SCOPES });

export async function connect({ code, redirectUri }) {
  const user = await metaUserToken(code, redirectUri);
  const pages = await api(`${G}/me/accounts`, {
    query: { access_token: user, limit: 100, fields: 'access_token,instagram_business_account{id,username,name,profile_picture_url}' },
  });
  return pages.data.filter((p) => p.instagram_business_account).map((p) => {
    const ig = p.instagram_business_account;
    return {
      externalId: ig.id, name: ig.name || ig.username, handle: `@${ig.username}`, avatar: ig.profile_picture_url,
      tokens: { access_token: p.access_token },
    };
  });
}

async function waitReady(id, token) {
  for (let i = 0; i < 40; i++) {
    const r = await api(`${G}/${id}`, { query: { access_token: token, fields: 'status_code' } });
    if (r.status_code === 'FINISHED') return;
    if (r.status_code === 'ERROR' || r.status_code === 'EXPIRED') throw new Error(`Instagram media processing failed (${r.status_code})`);
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error('Instagram media processing timed out');
}

export async function publish(acct, { text, mediaUrl }) {
  if (!mediaUrl) throw new Error('Instagram posts require an image or video');
  const t = acct.tokens.access_token;
  const form = { access_token: t, caption: text };
  if (mediaKind(mediaUrl) === 'video') Object.assign(form, { media_type: 'REELS', video_url: mediaUrl });
  else form.image_url = mediaUrl;
  const container = await api(`${G}/${acct.externalId}/media`, { method: 'POST', form });
  await waitReady(container.id, t);
  const pub = await api(`${G}/${acct.externalId}/media_publish`, { method: 'POST', form: { access_token: t, creation_id: container.id } });
  const info = await api(`${G}/${pub.id}`, { query: { access_token: t, fields: 'permalink' } }).catch(() => ({}));
  return { id: pub.id, url: info.permalink };
}

export async function fetchProfile(acct) {
  const r = await api(`${G}/${acct.externalId}`, { query: { access_token: acct.tokens.access_token, fields: 'followers_count' } });
  return { followers: r.followers_count ?? null };
}

export async function fetchPosts(acct, limit = 25) {
  const r = await api(`${G}/${acct.externalId}/media`, {
    query: { access_token: acct.tokens.access_token, limit, fields: 'id,caption,timestamp,like_count,comments_count,permalink,media_url,thumbnail_url' },
  });
  return r.data.map((p) => ({
    id: p.id, text: p.caption || '', url: p.permalink, image: p.thumbnail_url || p.media_url, publishedAt: p.timestamp,
    metrics: { likes: p.like_count ?? 0, comments: p.comments_count ?? 0, shares: 0, views: null },
  }));
}

export async function fetchComments(acct, posts) {
  const out = [];
  await Promise.allSettled(posts.slice(0, 8).map(async (p) => {
    const r = await api(`${G}/${p.id}/comments`, { query: { access_token: acct.tokens.access_token, fields: 'id,text,timestamp,username', limit: 10 } });
    for (const c of r.data) out.push({ externalId: c.id, author: `@${c.username}`, text: c.text || '', createdAt: c.timestamp, url: p.url, postText: p.text });
  }));
  return out;
}

export async function reply(acct, item, text) {
  const r = await api(`${G}/${item.externalId}/replies`, { method: 'POST', form: { access_token: acct.tokens.access_token, message: text } });
  return { id: r.id };
}
