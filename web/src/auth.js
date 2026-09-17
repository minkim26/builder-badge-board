import { COGNITO_REGION, COGNITO_CLIENT_ID } from './config.js';

const IDP_URL = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;
const STORAGE_KEY = 'bbb_session';

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

// Silent refresh: the ID token is good for ~1hr, the refresh token for 30
// days (App Client default), so this keeps the admin signed in across many
// hourly expirations without ever prompting for a password again — only a
// dead/expired refresh token forces a real re-login.
export async function getSession() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const session = JSON.parse(raw);
  if (session.expiresAt >= Date.now()) return session;
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(refreshed));
    return refreshed;
  } catch (err) {
    // Only a rejected credential means the refresh token is actually dead —
    // a network blip or a Cognito 5xx shouldn't destroy a still-good one.
    if (err.cognitoType === 'NotAuthorizedException') {
      localStorage.removeItem(STORAGE_KEY);
    }
    return null;
  }
}

export function logout() {
  localStorage.removeItem(STORAGE_KEY);
}
