import { API_URL } from './config.js';

async function request(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = token;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    // DELETE and some error paths return no body, and a gateway or proxy
    // error can be plain text or HTML — none of that should become a
    // SyntaxError that hides the real status code.
    const text = await res.text();
    let message = res.statusText;
    try {
      message = JSON.parse(text).message ?? message;
    } catch {
      // not JSON, or JSON without a message — keep the status text
    }
    throw new Error(`${res.status}: ${message}`);
  }

  if (res.status === 204) return null; // DELETE returns no body
  return res.json();
}

export const list = (resource) => request('GET', `/${resource}`);
export const create = (resource, data, token) => request('POST', `/${resource}`, { token, body: data });
// encodeURIComponent because synced article IDs are Builder Center paths
// (e.g. "/content/abc") — a raw slash would split across route segments and
// never match /articles/{id}. No-op for badgeId/UUIDs, which have nothing to encode.
export const update = (resource, id, data, token) =>
  request('PUT', `/${resource}/${encodeURIComponent(id)}`, { token, body: data });
export const remove = (resource, id, token) => request('DELETE', `/${resource}/${encodeURIComponent(id)}`, { token });
export const sync = (resource, token) => request('POST', `/${resource}/sync`, { token });
export const getSettings = () => request('GET', '/settings');
export const updateSettings = (data, token) => request('PUT', '/settings', { token, body: data });
