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

## Build

```bash
npm run build --prefix web
```

## Deploy

Backend (Lambda + API Gateway + DynamoDB + Cognito, via SAM):

```bash
sam build
sam deploy --guided   # first time only; no samconfig.toml is committed, so
                       # subsequent deploys need: sam deploy --stack-name
                       # builder-badge-board --region us-east-1
```

Guided deploy will prompt for two parameters: `BuilderProfileId` (your AWS
Builder Center profile ID, has a default) and `SyncKey` (a secret you make
up yourself; no default, never commit it).

`sam deploy` prints an API Gateway URL and a Cognito user pool/client ID.
Copy those into `web/src/config.js`, and copy the API URL into `SYNC_URL`
in `tampermonkey/progress-sync.user.js`, since a fresh stack has different
values than the ones already committed there.

After the first deploy, create the one admin user by hand in the Cognito
console (the stack creates the User Pool, but there's no signup flow). Set
a permanent password when you create it rather than a temporary one: the
login form doesn't handle Cognito's forced password-reset challenge, so a
temporary password leaves the account unable to sign in until you either
reset it via `aws cognito-idp admin-set-user-password --permanent` or check
the console's equivalent option. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the auth flow this sets up.

Earned badges sync on their own, both from a "Sync from Builder Center"
button in the admin panel and from a nightly EventBridge schedule.
In-progress badges need a one-time browser setup instead: see
[tampermonkey/README.md](tampermonkey/README.md) for the userscript that
handles it.

Frontend: **not yet connected.** Once an Amplify Hosting app is connected to
this repo (`amplify.yml` at the repo root is already set up for this),
pushing to the connected branch will build and deploy automatically. Until
then, `npm run build --prefix web` only builds locally.
