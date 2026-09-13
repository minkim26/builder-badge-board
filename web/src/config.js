// Public identifiers only (no secrets) — safe to commit. These are outputs
// of this deployment's own SAM stack (see the Outputs section of
// template.yaml). A fresh `sam deploy` creates a new API and Cognito
// client, so redeploying to a different stack means updating these three
// values here, plus SYNC_URL in tampermonkey/progress-sync.user.js.
// See ../../docs/ARCHITECTURE.md for what each service does.
export const API_URL = 'https://g54rvvnbf8.execute-api.us-east-1.amazonaws.com';
export const COGNITO_REGION = 'us-east-1';
export const COGNITO_CLIENT_ID = '199tf0obo59r30k4lb5s9jfodv';
