// Tiny fetch wrapper used by every platform integration.
export async function api(url, { method = 'GET', headers = {}, json, form, query } = {}) {
  if (query) url += (url.includes('?') ? '&' : '?') + new URLSearchParams(query);
  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(30_000) };
  if (json !== undefined) {
    init.body = JSON.stringify(json);
    init.headers['content-type'] = 'application/json';
  } else if (form) {
    init.body = new URLSearchParams(form);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error_description || data?.detail || data?.message ||
      (typeof data?.error === 'string' ? data.error : null) || data?.errors?.[0]?.message || res.statusText;
    const err = new Error(`${res.status}: ${msg}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const mediaKind = (url = '') => (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(url) ? 'video' : 'image');
export const qs = (o) => new URLSearchParams(o).toString();
