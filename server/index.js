import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PORT, HOST, BASE_URL, BASE_PATH, PUBLIC_DIR, UPLOAD_DIR, PASSWORD } from './config.js';
import { hmac, uid } from './store.js';
import { providers } from './providers/index.js';
import * as svc from './service.js';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.json': 'application/json',
};
const UPLOAD_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mov', '.webm']);
const MAX_UPLOAD = 200 * 1024 * 1024;

/* ---------- auth (optional single shared password) ---------- */
const COOKIE = 'kms_session';
const sign = (exp) => `${exp}.${hmac('session:' + exp)}`;
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
function isAuthed(req) {
  if (!PASSWORD) return true;
  const m = /(?:^|;\s*)kms_session=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return false;
  const [exp, mac] = decodeURIComponent(m[1]).split('.');
  return Number(exp) > Date.now() && !!mac && safeEq(mac, hmac('session:' + exp));
}
const attempts = new Map();
function throttled(ip) {
  const now = Date.now();
  const a = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60_000);
  attempts.set(ip, a);
  return a.length >= 10;
}

/* ---------- OAuth state ---------- */
const oauth = new Map(); // state -> { platform, verifier, t }
const redirectUri = (platform) => `${BASE_URL}/auth/${platform}/callback`;
const b64url = (b) => b.toString('base64url');

/* ---------- helpers ---------- */
const send = (res, status, body, headers = {}) => {
  const isStr = typeof body === 'string';
  res.writeHead(status, { 'content-type': isStr ? 'text/plain; charset=utf-8' : 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(isStr ? body : JSON.stringify(body));
};
async function readJson(req, limit = 1_000_000) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw svc.httpError(413, 'Body too large'); chunks.push(c); }
  if (!n) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw svc.httpError(400, 'Invalid JSON'); }
}

const routes = [];
const route = (method, pattern, handler, { open = false } = {}) =>
  routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '/?$'), handler, open });

/* ---------- API routes ---------- */
route('GET', '/api/session', (req, res) => send(res, 200, { authRequired: !!PASSWORD, authed: isAuthed(req) }), { open: true });
route('POST', '/api/login', async (req, res) => {
  // Behind nginx every connection comes from loopback; trust X-Real-IP only in that case.
  const peer = req.socket.remoteAddress || '?';
  const ip = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) ? req.headers['x-real-ip'] || peer : peer;
  if (throttled(ip)) return send(res, 429, { error: 'Too many attempts. Try again later.' });
  const { password = '' } = await readJson(req);
  if (!PASSWORD || !safeEq(String(password), PASSWORD)) {
    attempts.get(ip).push(Date.now());
    return send(res, 401, { error: 'Incorrect password' });
  }
  const exp = Date.now() + 7 * 86_400_000;
  send(res, 200, { ok: true }, { 'set-cookie': `${COOKIE}=${encodeURIComponent(sign(exp))}; HttpOnly; SameSite=Lax; Path=${BASE_PATH || '/'}; Max-Age=${7 * 86400}${BASE_URL.startsWith('https') ? '; Secure' : ''}` });
}, { open: true });
route('POST', '/api/logout', (req, res) => send(res, 200, { ok: true }, { 'set-cookie': `${COOKIE}=; HttpOnly; SameSite=Lax; Path=${BASE_PATH || '/'}; Max-Age=0` }), { open: true });

route('GET', '/api/platforms', (req, res) => send(res, 200, { platforms: svc.publicMeta(), baseUrl: BASE_URL, redirects: Object.fromEntries(Object.keys(providers).map((p) => [p, redirectUri(p)])) }));
route('GET', '/api/accounts', (req, res) => send(res, 200, { accounts: svc.listAccounts() }));
route('POST', '/api/accounts/demo/:platform', (req, res, { platform }) => send(res, 201, svc.addDemoAccount(platform)));
route('DELETE', '/api/accounts/:id', (req, res, { id }) => { svc.removeAccount(id); send(res, 200, { ok: true }); });

route('GET', '/api/analytics', async (req, res, _p, url) => send(res, 200, await svc.analytics(Number(url.searchParams.get('days')) || 30)));
route('GET', '/api/feed', async (req, res, _p, url) => send(res, 200, await svc.feed({ accountId: url.searchParams.get('accountId') || undefined })));
route('GET', '/api/inbox', async (req, res) => send(res, 200, await svc.inbox()));
route('POST', '/api/inbox/reply', async (req, res) => { const b = await readJson(req); await svc.replyTo(b.id, b.text); send(res, 200, { ok: true }); });
route('POST', '/api/inbox/read', async (req, res) => { const b = await readJson(req); svc.markRead(b.id, b.read !== false); send(res, 200, { ok: true }); });

route('GET', '/api/posts', (req, res) => send(res, 200, { posts: svc.listPosts() }));
route('POST', '/api/posts', async (req, res) => {
  const b = await readJson(req);
  const post = svc.savePost(b);
  send(res, 201, b.status === 'now' ? await svc.publishPost(post.id) : post);
});
route('PUT', '/api/posts/:id', async (req, res, { id }) => send(res, 200, svc.savePost(await readJson(req), id)));
route('POST', '/api/posts/:id/publish', async (req, res, { id }) => send(res, 200, await svc.publishPost(id)));
route('DELETE', '/api/posts/:id', (req, res, { id }) => { svc.deletePost(id); send(res, 200, { ok: true }); });

route('POST', '/api/upload', async (req, res) => {
  const name = decodeURIComponent(String(req.headers['x-filename'] || ''));
  const ext = path.extname(name).toLowerCase();
  if (!UPLOAD_EXT.has(ext)) return send(res, 400, { error: `Unsupported file type. Allowed: ${[...UPLOAD_EXT].join(', ')}` });
  if (Number(req.headers['content-length']) > MAX_UPLOAD) return send(res, 413, { error: 'File too large (200 MB max)' });
  const file = `${uid(12)}${ext}`;
  const dest = path.join(UPLOAD_DIR, file);
  let n = 0;
  const out = fs.createWriteStream(dest);
  try {
    for await (const chunk of req) { n += chunk.length; if (n > MAX_UPLOAD) throw svc.httpError(413, 'File too large (200 MB max)'); if (!out.write(chunk)) await new Promise((r) => out.once('drain', r)); }
    await new Promise((r) => out.end(r));
  } catch (e) { out.destroy(); fs.rmSync(dest, { force: true }); throw e; }
  send(res, 201, { url: `${BASE_URL}/media/${file}`, name: file });
});

/* ---------- OAuth ---------- */
route('GET', '/auth/:platform/start', (req, res, { platform }) => {
  const p = providers[platform];
  if (!p) return send(res, 404, 'Unknown platform');
  if (!p.configured()) return send(res, 400, `${p.meta.name} is not configured. Set ${p.meta.env.join(' and ')} in .env.`);
  for (const [k, v] of oauth) if (Date.now() - v.t > 600_000) oauth.delete(k);
  const state = uid(16);
  const verifier = b64url(crypto.randomBytes(32));
  oauth.set(state, { platform, verifier, t: Date.now() });
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  res.writeHead(302, { location: p.authUrl({ state, redirectUri: redirectUri(platform), challenge }) });
  res.end();
});
route('GET', '/auth/:platform/callback', async (req, res, { platform }, url) => {
  const back = (q) => { res.writeHead(302, { location: `${BASE_PATH}/#/accounts?${q}` }); res.end(); };
  const st = oauth.get(url.searchParams.get('state'));
  oauth.delete(url.searchParams.get('state'));
  if (!st || st.platform !== platform) return back('error=' + encodeURIComponent('Login session expired. Please try again.'));
  if (url.searchParams.get('error')) return back('error=' + encodeURIComponent(url.searchParams.get('error_description') || url.searchParams.get('error')));
  try {
    const found = await providers[platform].connect({ code: url.searchParams.get('code'), redirectUri: redirectUri(platform), verifier: st.verifier });
    if (!found.length) return back('error=' + encodeURIComponent('No eligible accounts were found for that login.'));
    svc.addAccounts(platform, found);
    back('connected=' + found.length);
  } catch (e) {
    console.error('[oauth]', platform, e.message);
    back('error=' + encodeURIComponent(e.message));
  }
}, { open: false });

/* ---------- static + media ---------- */
function serveFile(req, res, file, { cache = 'no-cache' } = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    const base = { 'content-type': type, 'cache-control': cache, 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff' };
    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { ...base, 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...base, 'content-length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

const CSP = "default-src 'self'; img-src 'self' https: data:; media-src 'self' https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, BASE_URL);
  const pathname = decodeURIComponent(url.pathname);
  try {
    if (pathname.startsWith('/media/')) {
      const f = path.join(UPLOAD_DIR, path.basename(pathname));
      return serveFile(req, res, f, { cache: 'public, max-age=86400' });
    }
    const isApi = pathname.startsWith('/api/') || pathname.startsWith('/auth/');
    if (isApi) {
      const r = routes.find((x) => x.method === req.method && x.re.test(pathname));
      if (!r) return send(res, 404, { error: 'Not found' });
      if (!r.open && !isAuthed(req)) {
        if (pathname.startsWith('/auth/')) { res.writeHead(302, { location: `${BASE_PATH}/` }); return res.end(); }
        return send(res, 401, { error: 'Not signed in' });
      }
      if (['POST', 'PUT'].includes(req.method) && pathname !== '/api/upload' && req.headers['content-length'] !== '0' && !/application\/json/.test(req.headers['content-type'] || '')) {
        return send(res, 415, { error: 'Content-Type must be application/json' });
      }
      return await r.handler(req, res, r.re.exec(pathname).groups || {}, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    const rel = pathname === '/' ? '/index.html' : pathname;
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
    res.setHeader('content-security-policy', CSP);
    res.setHeader('x-frame-options', 'DENY');
    res.setHeader('referrer-policy', 'same-origin');
    serveFile(req, res, file);
  } catch (e) {
    if (res.headersSent) return res.destroy();
    const status = e.status && e.status < 600 && !e.data ? e.status : e.status === 401 || e.status === 403 ? 502 : e.status ? 502 : 500;
    if (status >= 500) console.error('[error]', req.method, pathname, e.message);
    send(res, status, { error: e.message });
  }
});

if (process.argv[1] === new URL(import.meta.url).pathname) {
  server.listen(PORT, HOST, () => {
    console.log(`KMS Social Manager running at ${BASE_URL}${PASSWORD ? '' : '  (no DASHBOARD_PASSWORD set: open access)'}`);
    svc.startScheduler();
  });
}
export { server };
