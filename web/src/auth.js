import { COGNITO_REGION, COGNITO_CLIENT_ID } from './config.js';

const IDP_URL = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;
const STORAGE_KEY = 'bbb_session';
// A token that expires mid-flight (checked valid, then rejected by the time
// the request lands) triggers the same logout/refresh-token-loss path as a
// genuinely dead session. Treating it as expired this much early trades a
// negligible amount of the ~1hr lifetime for never racing a real request.
const EXPIRY_BUFFER_MS = 60_000;

// Plain InitiateAuth call — no aws-amplify needed since both flows below are
// a single unsigned JSON POST. The Cognito authorizer on the API checks the
// JWT `aud` claim, which only the ID token carries (access tokens carry
// `client_id` instead), so the ID token is what gets sent as Authorization.
async function initiateAuth(authFlow, authParameters) {
  const res = await fetch(IDP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({ AuthFlow: authFlow, ClientId: COGNITO_CLIENT_ID, AuthParameters: authParameters }),
  });

  const data = await res.json();
  if (!res.ok || !data.AuthenticationResult) {
    // e.g. NEW_PASSWORD_REQUIRED on login — not expected since the admin already set a password
    const err = new Error(data.message || (data.ChallengeName ? `Unexpected challenge: ${data.ChallengeName}` : 'Auth failed'));
    err.cognitoType = data.__type; // e.g. "NotAuthorizedException" — distinguishes a rejected credential from a transient failure
    throw err;
  }
  return data.AuthenticationResult;
}

export async function login(username, password) {
  const { IdToken, RefreshToken, ExpiresIn } = await initiateAuth('USER_PASSWORD_AUTH', {
    USERNAME: username,
    PASSWORD: password,
  });
  const session = { idToken: IdToken, refreshToken: RefreshToken, expiresAt: Date.now() + ExpiresIn * 1000 };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  return session;
}

// Silent refresh: the ID token is good for ~1hr, the refresh token for 7
// days (RefreshTokenValidity in template.yaml), so this keeps the admin
// signed in across many hourly expirations without ever prompting for a
// password again — only a dead/expired refresh token forces a real
// re-login. A transient failure (network blip, Cognito 5xx) throws instead
// of returning null, so callers don't mistake "couldn't check right now"
// for "not signed in" and log out a perfectly good session.
export async function getSession() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const session = JSON.parse(raw);
  if (session.expiresAt - EXPIRY_BUFFER_MS >= Date.now()) return session;
  if (!session.refreshToken) {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }

  try {
    // This app client doesn't rotate refresh tokens, so the response never
    // carries a new one — only idToken/expiresAt change.
    const { IdToken, ExpiresIn } = await initiateAuth('REFRESH_TOKEN_AUTH', {
      REFRESH_TOKEN: session.refreshToken,
    });
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
    // A concurrent call (e.g. React StrictMode double-invoking the mount
    // effect) can already have refreshed this same session by the time this
    // one fails — check storage before deciding this call failed at all.
    const current = localStorage.getItem(STORAGE_KEY);
    if (current !== raw) return current ? JSON.parse(current) : null;
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
  const raw = localStorage.getItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_KEY);
  const refreshToken = raw && JSON.parse(raw).refreshToken;
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
