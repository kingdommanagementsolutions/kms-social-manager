import { api, qs } from '../http.js';
import { cfg } from '../settings.js';

export const meta = {
  id: 'linkedin', name: 'LinkedIn', short: 'in', color: '#0A66C2',
  charLimit: 3000, mediaRequired: false,
  features: { publish: true, posts: false, comments: false, followers: false },
  env: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
  docs: 'https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api',
  note: 'Publishes text posts to your member profile. LinkedIn restricts reading posts/analytics to approved partners.',
};
export const configured = () => !!(cfg('LINKEDIN_CLIENT_ID') && cfg('LINKEDIN_CLIENT_SECRET'));

export const authUrl = ({ state, redirectUri }) =>
  'https://www.linkedin.com/oauth/v2/authorization?' + qs({
    response_type: 'code', client_id: cfg('LINKEDIN_CLIENT_ID'), redirect_uri: redirectUri, state, scope: 'openid profile w_member_social',
  });

export async function connect({ code, redirectUri }) {
  const t = await api('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    form: { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: cfg('LINKEDIN_CLIENT_ID'), client_secret: cfg('LINKEDIN_CLIENT_SECRET') },
  });
  const me = await api('https://api.linkedin.com/v2/userinfo', { headers: { authorization: `Bearer ${t.access_token}` } });
  return [{
    externalId: me.sub, name: me.name, handle: me.name, avatar: me.picture,
    tokens: { access_token: t.access_token, expires_at: Date.now() + t.expires_in * 1000 },
  }];
}

export async function publish(acct, { text }) {
  const res = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${acct.tokens.access_token}`, 'content-type': 'application/json',
      'LinkedIn-Version': '202411', 'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author: `urn:li:person:${acct.externalId}`, commentary: text, visibility: 'PUBLIC',
      distribution: { feedDistributionType: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
  const id = res.headers.get('x-restli-id');
  return { id, url: id ? `https://www.linkedin.com/feed/update/${id}` : null };
}
