import { test } from 'node:test';
import assert from 'node:assert/strict';
import { login, getSession, logout, respondToMfa, startTotpSetup, completeTotpSetup, totpUri } from './auth.js';

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
  const { session } = await login('user', 'pass');
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

// Serves the queued responses in order and records the Cognito operation and
// payload of each call, so a test can assert on the whole multi-step exchange.
function recordFetch(...responses) {
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    calls.push({ target: options.headers['X-Amz-Target'].split('.')[1], body: JSON.parse(options.body) });
    return responses.shift();
  };
  return calls;
}

const ok = (body) => ({ ok: true, json: async () => body });
const fail = (type, message) => ({ ok: false, json: async () => ({ __type: type, message }) });
const tokens = { AuthenticationResult: { IdToken: 'id-mfa', RefreshToken: 'refresh-mfa', ExpiresIn: 3600 } };

test('login() hands back a SOFTWARE_TOKEN_MFA challenge and stores no session yet', async () => {
  logout();
  recordFetch(ok({ ChallengeName: 'SOFTWARE_TOKEN_MFA', Session: 'sess-1', ChallengeParameters: { USER_ID_FOR_SRP: 'uuid-1' } }));
  const result = await login('me@example.com', 'pass');
  assert.deepEqual(result, {
    challenge: { name: 'SOFTWARE_TOKEN_MFA', session: 'sess-1', username: 'uuid-1', label: 'me@example.com' },
  });
  assert.equal(localStorage.getItem('bbb_session'), null); // no tokens until the second factor passes
});

test('login() hands back an MFA_SETUP challenge for a user with no authenticator enrolled', async () => {
  recordFetch(ok({ ChallengeName: 'MFA_SETUP', Session: 'sess-1' }));
  const { challenge } = await login('me@example.com', 'pass');
  assert.equal(challenge.name, 'MFA_SETUP');
  assert.equal(challenge.username, 'me@example.com'); // falls back to what was typed when Cognito gives no id
});

test('login() still rejects a challenge it cannot handle instead of pretending to sign in', async () => {
  recordFetch(ok({ ChallengeName: 'NEW_PASSWORD_REQUIRED', Session: 'sess-1' }));
  await assert.rejects(() => login('me@example.com', 'pass'), /Unexpected challenge: NEW_PASSWORD_REQUIRED/);
  assert.equal(localStorage.getItem('bbb_session'), null);
});

test('respondToMfa() sends the code with the challenge session and stores the resulting session', async () => {
  const calls = recordFetch(ok(tokens));
  const session = await respondToMfa({ session: 'sess-1', username: 'uuid-1' }, '123456');

  assert.equal(calls[0].target, 'RespondToAuthChallenge');
  assert.equal(calls[0].body.ChallengeName, 'SOFTWARE_TOKEN_MFA');
  assert.equal(calls[0].body.Session, 'sess-1');
  assert.deepEqual(calls[0].body.ChallengeResponses, { USERNAME: 'uuid-1', SOFTWARE_TOKEN_MFA_CODE: '123456' });
  assert.equal(session.idToken, 'id-mfa');
  assert.ok(localStorage.getItem('bbb_session'));
  logout();
});

test('respondToMfa() rejects a wrong code with the Cognito error type and stores nothing', async () => {
  logout();
  recordFetch(fail('CodeMismatchException', 'Invalid code received for user'));
  await assert.rejects(
    () => respondToMfa({ session: 'sess-1', username: 'uuid-1' }, '000000'),
    (err) => err.cognitoType === 'CodeMismatchException' && /Invalid code/.test(err.message)
  );
  assert.equal(localStorage.getItem('bbb_session'), null);
});

test('first-time TOTP setup threads the session through every step, then signs in', async () => {
  const calls = recordFetch(
    ok({ SecretCode: 'JBSWY3DPEHPK3PXP', Session: 'sess-2' }),
    ok({ Status: 'SUCCESS', Session: 'sess-3' }),
    ok(tokens)
  );
  const challenge = { name: 'MFA_SETUP', session: 'sess-1', username: 'uuid-1', label: 'me@example.com' };

  const { secret, session: nextSession } = await startTotpSetup(challenge);
  assert.equal(secret, 'JBSWY3DPEHPK3PXP');
  const session = await completeTotpSetup({ ...challenge, session: nextSession }, '123456');

  assert.deepEqual(calls.map((c) => c.target), ['AssociateSoftwareToken', 'VerifySoftwareToken', 'RespondToAuthChallenge']);
  assert.equal(calls[0].body.Session, 'sess-1');
  assert.equal(calls[1].body.Session, 'sess-2'); // the session AssociateSoftwareToken returned, not the original
  assert.equal(calls[1].body.UserCode, '123456');
  assert.equal(calls[2].body.Session, 'sess-3'); // the session VerifySoftwareToken returned
  assert.equal(calls[2].body.ChallengeName, 'MFA_SETUP');
  assert.equal(calls[2].body.ChallengeResponses.USERNAME, 'uuid-1');
  assert.equal(session.idToken, 'id-mfa');
  logout();
});

test('completeTotpSetup() does not sign in when Cognito does not report SUCCESS', async () => {
  logout();
  const calls = recordFetch(ok({ Status: 'ERROR', Session: 'sess-3' }));
  await assert.rejects(() => completeTotpSetup({ session: 'sess-2', username: 'uuid-1' }, '111111'), /not accepted/);
  assert.equal(calls.length, 1); // never proceeded to RespondToAuthChallenge
  assert.equal(localStorage.getItem('bbb_session'), null);
});

test('totpUri() builds an otpauth link with the label and secret encoded', () => {
  assert.equal(
    totpUri('me@example.com', 'JBSWY3DPEHPK3PXP'),
    'otpauth://totp/Badge%20Board%3Ame%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Badge%20Board'
  );
});

test('getSession() treats a corrupt stored session as signed out and clears it, instead of throwing', async () => {
  for (const junk of ['{not json', 'null', '"a string"']) {
    localStorage.setItem('bbb_session', junk);
    assert.equal(await getSession(), null, junk);
    assert.equal(localStorage.getItem('bbb_session'), null, junk);
  }
});

test('logout() does not throw on a corrupt stored session', () => {
  localStorage.setItem('bbb_session', '{not json');
  assert.doesNotThrow(() => logout());
  assert.equal(localStorage.getItem('bbb_session'), null);
});
