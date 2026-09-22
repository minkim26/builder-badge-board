# Deploy Runbook

Operational detail for deploying and maintaining this stack. The
[README](../README.md) covers the quickstart (`sam build && sam deploy`,
the two SSM parameters); this covers the rest: guided-deploy parameters,
rotating secrets, the MFA cutover order, and the Amplify CI wiring.

## Backend (SAM)

Stack name, region, and capabilities live in `samconfig.toml`, so a bare
`sam deploy` works after the first guided run.

Nothing secret is passed on the command line. The stack only knows the sync
key's *name* (the Lambda reads the value itself at runtime); the alert
address is looked up at deploy time, which is fine since it isn't a secret,
just something to keep out of this public repo. Create both parameters
before the first deploy:

```bash
aws ssm put-parameter --name /builder-badge-board/alert-email \
  --type String --value you@example.com

aws ssm put-parameter --name /builder-badge-board/sync-key \
  --type SecureString --value "$(openssl rand -hex 32)"
```

Upgrading a stack that already exists (it used to take the sync key as a
`SyncKey` deploy parameter)? Create `/builder-badge-board/sync-key` *before*
running `sam deploy`, or `progress-sync` answers 500 until you do. Put your
current key in it to keep the userscript working, or use a new random one
and paste that into the userscript.

Guided deploy prompts for three parameters, all with defaults you should
leave alone: `BuilderProfileId` (your AWS Builder Center profile ID),
`AlertEmail` and `SyncKeyParameter` (the SSM parameter *names* above, not
the values).

After the first deploy, SNS emails a confirmation link to the alert
address. Alarm emails don't reach you until you click it.

`sam deploy` prints an API Gateway URL and a Cognito user pool/client ID.
Copy those into `web/src/config.js`, copy the API URL into `SYNC_URL` in
`tampermonkey/progress-sync.user.js`, and update the API host in the
`connect-src` of the Content-Security-Policy in `customHttp.yml` — a fresh
stack has different values than the ones already committed there.

## Rotating the sync key

```bash
aws ssm put-parameter --name /builder-badge-board/sync-key \
  --type SecureString --overwrite --value "$(openssl rand -hex 32)"
```

Then paste the new value into the userscript. The Lambda caches the key for
up to five minutes, so a warm function keeps accepting the old key for that
long — expect a few 401s right after rotating, and each one counts toward
the wrong-key alarm (five in five minutes emails you). That's expected once;
give it five minutes before investigating. If the parameter is missing or
unreadable instead, `progress-sync` answers 500 and the API 5xx alarm
fires.

## Admin user

Create the one admin user by hand in the Cognito console (the stack creates
the User Pool, but there's no signup flow). Set a **permanent** password
when you create it, not a temporary one: the login form doesn't handle
Cognito's forced password-reset challenge, so a temporary password leaves
the account unable to sign in until you reset it via
`aws cognito-idp admin-set-user-password --permanent` or the console's
equivalent. See [ARCHITECTURE.md](ARCHITECTURE.md) for the auth flow this
sets up.

The user pool requires TOTP MFA. On that user's first sign-in the form shows
a secret key to add to an authenticator app (1Password, Google
Authenticator, Authy) and asks for its 6-digit code; every sign-in after
that asks for a code.

### Turning MFA on for an existing deployment: order matters

The sign-in form has to know how to answer MFA challenges before the pool
starts issuing them, or `#admin` can't sign in. Merge first and let the
frontend deploy, confirm the site is live, then run `sam deploy`. Merging
alone doesn't prove the frontend deployed (deploys are gated behind CI), so
check that the new build is serving:

```bash
curl -sI https://builder.minkim26.tech | grep -i content-security-policy
```

That prints the CSP header only once the new `customHttp.yml` is live. If
sign-in breaks anyway, switch MFA off from the CLI while you debug.
CloudFormation only applies changes to the template, so it will not turn MFA
back on by itself: the template keeps saying `ON` while the pool stays off
until you re-enable it.

```bash
aws cognito-idp set-user-pool-mfa-config \
  --user-pool-id <UserPoolId from the stack outputs> --mfa-configuration OFF

# once sign-in is fixed:
aws cognito-idp set-user-pool-mfa-config \
  --user-pool-id <UserPoolId from the stack outputs> \
  --mfa-configuration ON --software-token-mfa-configuration Enabled=true
```

## Frontend (Amplify Hosting)

The Amplify Hosting app is connected to this repo. `amplify.yml` at the repo
root configures the build, and `customHttp.yml` (also at the root, as
Amplify requires for a monorepo) makes the hashed `/assets/*` files
cache-forever so browsers stop revalidating them.

Amplify's own auto-build on `main` is off. Instead, the `deploy` job in
`.github/workflows/ci.yml` starts an Amplify build through an incoming
webhook, but only after tests pass on `main` and only when `web/`,
`tampermonkey/progress-sync.user.js` (bundled into the admin page),
`amplify.yml`, or `customHttp.yml` changed. Backend-only and docs-only
pushes don't spend any Amplify build minutes. To build the current tip of
`main` by hand — for example after a run that failed:

```bash
aws amplify start-job --app-id d2xsuyav9vi5h7 --branch-name main \
  --job-type RELEASE --region us-east-1
```

### One-time setup

Already done for this deployment; keep for reference if the stack is ever
recreated. Run before merging the change that adds the `deploy` job, so
there's no gap in deploys and no double build:

```bash
# 1. Create the incoming webhook and store it as a GitHub secret. The URL
#    carries a token, so it's piped straight in instead of printed.
aws amplify create-webhook --app-id d2xsuyav9vi5h7 --branch-name main \
  --description ci-deploy --region us-east-1 \
  --query webhook.webhookUrl --output text \
  | gh secret set AMPLIFY_WEBHOOK_URL --repo minkim26/builder-badge-board

# 2. Turn off Amplify's auto-build on main
aws amplify update-branch --app-id d2xsuyav9vi5h7 --branch-name main \
  --no-enable-auto-build --region us-east-1
```

To go back to Amplify's own auto-build, run the second command with
`--enable-auto-build`, then delete the webhook and the secret.

The app is live at
[https://builder.minkim26.tech](https://builder.minkim26.tech). DNS is
managed by a third-party registrar rather than Route 53, so the
certificate-validation and subdomain records were added by hand (see
[ARCHITECTURE.md](ARCHITECTURE.md)). It also remains reachable at
`https://main.d2xsuyav9vi5h7.amplifyapp.com`.
