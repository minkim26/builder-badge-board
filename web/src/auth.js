import { COGNITO_REGION, COGNITO_CLIENT_ID } from './config.js';

const IDP_URL = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;
const STORAGE_KEY = 'bbb_session';
// A token that expires mid-flight (checked valid, then rejected by the time
// the request lands) triggers the same logout/refresh-token-loss path as a
// genuinely dead session. Treating it as expired this much early trades a
// negligible amount of the ~1hr lifetime for never racing a real request.
const EXPIRY_BUFFER_MS = 60_000;

// Plain fetch calls — no aws-amplify needed since every step below is a
// single unsigned JSON POST. The Cognito authorizer on the API checks the
// JWT `aud` claim, which only the ID token carries (access tokens carry
// `client_id` instead), so the ID token is what gets sent as Authorization.
async function cognito(target, payload) {
  const res = await fetch(IDP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.message || 'Auth failed');
    err.cognitoType = data.__type; // e.g. "NotAuthorizedException" — distinguishes a rejected credential from a transient failure
    throw err;
  }
  return data;
}

function initiateAuth(authFlow, authParameters) {
  return cognito('InitiateAuth', { AuthFlow: authFlow, ClientId: COGNITO_CLIENT_ID, AuthParameters: authParameters });
}

// Every step that ends in a signed-in user hands back the same shape. A
// challenge we don't handle (e.g. NEW_PASSWORD_REQUIRED — not expected since
// the admin already set a permanent password) surfaces here as an error.
function tokensFrom(data) {
  if (!data.AuthenticationResult) {
    throw new Error(data.ChallengeName ? `Unexpected challenge: ${data.ChallengeName}` : 'Auth failed');
  }
  return data.AuthenticationResult;
}

function saveSession({ IdToken, RefreshToken, ExpiresIn }) {
  const session = { idToken: IdToken, refreshToken: RefreshToken, expiresAt: Date.now() + ExpiresIn * 1000 };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  return session;
}

// The user pool requires TOTP MFA. MFA_SETUP is the very first sign-in (no
// authenticator enrolled yet); SOFTWARE_TOKEN_MFA is every sign-in after.
const MFA_CHALLENGES = ['MFA_SETUP', 'SOFTWARE_TOKEN_MFA'];

// Resolves to { session } if the password alone was enough, or { challenge }
// when Cognito wants a second step before it will issue tokens — hand that to
// respondToMfa() (or startTotpSetup() then completeTotpSetup() for MFA_SETUP).
export async function login(username, password) {
  const data = await initiateAuth('USER_PASSWORD_AUTH', { USERNAME: username, PASSWORD: password });
  if (MFA_CHALLENGES.includes(data.ChallengeName)) {
    return {
      challenge: {
        name: data.ChallengeName,
        session: data.Session,
        // Challenge responses must echo the pool's own id for the user, which
        // Cognito supplies — falls back to what was typed if it's absent.
        username: data.ChallengeParameters?.USER_ID_FOR_SRP ?? username,
        label: username, // for the authenticator app's account name
      },
    };
  }
  return { session: saveSession(tokensFrom(data)) };
}

export async function respondToMfa({ session, username }, code) {
  const data = await cognito('RespondToAuthChallenge', {
    ChallengeName: 'SOFTWARE_TOKEN_MFA',
    ClientId: COGNITO_CLIENT_ID,
    Session: session,
    ChallengeResponses: { USERNAME: username, SOFTWARE_TOKEN_MFA_CODE: code },
  });
  return saveSession(tokensFrom(data));
}

// First-time enrollment. Returns the shared secret to show the user, plus the
// challenge session to carry into completeTotpSetup() — Cognito issues a new
// session at each step and rejects a stale one.
export async function startTotpSetup({ session }) {
  const data = await cognito('AssociateSoftwareToken', { Session: session });
  return { secret: data.SecretCode, session: data.Session };
}

export async function completeTotpSetup({ session, username }, code) {
  const verified = await cognito('VerifySoftwareToken', {
    Session: session,
    UserCode: code,
    FriendlyDeviceName: 'Badge Board admin',
  });
  if (verified.Status !== 'SUCCESS') throw new Error('That code was not accepted — try the next one.');
  const data = await cognito('RespondToAuthChallenge', {
    ChallengeName: 'MFA_SETUP',
    ClientId: COGNITO_CLIENT_ID,
    Session: verified.Session,
    ChallengeResponses: { USERNAME: username },
  });
  return saveSession(tokensFrom(data));
}

// otpauth:// link that most authenticator apps can import (mobile taps it;
// desktop password managers accept it pasted). Avoids a QR-code dependency.
export function totpUri(label, secret) {
  const issuer = 'Badge Board';
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${label}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
}

// A hand-edited or otherwise corrupt entry would make JSON.parse throw, and
// every caller would then report "couldn't check your session" forever —
// retrying can't fix stored bytes. Treat it as no session and clear it.
function readStored() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { raw: null, session: null };
  try {
    const session = JSON.parse(raw);
    if (session && typeof session === 'object') return { raw, session };
  } catch {
    // fall through to clearing it
  }
  localStorage.removeItem(STORAGE_KEY);
  return { raw: null, session: null };
}

// Silent refresh: the ID token is good for ~1hr, the refresh token for 7
// days (RefreshTokenValidity in template.yaml), so this keeps the admin
// signed in across many hourly expirations without ever prompting for a
// password again — only a dead/expired refresh token forces a real
// re-login. A transient failure (network blip, Cognito 5xx) throws instead
// of returning null, so callers don't mistake "couldn't check right now"
// for "not signed in" and log out a perfectly good session.
export async function getSession() {
  const { raw, session } = readStored();
  if (!session) return null;
  if (session.expiresAt - EXPIRY_BUFFER_MS >= Date.now()) return session;
  if (!session.refreshToken) {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }

  try {
    // This app client doesn't rotate refresh tokens, so the response never
    // carries a new one — only idToken/expiresAt change.
    const { IdToken, ExpiresIn } = tokensFrom(
      await initiateAuth('REFRESH_TOKEN_AUTH', { REFRESH_TOKEN: session.refreshToken })
    );
    const refreshed = { ...session, idToken: IdToken, expiresAt: Date.now() + ExpiresIn * 1000 };
    // A logout or a fresh login can happen while the fetch above was in
    // flight — storage may no longer hold the session we started with.
    // Overwriting it unconditionally would resurrect a session the user
    // just logged out of, or clobber a newer one. Defer to whatever's
    // actually there now instead of blindly writing over it.
    const current = localStorage.getItem(STORAGE_KEY);
    if (current !== raw) return current ? JSON.parse(current) : null;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(refreshed));
    return refreshed;
  } catch (err) {
    // Only a rejected credential means the refresh token is actually dead.
    // Anything else (network blip, Cognito 5xx) is transient: rethrow so the
    // caller treats it as "couldn't check right now", not "not signed in" —
    // returning null here would look identical to a dead session and lead
    // the caller to send an unauthenticated request, get a 401, and log out
    // (deleting the very refresh token this branch is trying to keep).
    if (err.cognitoType !== 'NotAuthorizedException') throw err;
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function logout() {
  const { session } = readStored();
  localStorage.removeItem(STORAGE_KEY);
  const refreshToken = session?.refreshToken;
  if (!refreshToken) return;
  // Best-effort and fire-and-forget: local logout must not wait on or be
  // undone by this failing. Without it, a refresh token copied via XSS
  // stays valid at Cognito for the full RefreshTokenValidity (7 days) even
  // after the legitimate user "logs out" — clearing localStorage alone
  // only hides the token from this tab, it doesn't revoke it.
  fetch(IDP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.RevokeToken',
    },
    body: JSON.stringify({ ClientId: COGNITO_CLIENT_ID, Token: refreshToken }),
  }).catch(() => {});
}
