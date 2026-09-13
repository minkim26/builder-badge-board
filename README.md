# Builder Badge Board

A personal AWS Builder Center badge/article showcase, with a Cognito-gated
admin panel for managing entries. See `docs/PRD.md` for what it does and why.

## Prerequisites

- Node.js (LTS) and npm
- AWS CLI, configured with a non-root IAM user
- AWS SAM CLI
- An AWS account with a Cognito user pool + user already created

## Setup (local dev)

```bash
git clone <repo-url>
cd aws_builder_dashboard
npm install --prefix frontend
```

Copy `.env.example` to `.env` in `frontend/` and fill in the API Gateway
base URL and Cognito pool/client IDs once the backend stack is deployed.

## Run

```bash
npm start --prefix frontend
```

## Build

```bash
npm run build --prefix frontend
```

## Deploy

Backend (Lambda + API Gateway + DynamoDB, via SAM):

```bash
sam build
sam deploy --guided   # first time only; subsequent deploys: sam deploy
```

Frontend: push to the connected GitHub branch — Amplify Hosting builds and
deploys automatically.
