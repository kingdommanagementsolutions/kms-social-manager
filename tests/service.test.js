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
