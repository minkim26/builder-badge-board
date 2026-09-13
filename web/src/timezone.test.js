import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneOffsetMs, msUntilMidnight } from './timezone.js';

test('zoneOffsetMs reflects standard time (PST, UTC-8)', () => {
  const winter = new Date('2026-01-15T12:00:00Z');
  assert.equal(zoneOffsetMs(winter, 'America/Los_Angeles'), -8 * 60 * 60 * 1000);
});

test('zoneOffsetMs reflects daylight time (PDT, UTC-7)', () => {
  const summer = new Date('2026-07-15T12:00:00Z');
  assert.equal(zoneOffsetMs(summer, 'America/Los_Angeles'), -7 * 60 * 60 * 1000);
});

test('msUntilMidnight accounts for the spring-forward transition, not just the offset at "now"', () => {
  // 2026-03-08 00:00:00 PST, exactly midnight on the day DST starts at 2am.
  // The following midnight is already PDT, so real elapsed time is 23h,
  // not the 24h a same-offset calculation would give.
  const now = new Date('2026-03-08T08:00:00Z');
  assert.equal(msUntilMidnight('America/Los_Angeles', now), 23 * 60 * 60 * 1000);
});
