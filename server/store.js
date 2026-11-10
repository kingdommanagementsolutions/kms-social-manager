import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const DB_FILE = path.join(DATA_DIR, 'db.json');

function loadKey() {
  if (process.env.APP_SECRET) return crypto.scryptSync(process.env.APP_SECRET, 'kms-social-manager', 32);
  const f = path.join(DATA_DIR, '.secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return crypto.scryptSync(fs.readFileSync(f, 'utf8'), 'kms-social-manager', 32);
}
const KEY = loadKey();

// AES-256-GCM so OAuth tokens never sit in db.json as plain text.
export function encrypt(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
}
export function decrypt(str) {
  if (!str) return {};
  const [iv, tag, ct] = str.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString('utf8'));
}
export const hmac = (s) => crypto.createHmac('sha256', KEY).update(s).digest('hex');

const empty = () => ({ accounts: [], posts: [], inboxState: {}, snapshots: {} });
let db;
try { db = { ...empty(), ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch { db = empty(); }

export const data = () => db;
export function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DB_FILE);
}
export const uid = (n = 8) => crypto.randomBytes(n).toString('hex');
