# Progress Sync Userscript

Automates the one thing the backend can't reach on its own: in-progress
badge counts. That data only exists on a private, logged-in Builder Center
page behind MFA — no public API, so this runs in your own browser instead
of a server, using your own already-logged-in session. See
`docs/PRD.md`'s Scraper Decision Tree for why.

## What it does

Passively watches network responses on `builder.aws.com` for whichever one
contains your badge progress, and forwards only the still-in-progress
badges to the app's `/badges/progress-sync` endpoint. Earned badges are
handled separately by the app's own nightly sync, so the two never
conflict.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) for your browser.
2. Tampermonkey icon -> Dashboard -> "+" (create a new script).
3. Paste in the contents of `progress-sync.user.js`.
4. Replace `REPLACE_WITH_YOUR_SYNC_KEY` with the real key (ask whoever set
   up the deployment — it's a deploy-time secret, not in this repo).
5. Save (Ctrl+S / Cmd+S).
6. Browse to your Builder Center profile/dashboard as you normally would.
   Open the browser console (F12) to confirm you see
   `[badge-board] synced N in-progress badges`.

## Notes

- Only runs while you have a `builder.aws.com` tab open and it happens to
  load your progress data — not a scheduled background job. Check in on it
  occasionally rather than assuming it fires nightly.
- The sync key only grants write access to this app's own badge data. If
  it ever leaks, rotate it by redeploying the stack with a new
  `SyncKey` parameter value — nothing else needs to change.
