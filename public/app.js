/* KMS Social Manager — single-page dashboard (no build step, no dependencies). */

/* ---------- utilities ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
const fmt = (n) => (n == null ? '—' : new Intl.NumberFormat('en', { notation: Math.abs(n) >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n));
const pct = (n) => `${(n * 100).toFixed(1)}%`;
const fmtDate = (iso, o = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) => (iso ? new Date(iso).toLocaleString(undefined, o) : '—');
const ago = (iso) => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
const toLocalInput = (iso) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

const ICONS = {
  home: 'M3 11l9-8 9 8M5 10v10h14V10', pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z', cal: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13l3.5 7v7H2v-7z', chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  link: 'M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1', sun: 'M12 3v2M12 19v2M5 12H3M21 12h-2M6 6l1.5 1.5M16.5 16.5L18 18M6 18l1.5-1.5M16.5 7.5L18 6M12 8a4 4 0 100 8 4 4 0 000-8z',
  out: 'M9 21H5V3h4M16 17l5-5-5-5M21 12H9',
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[n]}"/></svg>`;

/* ---------- state & API ---------- */
const S = { platforms: [], redirects: {}, accounts: [], authRequired: false, unread: 0 };
const P = (id) => S.platforms.find((p) => p.id === id) || { id, name: id, short: '?', color: '#888' };
const acct = (id) => S.accounts.find((a) => a.id === id);

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== 'api/login') { renderLogin(); throw new Error('Not signed in'); }
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}
function toast(msg, bad = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), bad ? 7000 : 3500);
}
const run = async (fn) => { try { return await fn(); } catch (e) { toast(e.message, true); } };

/* ---------- small components ---------- */
const pf = (id, lg = false) => `<span class="pf${lg ? ' lg' : ''}" style="--c:var(--c-${esc(id)})" title="${esc(P(id).name)}">${esc(P(id).short)}</span>`;
const dot = (id) => `<span class="dot" style="--c:var(--c-${esc(id)})"></span>`;
const statusPill = (s) => {
  const m = { published: ['good', 'Published'], scheduled: ['acc', 'Scheduled'], draft: ['', 'Draft'], failed: ['bad', 'Failed'], partial: ['warn', 'Partial'], publishing: ['warn', 'Publishing'], now: ['warn', 'Publishing'], pending: ['', 'Pending'] }[s] || ['', s];
  return `<span class="pill ${m[0]}">${m[1]}</span>`;
};
const demoPill = (a) => (a?.demo ? ' <span class="pill warn">DEMO</span>' : '');
const delta = (n) => (n == null ? '' : `<span class="delta ${n >= 0 ? 'up' : 'down'}">${n >= 0 ? '▲' : '▼'} ${fmt(Math.abs(n))}</span>`);
const empty = (title, text, cta = '') => `<div class="empty"><b>${esc(title)}</b>${esc(text)}${cta ? `<div style="margin-top:12px">${cta}</div>` : ''}</div>`;
const errorsBox = (errs = []) => (errs.length ? `<div class="alert">${errs.map((e) => `<div><b>${esc(e.name)}</b> (${esc(P(e.platform).name)}): ${esc(e.message)}</div>`).join('')}</div>` : '');
const connectCta = '<a class="btn primary" href="#/accounts">Connect an account</a>';
const kpi = (label, value, extra = '') => `<div class="card kpi"><div class="label">${label}</div><div class="value num">${value}</div><div>${extra}</div></div>`;

/* ---------- charts (inline SVG) ---------- */
const chartQueue = [];
const chartBox = (cfg) => { chartQueue.push(cfg); return `<div class="chart" data-ci="${chartQueue.length - 1}"></div>`; };

function niceScale(min, max, n = 4) {
  if (max === min) max = min + 1;
  const raw = (max - min) / n, mag = 10 ** Math.floor(Math.log10(raw)), norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
  return { lo, hi, ticks };
}

function mountChart(box, cfg) {
  const { dates, series, zero = true } = cfg;
  const W = 760, H = cfg.height || 240, pad = { l: 48, r: 12, t: 10, b: 26 };
  const vals = series.flatMap((s) => s.values.filter((v) => v != null));
  if (!vals.length || dates.length < 2) { box.innerHTML = empty('Not enough data yet', 'History builds up as the dashboard runs.'); return; }
  const { lo, hi, ticks } = niceScale(zero ? 0 : Math.min(...vals), Math.max(...vals));
  const X = (i) => pad.l + (i * (W - pad.l - pad.r)) / (dates.length - 1);
  const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const paths = series.map((s) => {
    let d = '', pen = false;
    s.values.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; });
    const area = series.length === 1 ? `<path d="${d}L${X(dates.length - 1)},${Y(lo)}L${X(0)},${Y(lo)}Z" style="fill:${s.color};opacity:.12"/>` : '';
    return `${area}<path d="${d}" fill="none" style="stroke:${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');
  const step = Math.ceil(dates.length / 6);
  const xl = dates.map((d, i) => (i % step === 0 || i === dates.length - 1 ? `<text x="${X(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'}">${fmtDate(d + 'T12:00', { month: 'short', day: 'numeric' })}</text>` : '')).join('');
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(cfg.label || 'Chart')}">
    <g class="grid">${ticks.map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${pad.l - 8}" y="${Y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('')}</g>
    ${xl}${paths}<g class="hv" style="display:none"><line y1="${pad.t}" y2="${H - pad.b}" stroke="currentColor" opacity=".25"/>${series.map((s) => `<circle r="4" style="fill:${s.color}" stroke="var(--panel)" stroke-width="2"/>`).join('')}</g></svg>
    <div class="tip hidden"></div>`;
  const svg = $('svg', box), hv = $('.hv', box), tip = $('.tip', box);
  const move = (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(dates.length - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (dates.length - 1))));
    hv.style.display = '';
    $('line', hv).setAttribute('x1', X(i)); $('line', hv).setAttribute('x2', X(i));
    [...hv.querySelectorAll('circle')].forEach((c, k) => { const v = series[k].values[i]; c.style.display = v == null ? 'none' : ''; if (v != null) { c.setAttribute('cx', X(i)); c.setAttribute('cy', Y(v)); } });
    tip.classList.remove('hidden');
    tip.innerHTML = `<div class="t">${esc(fmtDate(dates[i] + 'T12:00', { weekday: 'short', month: 'short', day: 'numeric' }))}</div>` +
      series.map((s) => `<div class="l"><span class="dot" style="background:${s.color}"></span>${esc(s.name)}<b>${fmt(s.values[i])}</b></div>`).join('');
    tip.style.left = `${Math.max(80, Math.min(r.width - 80, (X(i) / W) * r.width))}px`;
    tip.style.top = `${(Math.min(...series.map((s) => (s.values[i] == null ? H : Y(s.values[i])))) / H) * r.height - 8}px`;
  };
  svg.addEventListener('mousemove', move);
  svg.addEventListener('touchmove', (e) => move(e.touches[0]), { passive: true });
  svg.addEventListener('mouseleave', () => { hv.style.display = 'none'; tip.classList.add('hidden'); });
}
const mountCharts = (root) => root.querySelectorAll('.chart[data-ci]').forEach((b) => mountChart(b, chartQueue[b.dataset.ci]));
const legend = (items) => `<div class="legend">${items.map((i) => `<span><span class="dot" style="background:${i.color}"></span>${esc(i.name)}</span>`).join('')}</div>`;
const platSeries = (byPlatform) => Object.entries(byPlatform).map(([id, values]) => ({ name: P(id).name, color: `var(--c-${id})`, values }));

/* ---------- shell & router ---------- */
let acts = {};
const NAV = [['dashboard', 'Dashboard', 'home'], ['compose', 'Create post', 'pen'], ['calendar', 'Calendar', 'cal'], ['posts', 'Posts', 'list'], ['inbox', 'Inbox', 'inbox'], ['analytics', 'Analytics', 'chart'], ['accounts', 'Accounts', 'link']];

function renderShell() {
  $('#app').innerHTML = `<div class="shell">
    <aside class="side">
      <div class="brand"><span class="logo"><svg viewBox="0 0 32 32" fill="none" stroke-width="3" stroke-linecap="round"><path d="M9 8v16M9 16l9-8M11.5 14l8.5 10"/></svg></span><span>KMS Social</span></div>
      <nav class="nav" aria-label="Main">${NAV.map(([id, label, ic]) => `<a href="#/${id}" data-nav="${id}">${icon(ic)}<span class="t">${label}</span>${id === 'inbox' ? '<span class="badge hidden" id="unread"></span>' : ''}</a>`).join('')}</nav>
      <div class="foot">
        <button class="btn sm" data-act="theme">${icon('sun')} <span class="t">Theme</span></button>
        ${S.authRequired ? `<button class="btn sm" data-act="logout">${icon('out')} <span class="t">Sign out</span></button>` : ''}
      </div>
    </aside>
    <main class="main" id="view"></main></div>`;
}
const setUnread = (n) => { S.unread = n; const b = $('#unread'); if (b) { b.textContent = n; b.classList.toggle('hidden', !n); } };

const views = {};
let renderToken = 0;
async function render() {
  if (!$('#view')) return;
  const [, name = 'dashboard', arg] = (location.hash.split('?')[0] || '').split('/');
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const v = views[name] || views.dashboard;
  document.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (views[name] ? name : 'dashboard')));
  const el = $('#view'), token = ++renderToken;
  acts = {}; chartQueue.length = 0;
  el.innerHTML = '<div class="empty muted">Loading…</div>';
  window.scrollTo(0, 0);
  try {
    await v(el, arg, query, token);
  } catch (e) {
    if (token === renderToken) el.innerHTML = `<div class="alert bad">${esc(e.message)}</div>`;
  }
}
const stale = (t) => t !== renderToken;
const head = (title, sub = '', right = '') => `<div class="head"><div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div><div class="right" style="display:flex;gap:8px;align-items:center">${right}</div></div>`;

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const fn = acts[t.dataset.act] || globalActs[t.dataset.act];
  if (fn) { e.preventDefault(); run(() => fn(t, e)); }
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button][data-act]')) e.target.click();
});
const globalActs = {
  theme() { const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); const n = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = n; try { localStorage.setItem('theme', n); } catch { /* ignore */ } },
  async logout() { await api('api/logout', { method: 'POST' }); renderLogin(); },
};

/* ---------- Dashboard ---------- */
views.dashboard = async (el, _a, _q, tok) => {
  if (!S.accounts.length) { el.innerHTML = head('Dashboard', 'Everything across your social pages at a glance') + `<div class="card">${empty('No accounts connected yet', 'Connect Facebook, Instagram, X, TikTok or LinkedIn — or add demo accounts to explore the dashboard.', connectCta)}</div>`; return; }
  const [an, posts, inb] = await Promise.all([api('api/analytics?days=30'), api('api/posts'), api('api/inbox').catch(() => ({ items: [] }))]);
  if (stale(tok)) return;
  setUnread(inb.items.filter((i) => !i.read).length);
  const queue = posts.posts.filter((p) => p.status === 'scheduled').sort((a, b) => (a.scheduledAt > b.scheduledAt ? 1 : -1));
  const t = an.totals;
  el.innerHTML = head('Dashboard', 'Last 30 days across all connected accounts', '<a class="btn primary" href="#/compose">' + icon('pen') + ' Create post</a>') + errorsBox(an.errors) + `
    <div class="grid g-kpi">
      ${kpi('Total followers', fmt(t.followers), delta(t.followersDelta))}
      ${kpi('Engagement', fmt(t.engagement), `<span class="muted small">likes, comments, shares</span>`)}
      ${kpi('Posts published', fmt(t.posts), `<span class="muted small">${t.views ? fmt(t.views) + ' views' : 'last 30 days'}</span>`)}
      ${kpi('Scheduled', fmt(queue.length), queue[0] ? `<span class="muted small">next ${esc(fmtDate(queue[0].scheduledAt))}</span>` : '<span class="muted small">queue is empty</span>')}
    </div>
    <div class="grid g-2" style="margin-top:16px">
      <div class="card"><div class="ch"><h2>Engagement per day</h2></div>${chartBox({ dates: an.series.dates, series: platSeries(an.series.engagement.byPlatform), label: 'Engagement per day by platform' })}${legend(platSeries(an.series.engagement.byPlatform))}</div>
      <div class="card"><div class="ch"><h2>Accounts</h2><a class="right small" href="#/analytics">Details</a></div>
        ${an.accounts.map((a) => `<div class="row">${pf(a.platform)}<div class="grow"><div class="clip"><b>${esc(a.name)}</b>${demoPill(a)}</div><div class="muted small clip">${esc(a.handle)}</div></div><div style="text-align:right" class="num"><b>${fmt(a.followers)}</b><div>${delta(a.followersDelta)}</div></div></div>`).join('')}</div>
    </div>
    <div class="grid g-eq" style="margin-top:16px">
      <div class="card"><div class="ch"><h2>Upcoming posts</h2><a class="right small" href="#/calendar">Calendar</a></div>
        ${queue.length ? queue.slice(0, 5).map((p) => `<a class="row" style="text-decoration:none;color:inherit" href="#/compose/${esc(p.id)}"><div class="grow"><div class="clip">${esc(p.text || '(media only)')}</div><div class="muted small">${esc(fmtDate(p.scheduledAt))}</div></div>${p.targets.map((x) => dot(acct(x.accountId)?.platform || '')).join('')}</a>`).join('') : empty('Nothing scheduled', 'Plan ahead by scheduling your next post.', '<a class="btn" href="#/compose">Create post</a>')}</div>
      <div class="card"><div class="ch"><h2>Latest comments</h2><a class="right small" href="#/inbox">Inbox</a></div>
        ${inb.items.length ? inb.items.slice(0, 5).map((m) => `<a class="row" style="text-decoration:none;color:inherit" href="#/inbox/${encodeURIComponent(m.id)}">${pf(m.platform)}<div class="grow"><div class="clip ${m.read ? '' : 'num'}"><b>${esc(m.author)}</b> ${esc(m.text)}</div><div class="muted small">${ago(m.createdAt)}</div></div></a>`).join('') : empty('No comments yet', 'New comments from your pages show up here.')}</div>
    </div>
    <div class="card" style="margin-top:16px"><div class="ch"><h2>Top posts</h2></div>${topPostsTable(an.topPosts)}</div>`;
  mountCharts(el);
};

function topPostsTable(list) {
  if (!list.length) return empty('No posts in this period', 'Publish something to see how it performs.');
  return `<div class="tablewrap"><table><thead><tr><th>Post</th><th class="r">Likes</th><th class="r">Comments</th><th class="r">Shares</th><th class="r">Views</th></tr></thead><tbody>${list.map((p) => `<tr><td><div style="display:flex;gap:10px;align-items:center">${pf(p.platform)}<div style="min-width:0"><div class="clip" style="max-width:420px">${safeUrl(p.url) ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.text || '(media)')}</a>` : esc(p.text || '(media)')}</div><div class="muted small">${esc(p.accountName)} · ${esc(fmtDate(p.publishedAt, { month: 'short', day: 'numeric' }))}</div></div></div></td><td class="r num">${fmt(p.metrics.likes)}</td><td class="r num">${fmt(p.metrics.comments)}</td><td class="r num">${fmt(p.metrics.shares)}</td><td class="r num">${fmt(p.metrics.views)}</td></tr>`).join('')}</tbody></table></div>`;
}

/* ---------- Compose ---------- */
views.compose = async (el, id, q, tok) => {
  if (!S.accounts.length) { el.innerHTML = head('Create post') + `<div class="card">${empty('Connect an account first', 'You need at least one connected account to publish.', connectCta)}</div>`; return; }
  const c = { id: null, text: '', mediaUrl: '', ids: new Set(), at: '' };
  if (id) {
    const { posts } = await api('api/posts');
    const p = posts.find((x) => x.id === id);
    if (stale(tok)) return;
    if (!p) { el.innerHTML = `<div class="alert bad">Post not found.</div>`; return; }
    Object.assign(c, { id: p.id, text: p.text, mediaUrl: p.mediaUrl || '', ids: new Set(p.targets.map((t) => t.accountId)), at: p.scheduledAt ? toLocalInput(p.scheduledAt) : '' });
    if (p.status === 'published') { location.hash = '#/posts'; return; }
  } else if (q.get('date')) c.at = `${q.get('date')}T10:00`;

  el.innerHTML = head(c.id ? 'Edit post' : 'Create post', 'Write once, publish to every selected account') + `
  <div class="compose">
    <div class="card">
      <label class="field" style="margin-top:0">Publish to</label>
      <div class="chips" id="chips">${S.accounts.map((a) => `<span class="chip" role="button" tabindex="0" aria-pressed="false" data-act="pick" data-id="${esc(a.id)}">${pf(a.platform)}<span>${esc(a.name)}${a.platform === 'x' || S.accounts.filter((z) => z.platform === a.platform).length > 1 ? ` <span class="muted">${esc(a.handle)}</span>` : ''}${demoPill(a)}</span></span>`).join('')}</div>
      <label class="field" for="text">Caption</label>
      <textarea id="text" placeholder="What do you want to share?"></textarea>
      <div class="counts" id="counts"></div>
      <label class="field" for="media">Media (public image or video URL)</label>
      <div style="display:flex;gap:8px"><input id="media" type="url" placeholder="https://…/photo.jpg or video.mp4"><label class="btn" style="white-space:nowrap">Upload<input id="file" type="file" accept="image/*,video/mp4,video/quicktime,video/webm" hidden></label></div>
      <div class="muted small" id="mediaHint" style="margin-top:6px">Instagram and TikTok require media. Platforms fetch media from this URL, so it must be publicly reachable.</div>
      <label class="field" for="when">Schedule for</label>
      <input id="when" type="datetime-local">
      <div class="actions">
        <button class="btn primary" data-act="save" data-mode="now">Publish now</button>
        <button class="btn" data-act="save" data-mode="scheduled">Schedule</button>
        <button class="btn" data-act="save" data-mode="draft">Save draft</button>
        ${c.id ? '<button class="btn danger right" data-act="del">Delete</button>' : ''}
      </div>
    </div>
    <div class="sticky"><div class="card"><div class="ch"><h2>Preview</h2></div><div id="preview"></div></div></div>
  </div>`;
  const text = $('#text'), media = $('#media'), when = $('#when');
  text.value = c.text; media.value = c.mediaUrl; when.value = c.at;

  const draw = () => {
    c.text = text.value; c.mediaUrl = media.value.trim(); c.at = when.value;
    document.querySelectorAll('#chips .chip').forEach((n) => n.setAttribute('aria-pressed', c.ids.has(n.dataset.id)));
    const sel = [...c.ids].map(acct).filter(Boolean);
    const plats = [...new Map(sel.map((a) => [a.platform, P(a.platform)])).values()];
    $('#counts').innerHTML = plats.map((p) => { const over = c.text.length > p.charLimit; return `<span class="${over ? 'over' : ''}">${dot(p.id)} ${p.name}: ${c.text.length.toLocaleString()}/${p.charLimit.toLocaleString()}</span>`; }).join('') || '<span class="muted">Select an account to see character limits.</span>';
    const needs = plats.filter((p) => p.mediaRequired && !c.mediaUrl);
    $('#mediaHint').innerHTML = needs.length ? `<span style="color:var(--warn)">${needs.map((p) => p.name).join(', ')} requires ${needs.some((p) => p.videoOnly) ? 'a video' : 'an image or video'}.</span>` : 'Instagram and TikTok require media. Platforms fetch media from this URL, so it must be publicly reachable.';
    const isVid = /\.(mp4|mov|webm|m4v)(\?|$)/i.test(c.mediaUrl);
    const mu = safeUrl(c.mediaUrl);
    const who = sel[0];
    $('#preview').innerHTML = `<div class="preview"><div class="who">${who ? pf(who.platform) : ''}<div><b>${esc(who?.name || 'Your page')}</b><div class="muted small">${who ? esc(who.handle) : ''} · Just now</div></div></div>
      <div class="body">${esc(c.text) || '<span class="muted">Your caption appears here…</span>'}</div>${mu ? (isVid ? `<video src="${esc(mu)}" controls muted></video>` : `<img src="${esc(mu)}" alt="" onerror="this.style.display='none'">`) : ''}</div>
      ${sel.length > 1 ? `<div class="muted small">Previewing ${esc(who.name)}; the same content goes to ${sel.length} accounts.</div>` : ''}`;
  };
  [text, media, when].forEach((n) => n.addEventListener('input', draw));
  $('#file').addEventListener('change', (e) => run(async () => {
    const f = e.target.files[0]; if (!f) return;
    $('#mediaHint').textContent = `Uploading ${f.name}…`;
    const r = await fetch('api/upload', { method: 'POST', headers: { 'x-filename': encodeURIComponent(f.name) }, body: f });
    const d = await r.json(); if (!r.ok) { draw(); throw new Error(d.error); }
    media.value = d.url; draw();
    if (/localhost|127\.0\.0\.1/.test(d.url)) toast('Uploaded. Note: platforms cannot reach localhost — set BASE_URL to a public address before publishing.', true);
  }));
  acts.pick = (t) => { const k = t.dataset.id; c.ids.has(k) ? c.ids.delete(k) : c.ids.add(k); draw(); };
  acts.del = async () => { if (!confirm('Delete this post?')) return; await api(`api/posts/${c.id}`, { method: 'DELETE' }); toast('Post deleted'); location.hash = '#/posts'; };
  acts.save = async (btn) => {
    draw();
    const mode = btn.dataset.mode;
    if (mode === 'scheduled' && !c.at) throw new Error('Pick a date and time to schedule.');
    const body = { text: c.text, mediaUrl: c.mediaUrl || null, accountIds: [...c.ids], status: mode, scheduledAt: mode === 'scheduled' ? new Date(c.at).toISOString() : null };
    btn.disabled = true;
    try {
      let post;
      if (c.id) { post = await api(`api/posts/${c.id}`, { method: 'PUT', body }); if (mode === 'now') post = await api(`api/posts/${c.id}/publish`, { method: 'POST', body: {} }); }
      else post = await api('api/posts', { method: 'POST', body });
      if (mode === 'now') {
        const bad = post.targets.filter((t) => t.status === 'failed');
        if (bad.length) toast(bad.map((t) => `${acct(t.accountId)?.name || 'Account'}: ${t.error}`).join('\n'), true);
        else toast(`Published to ${post.targets.length} account${post.targets.length > 1 ? 's' : ''}`);
      } else toast(mode === 'scheduled' ? `Scheduled for ${fmtDate(post.scheduledAt)}` : 'Draft saved');
      location.hash = '#/posts';
    } finally { btn.disabled = false; }
  };
  draw();
};

/* ---------- Calendar ---------- */
let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
views.calendar = async (el, _a, _q, tok) => {
  const { posts } = await api('api/posts');
  if (stale(tok)) return;
  const first = new Date(calMonth), start = new Date(first); start.setDate(1 - first.getDay());
  const byDay = {};
  for (const p of posts) { const w = p.status === 'published' || p.status === 'partial' ? p.publishedAt : p.scheduledAt; if (w) (byDay[new Date(w).toDateString()] ||= []).push({ ...p, when: w }); }
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const evs = (byDay[d.toDateString()] || []).sort((a, b) => (a.when > b.when ? 1 : -1));
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    cells.push(`<div class="day ${d.getMonth() !== first.getMonth() ? 'out' : ''} ${d.toDateString() === new Date().toDateString() ? 'today' : ''}" data-act="newday" data-date="${iso}"><span class="dn">${d.getDate()}</span>
      ${evs.slice(0, 3).map((p) => `<button class="ev ${p.status === 'published' ? 'pub' : ''}" data-act="openpost" data-id="${esc(p.id)}" data-status="${esc(p.status)}" title="${esc(p.text)}">${p.targets.slice(0, 3).map((t) => dot(acct(t.accountId)?.platform || '')).join('')}<span class="tx clip">${esc(fmtDate(p.when, { hour: 'numeric', minute: '2-digit' }))} ${esc(p.text)}</span></button>`).join('')}
      ${evs.length > 3 ? `<div class="muted small">+${evs.length - 3} more</div>` : ''}</div>`);
  }
  el.innerHTML = head('Calendar', 'Click a day to schedule a post, or a post to edit it', `<button class="btn" data-act="prev">‹</button><b style="min-width:130px;text-align:center">${esc(first.toLocaleString(undefined, { month: 'long', year: 'numeric' }))}</b><button class="btn" data-act="next">›</button><button class="btn" data-act="today">Today</button>`) +
    `<div class="cal">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => `<div class="dow">${d}</div>`).join('')}${cells.join('')}</div>`;
  const go = (n) => { calMonth = n; render(); };
  acts.prev = () => go(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1));
  acts.next = () => go(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1));
  acts.today = () => go(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  acts.openpost = (t, e) => { e.stopPropagation(); location.hash = t.dataset.status === 'published' ? '#/posts' : `#/compose/${t.dataset.id}`; };
  acts.newday = (t) => { location.hash = `#/compose?date=${t.dataset.date}`; };
};

/* ---------- Posts ---------- */
let postsTab = 'queue';
views.posts = async (el, _a, _q, tok) => {
  const [{ posts }, fd] = await Promise.all([api('api/posts'), postsTab === 'live' ? api('api/feed') : Promise.resolve(null)]);
  if (stale(tok)) return;
  const list = postsTab === 'queue' ? posts : [];
  el.innerHTML = head('Posts', 'Your queue and what is live on each platform', `<div class="seg"><button data-act="tab" data-t="queue" class="${postsTab === 'queue' ? 'on' : ''}">Queue & history</button><button data-act="tab" data-t="live" class="${postsTab === 'live' ? 'on' : ''}">Live on platforms</button></div><a class="btn primary" href="#/compose">${icon('pen')} Create post</a>`) +
    (postsTab === 'queue' ? `<div class="card">${list.length ? `<div class="tablewrap"><table><thead><tr><th>Post</th><th>Accounts</th><th>When</th><th>Status</th><th></th></tr></thead><tbody>${list.map((p) => `<tr>
      <td><div class="clip" style="max-width:380px"><a href="#/compose/${esc(p.id)}" style="color:inherit;text-decoration:none"><b>${esc(p.text || '(media only)')}</b></a></div>${p.targets.filter((t) => t.error).map((t) => `<div class="small" style="color:var(--bad)">${esc(acct(t.accountId)?.name || 'Account')}: ${esc(t.error)}</div>`).join('')}</td>
      <td>${p.targets.map((t) => `<span title="${esc(acct(t.accountId)?.name || 'Disconnected')} — ${esc(t.status)}" style="margin-right:4px">${pf(acct(t.accountId)?.platform || 'x')}</span>`).join('')}</td>
      <td class="muted small">${esc(fmtDate(p.scheduledAt || p.publishedAt || p.updatedAt))}</td><td>${statusPill(p.status)}</td>
      <td class="r" style="white-space:nowrap">${p.status !== 'published' ? `<button class="btn sm" data-act="publish" data-id="${esc(p.id)}">${p.status === 'failed' || p.status === 'partial' ? 'Retry' : 'Publish now'}</button> <a class="btn sm" href="#/compose/${esc(p.id)}">Edit</a> ` : ''}<button class="btn sm danger" data-act="remove" data-id="${esc(p.id)}">Delete</button></td></tr>`).join('')}</tbody></table></div>`
      : empty('No posts yet', 'Create your first post to see it here.', '<a class="btn primary" href="#/compose">Create post</a>')}</div>`
    : `${errorsBox(fd.errors)}<div class="card">${fd.items.length ? `<div class="tablewrap"><table><thead><tr><th>Post</th><th>Published</th><th class="r">Likes</th><th class="r">Comments</th><th class="r">Shares</th><th class="r">Views</th></tr></thead><tbody>${fd.items.map((p) => `<tr><td><div style="display:flex;gap:10px;align-items:center">${pf(p.platform)}<div style="min-width:0"><div class="clip" style="max-width:420px">${safeUrl(p.url) ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.text || '(media)')}</a>` : esc(p.text || '(media)')}</div><div class="muted small">${esc(p.accountName)}</div></div></div></td><td class="muted small">${esc(fmtDate(p.publishedAt))}</td><td class="r num">${fmt(p.metrics.likes)}</td><td class="r num">${fmt(p.metrics.comments)}</td><td class="r num">${fmt(p.metrics.shares)}</td><td class="r num">${fmt(p.metrics.views)}</td></tr>`).join('')}</tbody></table></div>` : empty('Nothing published yet', S.accounts.length ? 'Posts from your connected accounts appear here.' : 'Connect an account to see its posts.', S.accounts.length ? '' : connectCta)}</div>`);
  acts.tab = (t) => { postsTab = t.dataset.t; render(); };
  acts.publish = async (t) => { t.disabled = true; const p = await api(`api/posts/${t.dataset.id}/publish`, { method: 'POST', body: {} }); const bad = p.targets.filter((x) => x.status === 'failed'); bad.length ? toast(bad.map((x) => x.error).join('\n'), true) : toast('Published'); render(); };
  acts.remove = async (t) => { if (!confirm('Delete this post?')) return; await api(`api/posts/${t.dataset.id}`, { method: 'DELETE' }); render(); };
};

/* ---------- Inbox ---------- */
let inboxFilter = 'all';
views.inbox = async (el, arg, _q, tok) => {
  const { items, errors } = await api('api/inbox');
  if (stale(tok)) return;
  setUnread(items.filter((i) => !i.read).length);
  let sel = arg ? decodeURIComponent(arg) : null;
  const shown = () => items.filter((i) => inboxFilter === 'all' || !i.read);
  el.innerHTML = head('Inbox', 'Comments across your accounts', `<div class="seg"><button data-act="filter" data-f="all" class="${inboxFilter === 'all' ? 'on' : ''}">All</button><button data-act="filter" data-f="unread" class="${inboxFilter === 'unread' ? 'on' : ''}">Unread</button></div>`) + errorsBox(errors) +
    `<div class="inbox"><div class="card list" id="list"></div><div class="card" id="detail"></div></div>`;
  const draw = () => {
    const s = shown();
    $('#list').innerHTML = s.length ? s.map((m) => `<div class="msg ${m.read ? '' : 'unread'} ${m.id === sel ? 'sel' : ''}" role="button" tabindex="0" data-act="open" data-id="${esc(m.id)}">${pf(m.platform)}<div class="grow" style="min-width:0"><div class="who clip">${esc(m.author)} <span class="muted small" style="font-weight:400">· ${ago(m.createdAt)}</span></div><div class="clip muted">${esc(m.text)}</div>${m.reply ? '<span class="pill good">Replied</span>' : ''}</div></div>`).join('') : empty(inboxFilter === 'unread' ? 'All caught up' : 'No comments', inboxFilter === 'unread' ? 'No unread comments.' : S.accounts.length ? 'Comments from your pages will appear here.' : 'Connect an account to see its comments.');
    const m = items.find((i) => i.id === sel);
    $('#detail').innerHTML = m ? `<div style="display:flex;gap:10px;align-items:center">${pf(m.platform, true)}<div><b>${esc(m.author)}</b><div class="muted small">${esc(m.accountName)} · ${esc(fmtDate(m.createdAt))}</div></div><button class="btn sm right" data-act="toggle">Mark ${m.read ? 'unread' : 'read'}</button></div>
      ${m.postText ? `<div class="quote small clip">On: ${esc(m.postText)}</div>` : ''}<p style="white-space:pre-wrap;font-size:15px">${esc(m.text)}</p>
      ${safeUrl(m.url) ? `<a class="small" href="${esc(m.url)}" target="_blank" rel="noopener">View on ${esc(P(m.platform).name)}</a>` : ''}
      ${m.reply ? `<div class="alert good" style="margin-top:14px"><b>You replied</b> · ${esc(fmtDate(m.reply.at))}<div style="white-space:pre-wrap">${esc(m.reply.text)}</div></div>` : ''}
      ${P(m.platform).features?.comments || acct(m.accountId)?.demo ? `<label class="field" for="reply">${m.reply ? 'Send another reply' : 'Reply'}</label><textarea id="reply" style="min-height:90px" placeholder="Write a reply…"></textarea><div class="actions"><button class="btn primary" data-act="reply">Send reply</button></div>` : ''}` : empty('Select a comment', 'Pick a conversation on the left to read and reply.');
  };
  const setRead = async (m, read) => { m.read = read; await api('api/inbox/read', { method: 'POST', body: { id: m.id, read } }); setUnread(items.filter((i) => !i.read).length); };
  acts.open = async (t) => { sel = t.dataset.id; const m = items.find((i) => i.id === sel); draw(); if (m && !m.read) { await setRead(m, true); draw(); } };
  acts.filter = (t) => { inboxFilter = t.dataset.f; render(); };
  acts.toggle = async () => { const m = items.find((i) => i.id === sel); await setRead(m, !m.read); draw(); };
  acts.reply = async (t) => { const m = items.find((i) => i.id === sel); const text = $('#reply').value; t.disabled = true; try { await api('api/inbox/reply', { method: 'POST', body: { id: m.id, text } }); m.read = true; m.reply = { text: text.trim(), at: new Date().toISOString() }; toast('Reply sent'); draw(); setUnread(items.filter((i) => !i.read).length); } finally { t.disabled = false; } };
  document.querySelector('#list').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.msg')) e.target.click(); });
  draw();
  if (sel && items.find((i) => i.id === sel && !i.read)) acts.open({ dataset: { id: sel } });
};

/* ---------- Analytics ---------- */
let range = 30;
views.analytics = async (el, _a, _q, tok) => {
  if (!S.accounts.length) { el.innerHTML = head('Analytics') + `<div class="card">${empty('No data yet', 'Connect an account to start tracking performance.', connectCta)}</div>`; return; }
  const an = await api(`api/analytics?days=${range}`);
  if (stale(tok)) return;
  const t = an.totals, ps = platSeries(an.series.engagement.byPlatform), fs = platSeries(an.series.followers.byPlatform);
  const byP = {}; for (const a of an.accounts) byP[a.platform] = (byP[a.platform] || 0) + a.engagement;
  const maxE = Math.max(1, ...Object.values(byP));
  el.innerHTML = head('Analytics', `Last ${range} days`, `<div class="seg">${[7, 30, 90].map((d) => `<button data-act="range" data-d="${d}" class="${range === d ? 'on' : ''}">${d}d</button>`).join('')}</div>`) + errorsBox(an.errors) + `
  <div class="grid g-kpi">
    ${kpi('Followers', fmt(t.followers), delta(t.followersDelta))}
    ${kpi('Engagement', fmt(t.engagement))}
    ${kpi('Posts', fmt(t.posts))}
    ${kpi('Avg engagement / post', t.posts ? fmt(Math.round(t.engagement / t.posts)) : '—', t.views ? `<span class="muted small">${fmt(t.views)} views</span>` : '')}
  </div>
  <div class="grid g-eq" style="margin-top:16px">
    <div class="card"><div class="ch"><h2>Engagement per day</h2></div>${chartBox({ dates: an.series.dates, series: ps, label: 'Engagement per day' })}${legend(ps)}</div>
    <div class="card"><div class="ch"><h2>Followers</h2></div>${chartBox({ dates: an.series.dates, series: fs, zero: false, label: 'Followers by platform' })}${legend(fs)}</div>
  </div>
  <div class="grid g-2" style="margin-top:16px">
    <div class="card"><div class="ch"><h2>Accounts</h2></div><div class="tablewrap"><table><thead><tr><th>Account</th><th class="r">Followers</th><th class="r">Change</th><th class="r">Posts</th><th class="r">Engagement</th></tr></thead><tbody>${an.accounts.map((a) => `<tr><td><div style="display:flex;gap:10px;align-items:center">${pf(a.platform)}<div><b>${esc(a.name)}</b>${demoPill(a)}<div class="muted small">${esc(a.handle)}</div></div></div></td><td class="r num">${fmt(a.followers)}</td><td class="r">${delta(a.followersDelta) || '<span class="muted">—</span>'}</td><td class="r num">${a.posts}</td><td class="r num">${fmt(a.engagement)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="card"><div class="ch"><h2>Engagement by platform</h2></div>${Object.entries(byP).map(([id, v]) => `<div style="margin-bottom:14px"><div style="display:flex;justify-content:space-between"><span>${pf(id)} ${esc(P(id).name)}</span><b class="num">${fmt(v)}</b></div><div class="bar" style="margin-top:6px"><i style="--c:var(--c-${esc(id)});width:${(v / maxE) * 100}%"></i></div></div>`).join('') || empty('No data', '')}</div>
  </div>
  <div class="card" style="margin-top:16px"><div class="ch"><h2>Top posts</h2></div>${topPostsTable(an.topPosts)}</div>`;
  mountCharts(el);
  acts.range = (b) => { range = Number(b.dataset.d); render(); };
};

/* ---------- Accounts ---------- */
views.accounts = async (el, _a, q) => {
  const [{ platforms, redirects }, { accounts }, { keys }] = await Promise.all([api('api/platforms'), api('api/accounts'), api('api/settings')]);
  S.platforms = platforms; S.redirects = redirects; S.accounts = accounts;
  const feat = (f) => [['publish', 'Publish'], ['posts', 'Post stats'], ['comments', 'Comments'], ['followers', 'Followers']].map(([k, l]) => `<span class="pill ${f[k] ? 'good' : ''}" ${f[k] ? '' : 'style="text-decoration:line-through;opacity:.6"'}>${l}</span>`).join('');
  el.innerHTML = head('Accounts', 'Connect the pages and profiles you manage') +
    (q.get('connected') ? `<div class="alert good">Connected ${esc(q.get('connected'))} account(s).</div>` : '') + (q.get('error') ? `<div class="alert bad">${esc(q.get('error'))}</div>` : '') +
    (accounts.some((a) => a.demo) ? '<div class="alert">Demo accounts show sample data. Add API credentials on a platform card and connect real accounts to go live.</div>' : '') +
    `<div class="grid g-cards">${platforms.map((p) => {
      const mine = accounts.filter((a) => a.platform === p.id);
      return `<div class="card"><div style="display:flex;gap:10px;align-items:center">${pf(p.id, true)}<div><h2>${esc(p.name)}</h2><span class="pill ${p.configured ? 'good' : ''}">${p.configured ? 'API configured' : 'Not configured'}</span></div></div>
        <div class="feat">${feat(p.features)}</div><div class="muted small">${esc(p.note)}</div>
        ${mine.map((a) => `<div class="row">${a.avatar && safeUrl(a.avatar) ? `<img class="avatar" src="${esc(a.avatar)}" alt="" referrerpolicy="no-referrer">` : pf(p.id, true)}<div class="grow"><div class="clip"><b>${esc(a.name)}</b>${demoPill(a)}</div><div class="muted small clip">${esc(a.handle)}</div></div><button class="btn sm danger" data-act="disconnect" data-id="${esc(a.id)}">Remove</button></div>`).join('')}
        <div class="actions">${p.configured ? `<a class="btn primary" href="auth/${esc(p.id)}/start">${mine.some((a) => !a.demo) ? 'Connect another' : 'Connect'}</a>` : ''}${mine.some((a) => a.demo) ? '' : `<button class="btn" data-act="demo" data-p="${esc(p.id)}">Add demo account</button>`}</div>
        <details style="margin-top:12px" ${p.configured ? '' : 'open'}><summary class="small" style="cursor:pointer">API credentials${p.configured ? '' : ' (required to connect)'}</summary>
          <div class="small" style="margin-top:8px">Create an app in the <a href="${esc(p.docs)}" target="_blank" rel="noopener">${esc(p.name)} developer portal</a> and register this redirect URI:<div style="margin:6px 0"><code>${esc(redirects[p.id])}</code></div>
          <div data-creds="${esc(p.id)}">${keys.filter((k) => k.platforms.includes(p.id)).map((k) => `<label class="field" style="margin:10px 0 4px">${esc(k.label)} ${k.set ? `<span class="pill ${k.source === 'database' ? 'good' : 'warn'}">${k.source === 'database' ? 'saved, encrypted' : 'from .env'}</span>` : ''}</label>${k.options ? `<select data-key="${esc(k.name)}">${k.options.map((o) => `<option ${o === (k.value || 'SELF_ONLY') ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : `<input data-key="${esc(k.name)}" type="${k.secret ? 'password' : 'text'}" autocomplete="off" spellcheck="false" placeholder="${k.set ? esc(k.hint) + ' — leave blank to keep' : 'Paste value'}">`}`).join('')}</div>
          <div class="actions" style="margin-top:10px"><button class="btn primary sm" data-act="savecreds" data-p="${esc(p.id)}">Save</button>${keys.some((k) => k.platforms.includes(p.id) && k.set && k.source === 'database' && !k.options) ? `<button class="btn sm danger" data-act="clearcreds" data-p="${esc(p.id)}">Remove saved</button>` : ''}</div>
          ${p.id === 'facebook' || p.id === 'instagram' ? '<div class="muted small" style="margin-top:6px">Facebook and Instagram share one Meta app.</div>' : ''}</div></details></div>`;
    }).join('')}</div>`;
  const credBox = (t) => document.querySelector(`[data-creds="${t.dataset.p}"]`);
  acts.savecreds = async (t) => {
    const values = {};
    credBox(t).querySelectorAll('[data-key]').forEach((i) => { if (i.value.trim()) values[i.dataset.key] = i.value.trim(); });
    if (!Object.keys(values).length) throw new Error('Enter at least one value to save.');
    await api('api/settings', { method: 'PUT', body: { values } });
    toast('Credentials saved (encrypted)'); render();
  };
  acts.clearcreds = async (t) => {
    if (!confirm('Remove the saved credentials for this platform? Connected accounts keep working until their tokens expire.')) return;
    const values = {};
    keys.filter((k) => k.platforms.includes(t.dataset.p) && !k.options).forEach((k) => { values[k.name] = null; });
    await api('api/settings', { method: 'PUT', body: { values } });
    toast('Credentials removed'); render();
  };
  acts.demo = async (t) => { await api(`api/accounts/demo/${t.dataset.p}`, { method: 'POST', body: {} }); toast('Demo account added'); await refreshAccounts(); render(); };
  acts.disconnect = async (t) => { if (!confirm('Remove this account from the dashboard? Scheduled posts for it will fail.')) return; await api(`api/accounts/${t.dataset.id}`, { method: 'DELETE' }); await refreshAccounts(); render(); };
};
const refreshAccounts = async () => { S.accounts = (await api('api/accounts')).accounts; };

/* ---------- login & boot ---------- */
function renderLogin() {
  $('#app').innerHTML = `<div class="login"><form class="card" id="lf"><div class="brand" style="padding-left:0"><span class="logo"><svg viewBox="0 0 32 32" fill="none" stroke-width="3" stroke-linecap="round"><path d="M9 8v16M9 16l9-8M11.5 14l8.5 10"/></svg></span><span>KMS Social Manager</span></div>
    <label class="field" for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" autofocus><div class="actions"><button class="btn primary" type="submit">Sign in</button></div></form></div>`;
  $('#lf').addEventListener('submit', (e) => { e.preventDefault(); run(async () => { await api('api/login', { method: 'POST', body: { password: $('#pw').value } }); await boot(); }); });
}

async function boot() {
  try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* ignore */ }
  const ses = await api('api/session');
  S.authRequired = ses.authRequired;
  if (ses.authRequired && !ses.authed) return renderLogin();
  const [{ platforms, redirects }, { accounts }] = await Promise.all([api('api/platforms'), api('api/accounts')]);
  Object.assign(S, { platforms, redirects, accounts });
  renderShell();
  await render();
}
addEventListener('hashchange', render);
boot().catch((e) => { $('#app').innerHTML = `<div class="login"><div class="alert bad">${esc(e.message)}</div></div>`; });
