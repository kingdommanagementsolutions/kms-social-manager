import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kms-test-'));
const store = await import('../server/store.js');
const svc = await import('../server/service.js');

test('token encryption round-trips and is not plain text', () => {
  const enc = store.encrypt({ access_token: 'secret-abc' });
  assert.ok(!enc.includes('secret-abc'));
  assert.deepEqual(store.decrypt(enc), { access_token: 'secret-abc' });
});

test('validation enforces limits and required media', () => {
  const x = svc.addDemoAccount('x');
  const ig = svc.addDemoAccount('instagram');
  assert.match(svc.validatePost({ text: 'a'.repeat(281), accountIds: [x.id] }).join(), /280/);
  assert.match(svc.validatePost({ text: 'hi', accountIds: [ig.id] }).join(), /Instagram requires/);
  assert.deepEqual(svc.validatePost({ text: 'hi', accountIds: [x.id] }), []);
});

test('publishing marks targets and partial failures', async () => {
  const [x, ig] = svc.listAccounts();
  const p = svc.savePost({ text: 'hello', accountIds: [x.id], status: 'draft' });
  const done = await svc.publishPost(p.id);
  assert.equal(done.status, 'published');
  // Instagram target has no media -> fails; X target succeeds -> partial
  const mixed = svc.savePost({ text: 'mixed', accountIds: [x.id, ig.id], status: 'draft' });
  assert.equal((await svc.publishPost(mixed.id)).status, 'partial');
});

test('scheduling rejects past times and published posts are immutable', async () => {
  const [x] = svc.listAccounts();
  assert.throws(() => svc.savePost({ text: 'late', accountIds: [x.id], status: 'scheduled', scheduledAt: '2000-01-01T00:00:00Z' }), /past/);
  const p = svc.savePost({ text: 'once', accountIds: [x.id], status: 'draft' });
  await svc.publishPost(p.id);
  assert.throws(() => svc.savePost({ text: 'edit', accountIds: [x.id], status: 'draft' }, p.id), /cannot be edited/);
});

test('analytics aggregates demo accounts', async () => {
  const a = await svc.analytics(30);
  assert.equal(a.accounts.length, 2);
  assert.ok(a.totals.followers > 0);
  assert.equal(a.series.dates.length, 30);
});

test('credentials are stored encrypted and fall back to env', async () => {
  const settings = await import('../server/settings.js');
  process.env.X_CLIENT_ID = 'env-id';
  assert.equal(settings.cfg('X_CLIENT_ID'), 'env-id');
  settings.update({ X_CLIENT_ID: 'db-client-id-1234', META_APP_SECRET: 'super-secret-value' });
  assert.equal(settings.cfg('X_CLIENT_ID'), 'db-client-id-1234');
  const st = settings.status().find((k) => k.name === 'META_APP_SECRET');
  assert.equal(st.source, 'database');
  assert.ok(!JSON.stringify(st).includes('super-secret-value'));
  assert.throws(() => settings.update({ NOPE: 'x' }), /Unknown/);
  assert.throws(() => settings.update({ TIKTOK_PRIVACY: 'bad' }), /one of/);
  store.closeDb();
  const raw = fs.readFileSync(path.join(process.env.DATA_DIR, 'kms.db'));
  const wal = fs.existsSync(path.join(process.env.DATA_DIR, 'kms.db-wal')) ? fs.readFileSync(path.join(process.env.DATA_DIR, 'kms.db-wal')) : Buffer.alloc(0);
  assert.ok(!raw.includes('super-secret-value') && !wal.includes('super-secret-value'));
});
