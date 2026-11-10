import { api, mediaKind } from '../http.js';
import { G, metaAuthUrl, metaConfigured, metaUserToken } from './metaCommon.js';

export const meta = {
  id: 'facebook', name: 'Facebook Pages', short: 'f', color: '#1877F2',
  charLimit: 63206, mediaRequired: false,
  features: { publish: true, posts: true, comments: true, followers: true },
  env: ['META_APP_ID', 'META_APP_SECRET'],
  docs: 'https://developers.facebook.com/docs/pages-api',
  note: 'Connects every Page you administer. Needs a Meta app with Pages permissions.',
};
export const configured = metaConfigured;

const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_manage_engagement', 'pages_read_user_content'];
export const authUrl = ({ state, redirectUri }) => metaAuthUrl({ state, redirectUri, scopes: SCOPES });

export async function connect({ code, redirectUri }) {
  const user = await metaUserToken(code, redirectUri);
  const pages = await api(`${G}/me/accounts`, {
    query: { access_token: user, fields: 'id,name,access_token,picture{url}', limit: 100 },
  });
  return pages.data.map((p) => ({
    externalId: p.id, name: p.name, handle: p.name, avatar: p.picture?.data?.url,
    tokens: { access_token: p.access_token },
  }));
}

export async function publish(acct, { text, mediaUrl }) {
  const t = acct.tokens.access_token;
  let res;
  if (mediaUrl && mediaKind(mediaUrl) === 'video') {
    res = await api(`${G}/${acct.externalId}/videos`, { method: 'POST', form: { access_token: t, file_url: mediaUrl, description: text } });
  } else if (mediaUrl) {
    res = await api(`${G}/${acct.externalId}/photos`, { method: 'POST', form: { access_token: t, url: mediaUrl, caption: text } });
  } else {
    res = await api(`${G}/${acct.externalId}/feed`, { method: 'POST', form: { access_token: t, message: text } });
  }
  const id = res.post_id || res.id;
  return { id, url: `https://www.facebook.com/${id}` };
}

export async function fetchProfile(acct) {
  const r = await api(`${G}/${acct.externalId}`, { query: { access_token: acct.tokens.access_token, fields: 'followers_count,fan_count' } });
  return { followers: r.followers_count ?? r.fan_count ?? null };
}

export async function fetchPosts(acct, limit = 25) {
  const r = await api(`${G}/${acct.externalId}/posts`, {
    query: {
      access_token: acct.tokens.access_token, limit,
      fields: 'id,message,created_time,permalink_url,full_picture,shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)',
    },
  });
  return r.data.map((p) => ({
    id: p.id, text: p.message || '', url: p.permalink_url, image: p.full_picture, publishedAt: p.created_time,
    metrics: { likes: p.reactions?.summary?.total_count ?? 0, comments: p.comments?.summary?.total_count ?? 0, shares: p.shares?.count ?? 0, views: null },
  }));
}

export async function fetchComments(acct, posts) {
  const out = [];
  await Promise.allSettled(posts.slice(0, 8).map(async (p) => {
    const r = await api(`${G}/${p.id}/comments`, {
      query: { access_token: acct.tokens.access_token, fields: 'id,message,created_time,from,permalink_url', order: 'reverse_chronological', limit: 10 },
    });
    for (const c of r.data) {
      out.push({ externalId: c.id, author: c.from?.name || 'Facebook user', text: c.message || '', createdAt: c.created_time, url: c.permalink_url, postText: p.text });
    }
  }));
  return out;
}

export async function reply(acct, item, text) {
  const r = await api(`${G}/${item.externalId}/comments`, { method: 'POST', form: { access_token: acct.tokens.access_token, message: text } });
  return { id: r.id };
}
