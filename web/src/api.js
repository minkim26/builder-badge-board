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
    // DELETE and some error paths return no body
    const text = await res.text();
    const message = text ? JSON.parse(text).message : res.statusText;
    throw new Error(`${res.status}: ${message}`);
  }

  if (res.status === 204) return null; // DELETE returns no body
  return res.json();
}

export const list = (resource) => request('GET', `/${resource}`);
export const create = (resource, data, token) => request('POST', `/${resource}`, { token, body: data });
export const update = (resource, id, data, token) =>
  request('PUT', `/${resource}/${id}`, { token, body: data });
export const remove = (resource, id, token) => request('DELETE', `/${resource}/${id}`, { token });
