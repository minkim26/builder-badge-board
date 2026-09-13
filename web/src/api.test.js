import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as api from './api.js';

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
