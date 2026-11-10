import { data, save, uid, encrypt, decrypt } from './store.js';
import { providers, publicMeta } from './providers/index.js';
import * as demo from './demo.js';

const db = data();
const DAY = 86_400_000;

/* ---------- accounts ---------- */
export const publicAccount = (a) => ({ id: a.id, platform: a.platform, name: a.name, handle: a.handle, avatar: a.avatar, demo: !!a.demo, connectedAt: a.connectedAt });
export const listAccounts = () => db.accounts.map(publicAccount);
const getAccount = (id) => db.accounts.find((a) => a.id === id);

export function addAccounts(platform, list, { isDemo = false } = {}) {
  const added = [];
  for (const item of list) {
    let a = db.accounts.find((x) => x.platform === platform && x.externalId === item.externalId && !!x.demo === isDemo);
    if (!a) { a = { id: uid(5), platform, connectedAt: new Date().toISOString(), demo: isDemo }; db.accounts.push(a); }
    Object.assign(a, { externalId: item.externalId, name: item.name, handle: item.handle, avatar: item.avatar });
    if (item.tokens) a.tokensEnc = encrypt(item.tokens);
    added.push(a);
  }
  save();
  return added.map(publicAccount);
}

export function addDemoAccount(platform) {
  if (!providers[platform]) throw httpError(400, 'Unknown platform');
  const n = db.accounts.filter((a) => a.demo && a.platform === platform).length;
  if (n) throw httpError(409, 'A demo account for this platform already exists');
  return addAccounts(platform, [{ externalId: 'demo-' + platform, ...demo.demoNames(platform) }], { isDemo: true })[0];
}

export function removeAccount(id) {
  const i = db.accounts.findIndex((a) => a.id === id);
  if (i < 0) throw httpError(404, 'Account not found');
  db.accounts.splice(i, 1);
  delete db.snapshots[id];
  cache.clear();
  save();
}

// Returns the account with decrypted tokens, refreshing them first if they are about to expire.
async function liveAccount(a) {
  const acct = { ...a, tokens: decrypt(a.tokensEnc) };
  const p = providers[a.platform];
  if (p.refresh && acct.tokens.expires_at && Date.now() > acct.tokens.expires_at - 120_000) {
    acct.tokens = await p.refresh(acct);
    a.tokensEnc = encrypt(acct.tokens);
    save();
  }
  return acct;
}

export function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

/* ---------- cached reads ---------- */
const cache = new Map();
async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

const tag = (a, item) => ({ ...item, platform: a.platform, accountId: a.id, accountName: a.name });

export function accountPosts(a) {
  return cached(`posts:${a.id}`, 120_000, async () => {
    let items;
    if (a.demo) {
      items = demo.posts(a);
      for (const p of db.posts) for (const t of p.targets) {
        if (t.accountId === a.id && t.status === 'published') {
          items.push({ id: `local-${p.id}`, text: p.text, url: t.url, image: p.mediaUrl, publishedAt: t.publishedAt, metrics: { likes: 0, comments: 0, shares: 0, views: 0 } });
        }
      }
    } else {
      const p = providers[a.platform];
      items = p.fetchPosts ? await p.fetchPosts(await liveAccount(a)) : [];
    }
    return items.map((i) => tag(a, i)).sort((x, y) => (x.publishedAt < y.publishedAt ? 1 : -1));
  });
}

export function accountProfile(a) {
  return cached(`profile:${a.id}`, 300_000, async () => {
    const r = a.demo ? demo.profile(a) : providers[a.platform].fetchProfile ? await providers[a.platform].fetchProfile(await liveAccount(a)) : { followers: null };
    if (!a.demo && r.followers != null) {
      const day = new Date().toISOString().slice(0, 10);
      (db.snapshots[a.id] ||= {})[day] = r.followers;
      save();
    }
    return r;
  });
}

function followerSeries(a, days) {
  if (a.demo) return demo.followerSeries(a, days);
  const snaps = db.snapshots[a.id] || {};
  const cutoff = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  return Object.entries(snaps).filter(([d]) => d >= cutoff).sort().map(([date, followers]) => ({ date, followers }));
}

/* Run a per-account loader, collecting failures instead of failing the whole request. */
async function eachAccount(filter, fn) {
  const errors = [];
  const accounts = db.accounts.filter((a) => !filter || filter(a));
  const results = await Promise.all(accounts.map(async (a) => {
    try { return await fn(a); } catch (e) { errors.push({ accountId: a.id, platform: a.platform, name: a.name, message: e.message }); return null; }
  }));
  return { results, errors, accounts };
}

export async function feed({ accountId, limit = 60 } = {}) {
  const { results, errors } = await eachAccount((a) => !accountId || a.id === accountId, accountPosts);
  const items = results.flat().filter(Boolean).sort((x, y) => (x.publishedAt < y.publishedAt ? 1 : -1)).slice(0, limit);
  return { items, errors };
}

/* ---------- analytics ---------- */
const dateKey = (iso) => iso.slice(0, 10);
export async function analytics(days = 30) {
  days = Math.max(7, Math.min(365, days));
  const since = Date.now() - days * DAY;
  const dates = [];
  for (let d = days - 1; d >= 0; d--) dates.push(new Date(Date.now() - d * DAY).toISOString().slice(0, 10));

  const { results, errors, accounts } = await eachAccount(null, async (a) => {
    const [posts, prof] = await Promise.all([accountPosts(a), accountProfile(a)]);
    return { a, posts: posts.filter((p) => new Date(p.publishedAt).getTime() >= since), prof, fol: followerSeries(a, days) };
  });

  const eng = Object.fromEntries(dates.map((d) => [d, {}]));
  const fol = Object.fromEntries(dates.map((d) => [d, {}]));
  const platforms = {};
  const perAccount = [];
  const allPosts = [];
  for (const r of results.filter(Boolean)) {
    const { a, posts, prof, fol: fs } = r;
    let engagement = 0, views = 0;
    for (const p of posts) {
      const e = p.metrics.likes + p.metrics.comments + p.metrics.shares;
      engagement += e; views += p.metrics.views || 0;
      const k = dateKey(p.publishedAt);
      if (eng[k]) eng[k][a.platform] = (eng[k][a.platform] || 0) + e;
      allPosts.push({ ...p, engagement: e });
    }
    let last = null;
    for (const d of dates) { const hit = fs.find((x) => x.date === d); if (hit) last = hit.followers; if (last != null) fol[d][a.platform] = (fol[d][a.platform] || 0) + (hit ? hit.followers : last); }
    const first = fs[0]?.followers, cur = prof.followers ?? fs.at(-1)?.followers ?? null;
    perAccount.push({ id: a.id, platform: a.platform, name: a.name, handle: a.handle, demo: !!a.demo, followers: cur, followersDelta: cur != null && first != null ? cur - first : null, engagement, views, posts: posts.length });
    platforms[a.platform] = true;
  }
  const plist = Object.keys(platforms);
  const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);
  const series = {
    dates,
    engagement: { total: dates.map((d) => sum(eng[d])), byPlatform: Object.fromEntries(plist.map((p) => [p, dates.map((d) => eng[d][p] || 0)])) },
    followers: { total: dates.map((d) => sum(fol[d])), byPlatform: Object.fromEntries(plist.map((p) => [p, dates.map((d) => fol[d][p] ?? null)])) },
  };
  const totalFollowers = perAccount.reduce((s, a) => s + (a.followers || 0), 0);
  const delta = perAccount.reduce((s, a) => s + (a.followersDelta || 0), 0);
  const engagement = perAccount.reduce((s, a) => s + a.engagement, 0);
  const views = perAccount.reduce((s, a) => s + a.views, 0);
  return {
    days, series, accounts: perAccount, errors, hasAccounts: accounts.length > 0,
    totals: {
      followers: totalFollowers, followersDelta: delta, engagement, views, posts: allPosts.length,
      engagementRate: totalFollowers && allPosts.length ? engagement / allPosts.length / (totalFollowers / Math.max(1, perAccount.length)) : 0,
    },
    topPosts: allPosts.sort((a, b) => b.engagement - a.engagement).slice(0, 8),
  };
}

/* ---------- inbox ---------- */
export async function inbox() {
  const { results, errors } = await eachAccount((a) => providers[a.platform].meta.features.comments || a.demo, (a) =>
    cached(`inbox:${a.id}`, 60_000, async () => {
      if (a.demo) return demo.comments(a).map((c) => tag(a, c));
      const acct = await liveAccount(a);
      const posts = await accountPosts(a);
      return (await providers[a.platform].fetchComments(acct, posts)).map((c) => tag(a, c));
    }));
  const items = results.flat().filter(Boolean).map((c) => {
    const id = `${c.accountId}:${c.externalId}`;
    const st = db.inboxState[id] || {};
    return { ...c, id, read: !!st.read, reply: st.reply || null };
  }).sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1));
  return { items, errors };
}

export async function replyTo(itemId, text) {
  const [accountId, ...rest] = itemId.split(':');
  const externalId = rest.join(':');
  const a = getAccount(accountId);
  if (!a) throw httpError(404, 'Account not found');
  if (!text?.trim()) throw httpError(400, 'Reply text is empty');
  if (!a.demo) {
    const p = providers[a.platform];
    if (!p.reply) throw httpError(400, `${p.meta.name} does not support replies`);
    await p.reply(await liveAccount(a), { externalId }, text.trim());
  }
  db.inboxState[itemId] = { read: true, reply: { text: text.trim(), at: new Date().toISOString() } };
  save();
}

export function markRead(itemId, read = true) {
  db.inboxState[itemId] = { ...db.inboxState[itemId], read };
  save();
}

/* ---------- composer posts ---------- */
const metaFor = (platform) => providers[platform].meta;

export function validatePost(p) {
  const errors = [];
  const text = (p.text || '').trim();
  if (!p.accountIds?.length) errors.push('Select at least one account.');
  if (!text && !p.mediaUrl) errors.push('Write something or attach media.');
  if (p.mediaUrl && !/^https?:\/\//i.test(p.mediaUrl)) errors.push('Media must be a public http(s) URL.');
  for (const id of p.accountIds || []) {
    const a = getAccount(id);
    if (!a) { errors.push(`Unknown account ${id}.`); continue; }
    const m = metaFor(a.platform);
    if (text.length > m.charLimit) errors.push(`${m.name}: ${text.length}/${m.charLimit} characters.`);
    if (m.mediaRequired && !p.mediaUrl) errors.push(`${m.name} requires ${m.videoOnly ? 'a video' : 'an image or video'}.`);
  }
  return errors;
}

export function savePost(input, id) {
  const status = input.status || 'draft';
  if (status !== 'draft') {
    const errs = validatePost(input);
    if (errs.length) throw httpError(400, errs.join(' '));
  }
  if (status === 'scheduled') {
    const t = new Date(input.scheduledAt).getTime();
    if (!input.scheduledAt || Number.isNaN(t)) throw httpError(400, 'Pick a valid schedule time.');
    if (t < Date.now() - 60_000) throw httpError(400, 'Schedule time is in the past.');
  }
  let post = id && db.posts.find((p) => p.id === id);
  if (id && !post) throw httpError(404, 'Post not found');
  if (post && post.status === 'published') throw httpError(400, 'Published posts cannot be edited.');
  const now = new Date().toISOString();
  if (!post) { post = { id: uid(6), createdAt: now }; db.posts.push(post); }
  const prev = Object.fromEntries((post.targets || []).map((t) => [t.accountId, t]));
  Object.assign(post, {
    text: (input.text || '').trim(), mediaUrl: input.mediaUrl || null, status,
    scheduledAt: status === 'scheduled' ? new Date(input.scheduledAt).toISOString() : null, updatedAt: now,
    targets: (input.accountIds || []).map((accountId) => prev[accountId] || { accountId, status: 'pending' }),
  });
  save();
  return post;
}

const inFlight = new Set();
export async function publishPost(id) {
  const post = db.posts.find((p) => p.id === id);
  if (!post) throw httpError(404, 'Post not found');
  if (inFlight.has(id)) throw httpError(409, 'Post is already publishing');
  inFlight.add(id);
  try {
    post.status = 'publishing';
    for (const t of post.targets) {
      if (t.status === 'published') continue;
      const a = getAccount(t.accountId);
      try {
        if (!a) throw new Error('Account was disconnected');
        const errs = validatePost({ ...post, accountIds: [t.accountId] });
        if (errs.length) throw new Error(errs.join(' '));
        const r = a.demo
          ? { id: `demo-${uid(4)}`, url: null }
          : await providers[a.platform].publish(await liveAccount(a), { text: post.text, mediaUrl: post.mediaUrl });
        Object.assign(t, { status: 'published', externalId: r.id, url: r.url, publishedAt: new Date().toISOString(), error: null });
      } catch (e) {
        Object.assign(t, { status: 'failed', error: e.message });
      }
    }
    const ok = post.targets.filter((t) => t.status === 'published').length;
    post.status = ok === post.targets.length ? 'published' : ok ? 'partial' : 'failed';
    post.publishedAt = ok ? new Date().toISOString() : null;
    post.updatedAt = new Date().toISOString();
    for (const k of [...cache.keys()]) if (k.startsWith('posts:')) cache.delete(k);
    save();
    return post;
  } finally {
    inFlight.delete(id);
  }
}

export function deletePost(id) {
  const i = db.posts.findIndex((p) => p.id === id);
  if (i < 0) throw httpError(404, 'Post not found');
  db.posts.splice(i, 1);
  save();
}

export const listPosts = () => [...db.posts].sort((a, b) => ((b.scheduledAt || b.updatedAt) > (a.scheduledAt || a.updatedAt) ? 1 : -1));

export function startScheduler(intervalMs = 20_000) {
  // A crash mid-publish leaves 'publishing' behind; don't auto-retry (could double-post), surface it instead.
  for (const p of db.posts) if (p.status === 'publishing') p.status = 'failed';
  const tick = async () => {
    const due = db.posts.filter((p) => p.status === 'scheduled' && new Date(p.scheduledAt).getTime() <= Date.now());
    for (const p of due) await publishPost(p.id).catch((e) => console.error('[scheduler]', p.id, e.message));
  };
  tick();
  return setInterval(tick, intervalMs).unref();
}

export { publicMeta };
