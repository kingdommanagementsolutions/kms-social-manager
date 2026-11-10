// API credentials for the social platforms. Stored encrypted in SQLite (never returned to the browser);
// falls back to environment variables so existing .env setups keep working.
import { getSetting, setSetting, deleteSetting, hasSetting } from './store.js';

export const KEYS = [
  { name: 'META_APP_ID', label: 'App ID', platforms: ['facebook', 'instagram'] },
  { name: 'META_APP_SECRET', label: 'App secret', platforms: ['facebook', 'instagram'], secret: true },
  { name: 'X_CLIENT_ID', label: 'Client ID', platforms: ['x'] },
  { name: 'X_CLIENT_SECRET', label: 'Client secret', platforms: ['x'], secret: true },
  { name: 'TIKTOK_CLIENT_KEY', label: 'Client key', platforms: ['tiktok'] },
  { name: 'TIKTOK_CLIENT_SECRET', label: 'Client secret', platforms: ['tiktok'], secret: true },
  { name: 'TIKTOK_PRIVACY', label: 'Post visibility', platforms: ['tiktok'], visible: true, options: ['SELF_ONLY', 'FOLLOWER_OF_CREATOR', 'MUTUAL_FOLLOW_FRIENDS', 'PUBLIC_TO_EVERYONE'] },
  { name: 'LINKEDIN_CLIENT_ID', label: 'Client ID', platforms: ['linkedin'] },
  { name: 'LINKEDIN_CLIENT_SECRET', label: 'Client secret', platforms: ['linkedin'], secret: true },
];
const byName = Object.fromEntries(KEYS.map((k) => [k.name, k]));

/** Value for a credential: database first, then environment. */
export const cfg = (name) => getSetting(name) ?? process.env[name] ?? '';

export function status() {
  return KEYS.map((k) => {
    const inDb = hasSetting(k.name);
    const v = cfg(k.name);
    return {
      ...k, set: !!v, source: inDb ? 'database' : v ? 'env' : null,
      hint: v && !k.visible ? `••••${v.length >= 8 ? v.slice(-4) : ''}` : undefined,
      value: k.visible ? v : undefined,
    };
  });
}

/** values: { NAME: 'new value' | '' | null }. Empty string leaves a credential unchanged; null removes it. */
export function update(values) {
  for (const [name, v] of Object.entries(values)) {
    const k = byName[name];
    if (!k) throw Object.assign(new Error(`Unknown setting ${name}`), { status: 400 });
    if (v === '' || v === undefined) continue;
    if (v !== null) {
      if (typeof v !== 'string' || v.length > 500 || /[\r\n]/.test(v)) throw Object.assign(new Error(`Invalid value for ${name}`), { status: 400 });
      if (k.options && !k.options.includes(v.trim())) throw Object.assign(new Error(`${name} must be one of ${k.options.join(', ')}`), { status: 400 });
    }
  }
  for (const [name, v] of Object.entries(values)) {
    if (v === '' || v === undefined) continue;
    if (v === null) deleteSetting(name); else setSetting(name, v.trim());
  }
}

/** Copy credentials found in the environment into the encrypted database (first start). Returns names imported. */
export function importEnv() {
  const imported = [];
  for (const k of KEYS) {
    if (process.env[k.name] && !hasSetting(k.name)) { setSetting(k.name, process.env[k.name]); imported.push(k.name); }
  }
  return imported;
}
