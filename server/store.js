import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './config.js';

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
const DB_FILE = path.join(DATA_DIR, 'kms.db');
const LEGACY_JSON = path.join(DATA_DIR, 'db.json');

/* ---------- master key & encryption ---------- */
function loadKey() {
  if (process.env.APP_SECRET) return crypto.scryptSync(process.env.APP_SECRET, 'kms-social-manager', 32);
  const f = path.join(DATA_DIR, '.secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return crypto.scryptSync(fs.readFileSync(f, 'utf8'), 'kms-social-manager', 32);
}
const KEY = loadKey();

// AES-256-GCM: tokens and API credentials never sit in the database as plain text.
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
export const uid = (n = 8) => crypto.randomBytes(n).toString('hex');

/* ---------- SQLite ---------- */
const sql = new DatabaseSync(DB_FILE);
sql.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS docs (coll TEXT NOT NULL, id TEXT NOT NULL, doc TEXT NOT NULL, PRIMARY KEY (coll, id));
  CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
`);
for (const f of [DB_FILE, DB_FILE + '-wal', DB_FILE + '-shm']) { try { fs.chmodSync(f, 0o600); } catch { /* not created yet */ } }

const q = {
  all: sql.prepare('SELECT coll, id, doc FROM docs ORDER BY rowid'),
  upsert: sql.prepare('INSERT INTO docs (coll, id, doc) VALUES (?, ?, ?) ON CONFLICT (coll, id) DO UPDATE SET doc = excluded.doc'),
  del: sql.prepare('DELETE FROM docs WHERE coll = ? AND id = ?'),
  getSetting: sql.prepare('SELECT value FROM settings WHERE name = ?'),
  putSetting: sql.prepare('INSERT INTO settings (name, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'),
  delSetting: sql.prepare('DELETE FROM settings WHERE name = ?'),
};
const tx = (fn) => { sql.exec('BEGIN'); try { fn(); sql.exec('COMMIT'); } catch (e) { sql.exec('ROLLBACK'); throw e; } };

/* ---------- application data (loaded into memory, written through on save()) ---------- */
const db = { accounts: [], posts: [], inboxState: {}, snapshots: {} };
const saved = new Map(); // "coll\0id" -> json last written

for (const { coll, id, doc } of q.all.all()) {
  const v = JSON.parse(doc);
  if (Array.isArray(db[coll])) db[coll].push(v); else db[coll][id] = v;
  saved.set(`${coll}\0${id}`, doc);
}

function snapshot() {
  const out = new Map();
  for (const coll of ['accounts', 'posts']) for (const v of db[coll]) out.set(`${coll}\0${v.id}`, JSON.stringify(v));
  for (const coll of ['inboxState', 'snapshots']) for (const [id, v] of Object.entries(db[coll])) out.set(`${coll}\0${id}`, JSON.stringify(v));
  return out;
}

export const data = () => db;
export function save() {
  const now = snapshot();
  tx(() => {
    for (const [k, json] of now) if (saved.get(k) !== json) { const [c, id] = k.split('\0'); q.upsert.run(c, id, json); }
    for (const k of saved.keys()) if (!now.has(k)) { const [c, id] = k.split('\0'); q.del.run(c, id); }
  });
  saved.clear();
  for (const [k, v] of now) saved.set(k, v);
}

// One-time import of the pre-SQLite JSON file.
if (!saved.size && fs.existsSync(LEGACY_JSON)) {
  try {
    const old = JSON.parse(fs.readFileSync(LEGACY_JSON, 'utf8'));
    for (const k of Object.keys(db)) if (old[k]) db[k] = old[k];
    save();
    fs.renameSync(LEGACY_JSON, LEGACY_JSON + '.migrated');
    console.log('Migrated data/db.json into SQLite (kept as db.json.migrated)');
  } catch (e) { console.error('Could not migrate db.json:', e.message); }
}

/* ---------- encrypted settings (API credentials) ---------- */
export function getSetting(name) {
  const row = q.getSetting.get(name);
  if (!row) return undefined;
  try { return decrypt(row.value).v; } catch { return undefined; }
}
export const hasSetting = (name) => !!q.getSetting.get(name);
export function setSetting(name, value) { q.putSetting.run(name, encrypt({ v: value }), new Date().toISOString()); }
export function deleteSetting(name) { q.delSetting.run(name); }
export function closeDb() { sql.close(); }
