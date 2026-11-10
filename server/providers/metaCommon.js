import { api, qs } from '../http.js';

export const V = 'v21.0';
export const G = `https://graph.facebook.com/${V}`;
export const metaConfigured = () => !!(process.env.META_APP_ID && process.env.META_APP_SECRET);

export const metaAuthUrl = ({ state, redirectUri, scopes }) =>
  `https://www.facebook.com/${V}/dialog/oauth?` +
  qs({ client_id: process.env.META_APP_ID, redirect_uri: redirectUri, state, scope: scopes.join(','), response_type: 'code' });

// code -> short-lived user token -> long-lived user token (page tokens derived from it never expire)
export async function metaUserToken(code, redirectUri) {
  const short = await api(`${G}/oauth/access_token`, {
    query: { client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET, redirect_uri: redirectUri, code },
  });
  const long = await api(`${G}/oauth/access_token`, {
    query: {
      grant_type: 'fb_exchange_token', client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET, fb_exchange_token: short.access_token,
    },
  });
  return long.access_token;
}
