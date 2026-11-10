import crypto from 'node:crypto';
import { PASSWORD as ENV_PASSWORD } from './config.js';
import { getSetting, setSetting, deleteSetting } from './store.js';

const NAME = 'DASHBOARD_PASSWORD_HASH';
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${crypto.scryptSync(pw, salt, 64).toString('base64')}`;
}
export const setPassword = (pw) => setSetting(NAME, hashPassword(pw));
export const clearPassword = () => deleteSetting(NAME);

/** Password protection is on if a hash is stored (preferred) or DASHBOARD_PASSWORD is set in the environment. */
export const authRequired = () => !!(getSetting(NAME) || ENV_PASSWORD);

export function verifyPassword(pw) {
  const stored = getSetting(NAME);
  if (!stored) return !!ENV_PASSWORD && safeEq(String(pw), ENV_PASSWORD);
  const [, salt, hash] = stored.split('$');
  const test = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'base64'));
}

/** Mixed into session cookies so changing the password signs everyone out. */
export const sessionTag = () => (getSetting(NAME) || ENV_PASSWORD || '').slice(-24);
