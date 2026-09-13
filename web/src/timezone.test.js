import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneOffsetMs } from './timezone.js';

test('zoneOffsetMs reflects standard time (PST, UTC-8)', () => {
  const winter = new Date('2026-01-15T12:00:00Z');
  assert.equal(zoneOffsetMs(winter, 'America/Los_Angeles'), -8 * 60 * 60 * 1000);
});

test('zoneOffsetMs reflects daylight time (PDT, UTC-7)', () => {
  const summer = new Date('2026-07-15T12:00:00Z');
  assert.equal(zoneOffsetMs(summer, 'America/Los_Angeles'), -7 * 60 * 60 * 1000);
});
