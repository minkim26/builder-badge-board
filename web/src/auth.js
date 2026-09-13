import { COGNITO_REGION, COGNITO_CLIENT_ID } from './config.js';

const IDP_URL = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;
const STORAGE_KEY = 'bbb_session';

// Plain InitiateAuth call — no aws-amplify needed since USER_PASSWORD_AUTH
// is a single unsigned JSON POST. The Cognito authorizer on the API checks
// the JWT `aud` claim, which only the ID token carries (access tokens carry
// `client_id` instead), so the ID token is what gets sent as Authorization.
export async function login(username, password) {
  const res = await fetch(IDP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: { USERNAME: username, PASSWORD: password },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Login failed');
  }
  if (!data.AuthenticationResult) {
    // e.g. NEW_PASSWORD_REQUIRED — not expected since the admin already set a password
    throw new Error(data.ChallengeName ? `Unexpected challenge: ${data.ChallengeName}` : 'Login failed');
  }

  const { IdToken, ExpiresIn } = data.AuthenticationResult;
  const session = { idToken: IdToken, expiresAt: Date.now() + ExpiresIn * 1000 };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  return session;
}

// ponytail: no silent refresh — session just expires after ~1hr and the
// admin logs in again. Add REFRESH_TOKEN_AUTH if this becomes annoying.
export function getSession() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const session = JSON.parse(raw);
  if (session.expiresAt < Date.now()) {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
  return session;
}

export function logout() {
  localStorage.removeItem(STORAGE_KEY);
}
