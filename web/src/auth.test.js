import { test } from 'node:test';
import assert from 'node:assert/strict';
import { login, getSession, logout } from './auth.js';

// node:test has no DOM, so localStorage isn't a global here like it is in
// the browser this app actually runs in — a plain Map-backed stand-in.
globalThis.localStorage ??= {
  _data: new Map(),
  getItem(key) { return this._data.has(key) ? this._data.get(key) : null; },
  setItem(key, value) { this._data.set(key, value); },
  removeItem(key) { this._data.delete(key); },
};

function mockFetch(response) {
  globalThis.fetch = async () => response;
}

function authResult(body) {
  return { ok: true, json: async () => ({ AuthenticationResult: body }) };
}

test('login() stores the refresh token alongside the ID token', async () => {
  mockFetch(authResult({ IdToken: 'id-1', RefreshToken: 'refresh-1', ExpiresIn: 3600 }));
  const session = await login('user', 'pass');
  assert.equal(session.idToken, 'id-1');
  assert.equal(session.refreshToken, 'refresh-1');
  logout();
});

test('getSession() returns the stored session unchanged while still valid', async () => {
  mockFetch(authResult({ IdToken: 'id-1', RefreshToken: 'refresh-1', ExpiresIn: 3600 }));
  await login('user', 'pass');
  mockFetch({ ok: false, json: async () => ({ message: 'should not be called' }) });
  const session = await getSession();
  assert.equal(session.idToken, 'id-1');
  logout();
});

test('getSession() silently refreshes an expired ID token using the refresh token', async () => {
  mockFetch(authResult({ IdToken: 'id-1', RefreshToken: 'refresh-1', ExpiresIn: -1 })); // already expired
  await login('user', 'pass');
  mockFetch(authResult({ IdToken: 'id-2', ExpiresIn: 3600 })); // REFRESH_TOKEN_AUTH response
  const session = await getSession();
  assert.equal(session.idToken, 'id-2');
  assert.equal(session.refreshToken, 'refresh-1'); // preserved, not rotated
  logout();
});

test('getSession() clears storage and returns null when the refresh token is dead', async () => {
  mockFetch(authResult({ IdToken: 'id-1', RefreshToken: 'refresh-1', ExpiresIn: -1 }));
  await login('user', 'pass');
  mockFetch({ ok: false, json: async () => ({ message: 'Refresh Token has expired' }) });
  const session = await getSession();
  assert.equal(session, null);
  assert.equal(localStorage.getItem('bbb_session'), null);
});
