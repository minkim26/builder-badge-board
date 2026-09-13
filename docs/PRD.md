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
Builder Center profile (`builder.aws.com/profile?tab=badges`). Research found
no public API, and the page is likely a JS-rendered SPA. Resolve with a
**time-boxed investigation (cap: 30-45 minutes)**, in this order:

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
- [ ] **4. React frontend** — public view (reads from API) + admin view
      (Cognito-gated, can edit).
- [ ] **5. Deploy** — Amplify Hosting, connect GitHub repo, add custom
      domain (Route 53 + ACM via Amplify domain management).
- [ ] **6. Scraper investigation** — time-boxed 30-45 min per the decision
      tree above. Build it if feasible; otherwise confirm the manual-entry
      admin flow is solid.
- [ ] **7. End-to-end test + article** — test the full flow, take
      screenshots/recording, write the Builder Center article.

## Open Decisions Log

- **Infra-as-code tooling: AWS SAM.** Decided 2026-09-12. Lambda + API
  Gateway + DynamoDB will be defined in a SAM template and deployed via the
  SAM CLI, rather than console-clicking or CDK. See `ARCHITECTURE.md` for
  how this affects the CRUD and scraper stacks.
