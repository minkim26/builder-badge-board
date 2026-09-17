# Builder Badge Board — Product Requirements

## Goal

A personal tool that does double duty:

1. **Public showcase page** — badges earned/in-progress on AWS Builder Center,
   plus published articles — designed to be shown to recruiters as a
   portfolio piece.
2. **Private admin view** — gated to the user only, for adding/editing badge
   and article entries.

Built for the AWS Weekend Deployment Challenge — see `CHALLENGE.md` for the
full rules that shape scope and deadline. Deploy by Saturday, write the
article Sunday.

## User Stories

**Public visitor (recruiter, etc.)**
- Can view a list of badges the user has earned or is in progress on, with
  status and date earned where applicable.
- Can view a list of the user's published Builder Center articles, with
  title, link, publish date, and tags.
- Needs no login.

**Admin (the user, single account)**
- Can log in via Cognito.
- Can add, edit, and delete badge entries.
- Can add, edit, and delete article entries.
- Is the only account that can ever exist for this app.

## Scope / Non-Goals

- **Not a multi-user product.** No signup/registration flow. One Cognito
  user, created manually in the console.
- **Not single-table DynamoDB design.** Two simple tables instead — see Data
  Model below. Single-table design is a "what I'd do differently at scale"
  line in the article, not something built this weekend.
- **Not a headless-browser scraper**, unless the time-boxed investigation
  (see Scraper Decision below) turns up a cheap alternative. Manual entry via
  the admin panel is an acceptable, fully-compliant data source on its own.
- **Bedrock/Nova AI summary is a stretch goal only** — nice to have, not
  required to qualify.

## Architecture Summary

React frontend on Amplify Hosting, API Gateway + Lambda for CRUD, DynamoDB
for storage, Cognito for single-user admin auth, optionally EventBridge +
Lambda for scraping. Infra provisioned via AWS SAM. Full technical detail,
diagrams, and data flow live in `ARCHITECTURE.md` — this section is
intentionally brief.

## Data Model

Two DynamoDB tables (not single-table design — see Scope above):

- **`Badges`** — badge name, status (`earned` / `in-progress`), date earned
  (if applicable).
- **`Articles`** — title, URL, publish date, tags.

Partition key can be a fixed constant or the user's builder ID — this is
single-user, so key design doesn't need to do more than that.

## Scraper Decision Tree

Original plan: EventBridge-scheduled Lambda auto-scrapes the user's public
Builder Center profile (`builder.aws.com/profile?tab=badges`). The page is a
JS-rendered SPA with no embedded data, so an automated (non-browser)
investigation can't find the underlying API — resolve with a **time-boxed
investigation (cap: 30-45 minutes)**, in this order:

1. Open the profile in Chrome DevTools → Network tab, filter Fetch/XHR,
   reload. If there's an internal JSON endpoint powering the badges UI, call
   it directly from Lambda.
2. If no JSON endpoint, check "view source" for server-rendered HTML with
   embedded data. If present, parse with Cheerio.
3. If the data is only available after client-side JS execution with no
   exposed API or embedded data: **do not** reach for a headless browser
   (Playwright/Puppeteer in Lambda) — too much complexity and cold-start/
   layer-size risk for a weekend project. Fall back to manual entry via the
   admin panel as the actual data source, and note the investigation as
   "what I explored / would build next" in the article.

If a scraper does get built: EventBridge Scheduler (daily or ~every 12h)
triggers a Lambda that fetches/parses the profile and upserts into DynamoDB.

## Build Plan

- [x] **1. AWS account basics** — set a budget alert, create an IAM user
      (not root) for CLI/console work.
- [x] **2. DynamoDB tables** — design and create `Badges` and `Articles`.
- [x] **3. CRUD API** — build Lambda + API Gateway (list badges, list
      articles, add/update/delete entries). Test with curl/Postman before
      touching the frontend.
- [x] **4. React frontend** — public view (reads from API) + admin view
      (Cognito-gated, can edit).
- [x] **5. Deploy** — Amplify Hosting, connect GitHub repo, add custom
      domain (`builder.minkim26.tech`, registered at a third-party registrar,
      not Route 53; ACM cert provisioned via Amplify domain management).
- [x] **6. Scraper investigation** — resolved 2026-09-13. Automated curl/
      WebFetch attempts found nothing (pure client-rendered SPA, no
      server-rendered HTML or embedded JSON — guessed REST paths under
      `api.builder.aws.com` returned CloudFront/S3 `AccessDenied`). But a
      manual Chrome DevTools Network-tab check (step 1 of the decision
      tree — needs a real browser, which the agent doing steps 1-2 didn't
      have) found the real endpoint:
      `GET https://api.builder.aws.com/rms/badges?bpId=<profile-id>&locale=en&size=N`.
      It's a public read — no `Authorization` header, just a placeholder
      `builder-session-token: dummy` — returning each earned badge's
      official `badgeId`/`displayName`/`description`/`awardedDate`. CORS
      only allows `https://builder.aws.com`, so a browser on our own
      domain can't call it directly, but a server-side call has no such
      restriction. Used it for a one-time manual backfill (direct `aws
      dynamodb batch-write-item` into the live `Badges` table, run once
      from a terminal — not deployed as code) instead of building the
      originally-planned EventBridge scraper Lambda.

      Follow-up 2026-09-13: added a real **"Sync from Builder Center"**
      button (`POST /badges/sync`, Cognito-protected) instead of leaving
      it as a one-off manual backfill. The Lambda calls the same public
      `rms/badges` endpoint server-side (no CORS restriction there) with
      `bpId` hardcoded as a `BUILDER_PROFILE_ID` env var — same
      single-user pattern as `USER_ID = 'me'`, no per-user URL input
      needed. Upserts by AWS's own `badgeId` so re-syncing is idempotent.
      Scope is intentionally narrow: **earned badges only.** No public
      endpoint for in-progress badges (with real progress counts) was
      found despite several DevTools rounds — that data was captured
      once by hand and still needs manual re-entry to update. This whole
      feature rests on an undocumented, unauthenticated internal AWS API
      with zero stability guarantee (could change or get blocked without
      notice) — a disclosed tradeoff, not a real integration; manual
      entry via the admin panel remains the documented fallback.

      Follow-up 2026-09-13: added an `AWS::Events::Rule` (SAM `Schedule`
      event) that invokes the same sync logic nightly at ~midnight PT
      (`cron(0 7 * * ? *)` — a `ponytail:` comment flags the ~1hr DST
      drift once PT switches to PST in November; not worth a
      timezone-aware expression for a personal badge counter).

      In-progress badge automation was investigated to a conclusion, not
      abandoned: the `badgeProgressList` response was only ever seen on a
      **private, logged-in dashboard page** — the same request does not
      exist at all when logged out (confirmed via an incognito reload of
      the same page). That's a materially different thing from the
      earned-badges endpoint, which needs no real credential. Two
      server-side automation options were considered and rejected:
      storing a live Builder Center session cookie in the project (a
      working credential heading into a public GitHub repo, and one
      that expires, so it wouldn't even be unattended), and a scheduled
      GitHub Action doing a headless Playwright login (ruled out once
      login turned out to require MFA/a 6-digit code, which can't be
      scripted).

      Follow-up 2026-09-13: automated anyway, client-side.
      `tampermonkey/progress-sync.user.js` runs in the user's own
      browser, using their own already-authenticated session — no
      credential ever enters the project. It passively monkey-patches
      `fetch` (via `unsafeWindow`, since the page's CSP blocks a plain
      inline-script injection) and watches for whichever response
      happens to carry `badgeProgressList` while the user browses
      normally, forwarding only `IN_PROGRESS` items to a new
      `POST /badges/progress-sync` route. That route has no Cognito
      authorizer (the userscript can't do an interactive login either)
      and is instead protected by a `SYNC_KEY` shared secret checked in
      the handler — an app-specific, instantly-revocable secret, not a
      real AWS or Builder Center credential. **Revised decision:
      in-progress badges (9/21) are automated via the userscript when a
      matching tab happens to be open; manual entry via the admin panel
      remains the fallback for whenever it isn't.**

      Confirmed working end-to-end 2026-09-13, after two real bugs found
      via live console debugging: (1) `@grant none` gets Tampermonkey to
      inject a literal inline `<script>` tag, which builder.aws.com's CSP
      silently blocks (no `unsafe-inline`) — fixed by declaring
      `@grant unsafeWindow` instead, which switches Tampermonkey to
      extension-level content-script injection, running outside the
      page's CSP entirely. (2) Even with that fix, calling the page's own
      `fetch` (via `unsafeWindow`) to reach our API Gateway endpoint still
      executes as a request from the page's document, so the page's CSP
      `connect-src` (which doesn't allowlist our domain) blocked it —
      fixed by using Tampermonkey's `GM_xmlhttpRequest` instead, which
      runs the request from the extension's own context, bypassing page
      CSP and CORS entirely. First real sync wrote all 9 in-progress
      badges with correct live progress counts.

      Follow-up 2026-09-16: fixed the DST drift flagged above. Switched
      `NightlySync` from the classic `Schedule` event (`AWS::Events::Rule`,
      UTC-only) to SAM's `ScheduleV2` event (`AWS::Scheduler::Schedule`),
      with `ScheduleExpressionTimezone: America/Los_Angeles` so EventBridge
      Scheduler itself handles the PDT/PST transition.
- [ ] **7. End-to-end test + article** — test the full flow, take
      screenshots/recording, write the Builder Center article.

## Open Decisions Log

- **Infra-as-code tooling: AWS SAM.** Decided 2026-09-12. Lambda + API
  Gateway + DynamoDB will be defined in a SAM template and deployed via the
  SAM CLI, rather than console-clicking or CDK. See `ARCHITECTURE.md` for
  how this affects the CRUD and scraper stacks.
