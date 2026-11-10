import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('imports legacy db.json into SQLite once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kms-mig-'));
  process.env.DATA_DIR = dir;
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ accounts: [{ id: 'a1', platform: 'x', name: 'Old' }], posts: [{ id: 'p1', text: 'hi', targets: [] }], inboxState: { 'a1:c': { read: true } }, snapshots: {} }));
  const store = await import('../server/store.js');
  const d = store.data();
  assert.equal(d.accounts[0].name, 'Old');
  assert.equal(d.posts[0].id, 'p1');
  assert.equal(d.inboxState['a1:c'].read, true);
  assert.ok(fs.existsSync(path.join(dir, 'db.json.migrated')));
  d.posts.push({ id: 'p2', text: 'new', targets: [] });
  store.save();
  store.closeDb();
});
