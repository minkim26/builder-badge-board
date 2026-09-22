# Builder Badge Board

A personal AWS Builder Center badge/article showcase, with a Cognito-gated
admin panel for managing entries. See [docs/PRD.md](docs/PRD.md) for what it
does and why, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it's put
together, and [docs/CHALLENGE.md](docs/CHALLENGE.md) for the AWS Weekend
Deployment Challenge rules this was built for.

## Prerequisites

- Node.js (LTS) and npm
- AWS CLI, configured with a non-root IAM user
- AWS SAM CLI

The Cognito user pool itself is created by the SAM stack below, so there's
nothing to set up by hand ahead of time.

## Setup (local dev)

```bash
git clone https://github.com/minkim26/builder-badge-board.git
cd builder-badge-board
npm install --prefix web
```

API Gateway base URL and Cognito pool/client IDs are public identifiers,
hardcoded in `web/src/config.js`, so no `.env` is needed.

## Run

```bash
npm run dev --prefix web
```

The dev server runs on `localhost:5173`, which isn't in the API's CORS
allow list, so it can't call the deployed API out of the box. To develop
against it, temporarily add `http://localhost:5173` to `AllowOrigins` in
`template.yaml` and `sam deploy` (don't commit that), or test on the
deployed site.

## Build

```bash
npm run build --prefix web
```

## Deploy

Backend (Lambda + API Gateway + DynamoDB + Cognito, via SAM):

```bash
sam build
sam deploy --guided   # first time only; subsequent deploys: sam deploy
```

Before the first deploy, create two SSM parameters:

```bash
aws ssm put-parameter --name /builder-badge-board/alert-email \
  --type String --value you@example.com

aws ssm put-parameter --name /builder-badge-board/sync-key \
  --type SecureString --value "$(openssl rand -hex 32)"
```

After the first deploy: create the admin user, wire the stack outputs into
`web/src/config.js` and `customHttp.yml`, and confirm the SNS alert
subscription. Earned badges then sync on their own (a button in the admin
panel plus a nightly job); in-progress badges need a one-time userscript —
see [tampermonkey/README.md](tampermonkey/README.md).

**Full runbook — guided-deploy parameters, sync-key rotation, the MFA
cutover order for existing deployments, and the Amplify CI wiring — is in
[docs/DEPLOY.md](docs/DEPLOY.md).**

Frontend is Amplify Hosting, deployed by CI (not Amplify's own auto-build)
after tests pass on `main`. Live at
[https://builder.minkim26.tech](https://builder.minkim26.tech), also
reachable at `https://main.d2xsuyav9vi5h7.amplifyapp.com`.
