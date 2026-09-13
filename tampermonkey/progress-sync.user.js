// ==UserScript==
// @name         Builder Badge Board - Progress Sync
// @namespace    builder-badge-board
// @version      1.1
// @description  Passively captures AWS Builder Center in-progress badge counts and syncs them to Builder Badge Board.
// @match        https://builder.aws.com/*
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      execute-api.us-east-1.amazonaws.com
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // builder.aws.com's CSP has no 'unsafe-inline', so @grant none (which
  // Tampermonkey can implement by injecting a plain inline <script> tag)
  // gets silently blocked. @grant unsafeWindow forces Tampermonkey to use
  // its extension-level content-script injection instead, which runs
  // outside the page's CSP — and unsafeWindow is the real page window,
  // needed so the patched fetch is the one the site's own code calls.
  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  const SYNC_URL = 'https://g54rvvnbf8.execute-api.us-east-1.amazonaws.com/badges/progress-sync';
  const SYNC_KEY = 'REPLACE_WITH_YOUR_SYNC_KEY'; // set locally in Tampermonkey — never commit the real value

  // Passive interception instead of calling a known endpoint: this app
  // doesn't know the real URL (it's on a private, logged-in-only page and
  // requires MFA to reach), so instead of replicating the request, this
  // just watches for whichever response happens to carry the data while
  // you browse normally.
  const originalFetch = pageWindow.fetch;
  pageWindow.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    response
      .clone()
      .json()
      .then((data) => {
        if (data && Array.isArray(data.badgeProgressList)) {
          syncProgress(data.badgeProgressList);
        }
      })
      .catch(() => {}); // not JSON, or not the response we're looking for
    return response;
  };

  function syncProgress(list) {
    // Earned badges are already handled by the app's own nightly sync
    // against a public endpoint — only forward what's still in progress
    // so the two paths never write conflicting data for the same badge.
    const items = list
      .filter((b) => b.status === 'IN_PROGRESS')
      .map((b) => ({
        badgeId: b.baseBadge.badgeId,
        name: b.baseBadge.displayName,
        progress: b.progressCount,
      }));

    if (items.length === 0) return;

    // A plain fetch/XHR here — even via the saved originalFetch — still runs
    // as a request from builder.aws.com's own document, so the page's CSP
    // connect-src (which doesn't allowlist our API Gateway domain) blocks it.
    // GM_xmlhttpRequest instead runs the request from Tampermonkey's own
    // extension context, entirely outside the page's CSP and CORS.
    GM_xmlhttpRequest({
      method: 'POST',
      url: SYNC_URL,
      headers: { 'Content-Type': 'application/json', 'X-Sync-Key': SYNC_KEY },
      data: JSON.stringify({ items }),
      onload: (res) => {
        const result = JSON.parse(res.responseText);
        console.log('[badge-board] synced', result.synced, 'in-progress badges');
      },
      onerror: (err) => console.error('[badge-board] sync failed', err),
    });
  }
})();
