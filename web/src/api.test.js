import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as api from './api.js';
import { API_URL } from './config.js';

function mockFetch(response) {
  globalThis.fetch = async () => response;
}

test('remove() handles a 204 empty-body response', async () => {
  mockFetch({ ok: true, status: 204 });
  const result = await api.remove('badges', 'abc', 'token');
  assert.equal(result, null);
});

test('a non-ok response throws with the server message', async () => {
  mockFetch({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    text: async () => JSON.stringify({ message: 'Unauthorized' }),
  });
  await assert.rejects(() => api.list('badges'), /401: Unauthorized/);
});

test('a non-JSON error body keeps the status code instead of throwing a SyntaxError', async () => {
  for (const text of ['<html>Bad Gateway</html>', '', 'null', '{}']) {
    mockFetch({ ok: false, status: 502, statusText: 'Bad Gateway', text: async () => text });
    await assert.rejects(() => api.list('badges'), /^Error: 502: Bad Gateway$/, JSON.stringify(text));
  }
});

test('getSettings() issues an unauthenticated GET to /settings', async () => {
  let captured;
  globalThis.fetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 200, json: async () => ({ timezone: 'UTC' }) };
  };
  const result = await api.getSettings();
  assert.equal(captured.url, `${API_URL}/settings`);
  assert.equal(captured.opts.method, 'GET');
  assert.equal(captured.opts.headers.Authorization, undefined);
  assert.deepEqual(result, { timezone: 'UTC' });
});

test('updateSettings() issues an authenticated PUT to /settings with the body', async () => {
  let captured;
  globalThis.fetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 200, json: async () => ({ timezone: 'America/Denver' }) };
  };
  const result = await api.updateSettings({ timezone: 'America/Denver' }, 'tok123');
  assert.equal(captured.url, `${API_URL}/settings`);
  assert.equal(captured.opts.method, 'PUT');
  assert.equal(captured.opts.headers.Authorization, 'tok123');
  assert.deepEqual(JSON.parse(captured.opts.body), { timezone: 'America/Denver' });
  assert.deepEqual(result, { timezone: 'America/Denver' });
});

// Regression coverage for the real failure this shape caused: the /settings
// route wasn't deployed yet, so the API Gateway itself (not the Lambda)
// returned a 404. AdminPage's catch only special-cases a leading "401" (auth
// expiry) and shows a generic "Failed to save" for everything else, so this
// pins the exact error shape that path branches on.
test('updateSettings() throws a status-prefixed error when the route does not exist', async () => {
  mockFetch({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    text: async () => JSON.stringify({ message: 'Not Found' }),
  });
  await assert.rejects(() => api.updateSettings({ timezone: 'UTC' }, 'tok'), /404: Not Found/);
});
