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

  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return authResult({ IdToken: 'id-2', ExpiresIn: 3600 });
  };
  const session = await getSession();

  assert.equal(requests[0].AuthFlow, 'REFRESH_TOKEN_AUTH');
  assert.deepEqual(requests[0].AuthParameters, { REFRESH_TOKEN: 'refresh-1' });
  assert.equal(session.idToken, 'id-2');
  assert.equal(session.refreshToken, 'refresh-1'); // preserved, not rotated
  logout();
});

test('getSession() refreshes a token that is technically unexpired but inside the buffer window', async () => {
  mockFetch(authResult({ IdToken: 'id-1', RefreshToken: 'refresh-1', ExpiresIn: 30 })); // expires in 30s, buffer is 60s
  await login('user', 'pass');

  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return authResult({ IdToken: 'id-2', ExpiresIn: 3600 });
  };
  const session = await getSession();

  assert.equal(requests[0].AuthFlow, 'REFRESH_TOKEN_AUTH');
  assert.equal(session.idToken, 'id-2');
  logout();
});

test('getSession() clears storage and returns null when the refresh token is dead', async () => {
  mockFetch(authResult({ IdToken: 'id-1', RefreshToken: 'refresh-1', ExpiresIn: -1 }));
  await login('user', 'pass');
  mockFetch({ ok: false, json: async () => ({ __type: 'NotAuthorizedException', message: 'Refresh Token has expired' }) });
  const session = await getSession();
  assert.equal(session, null);
  assert.equal(localStorage.getItem('bbb_session'), null);
});

test('getSession() throws (not returns null) and preserves the session on a transient refresh failure', async () => {
  mockFetch(authResult({ IdToken: 'id-1', RefreshToken: 'refresh-1', ExpiresIn: -1 }));
  await login('user', 'pass');
  mockFetch({ ok: false, json: async () => ({ __type: 'InternalErrorException', message: 'Internal error' }) });
  // Rejecting (rather than resolving to null) matters: a caller that treated
  // this the same as "no session" would send an unauthenticated request,
  // get a 401, and log out — deleting the refresh token this is meant to keep.
  await assert.rejects(() => getSession(), /Internal error/);
  assert.ok(localStorage.getItem('bbb_session')); // the refresh token itself wasn't thrown away
  logout();
});

test('a logout during an in-flight refresh is not undone once the refresh resolves', async () => {
  mockFetch(authResult({ IdToken: 'id-1', RefreshToken: 'refresh-1', ExpiresIn: -1 }));
  await login('user', 'pass');

  // logout() below fires its own (RevokeToken) request — resolve that one
  // immediately so only the refresh request is under manual control here.
  let resolveRefresh;
  globalThis.fetch = (_url, options) => {
    if (options.headers['X-Amz-Target'] === 'AWSCognitoIdentityProviderService.RevokeToken') {
      return Promise.resolve({ ok: true });
    }
    return new Promise((resolve) => { resolveRefresh = resolve; });
  };
  const pending = getSession(); // refresh now in flight, awaiting the network

  logout(); // the user logs out before that refresh comes back

  resolveRefresh(authResult({ IdToken: 'id-2', ExpiresIn: 3600 })); // now it resolves, too late
  const result = await pending;

  assert.equal(result, null); // reflects the post-logout state, not the stale refresh
  assert.equal(localStorage.getItem('bbb_session'), null); // logout wasn't clobbered by the late write
});

test('a concurrent refresh success is not lost when a second caller fails transiently', async () => {
  mockFetch(authResult({ IdToken: 'id-1', RefreshToken: 'refresh-1', ExpiresIn: -1 }));
  await login('user', 'pass');

  // Simulates React StrictMode double-invoking the mount effect: two
  // getSession() calls race on the same expired session. The first
  // succeeds and writes storage; the second's own request fails
  // transiently, but should see the first's success rather than reject.
  let callCount = 0;
  let resolveSecond;
  globalThis.fetch = () => {
    callCount += 1;
    if (callCount === 1) return Promise.resolve(authResult({ IdToken: 'id-2', ExpiresIn: 3600 }));
    return new Promise((resolve) => { resolveSecond = resolve; });
  };

  const first = getSession();
  const second = getSession();
  const firstResult = await first; // first caller's refresh lands in storage

  resolveSecond({ ok: false, json: async () => ({ __type: 'InternalErrorException', message: 'Internal error' }) });
  const secondResult = await second;

  assert.equal(firstResult.idToken, 'id-2');
  assert.equal(secondResult.idToken, 'id-2'); // sees the concurrent success instead of throwing
  logout();
});

test('logout() clears the local session immediately and revokes the refresh token server-side', async () => {
  mockFetch(authResult({ IdToken: 'id-1', RefreshToken: 'refresh-1', ExpiresIn: 3600 }));
  await login('user', 'pass');

  const requests = [];
  globalThis.fetch = async (_url, options) => {
    requests.push({ target: options.headers['X-Amz-Target'], body: JSON.parse(options.body) });
    return { ok: true };
  };

  logout();

  // Local state is cleared synchronously — not gated on the network call.
  assert.equal(localStorage.getItem('bbb_session'), null);

  await Promise.resolve(); // let the fire-and-forget revoke request go out
  assert.equal(requests[0].target, 'AWSCognitoIdentityProviderService.RevokeToken');
  assert.equal(requests[0].body.Token, 'refresh-1');
});
