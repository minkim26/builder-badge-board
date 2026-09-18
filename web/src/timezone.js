// Every stored timestamp in this app is a UTC ISO-8601 string — one absolute
// instant, no timezone attached (see handler.js's `new Date().toISOString()`
// writes). Timezone only matters when turning that instant into something a
// human reads, so the conversion happens here, once, at display time — not
// in the backend, and not baked into stored data.
//
// The timezone *value* itself is a single site-wide setting persisted via
// GET/PUT /settings (see api.js) rather than per-browser localStorage — it
// represents the site owner's real timezone, not a per-visitor preference.
export const DEFAULT_TIMEZONE = 'America/Los_Angeles';
export const TIMEZONE_OPTIONS = [
  { value: 'America/Los_Angeles', label: 'Pacific' },
  { value: 'America/Denver', label: 'Mountain' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/New_York', label: 'Eastern' },
  { value: 'UTC', label: 'UTC' },
];

// Wall-clock date/time fields for `date` as seen in `timeZone`.
function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, min: get('minute'), s: get('second') };
}

// `timeZone`'s current offset from UTC, in ms, read from its actual wall
// clock rather than a fixed rule, so it's correct on both sides of a DST
// transition. Exported for the test in timezone.test.js.
export function zoneOffsetMs(date, timeZone) {
  const { y, m, d, h, min, s } = zonedParts(date, timeZone);
  return Date.UTC(y, m - 1, d, h, min, s) - date.getTime();
}

export function dateKeyFor(timeZone) {
  const { y, m, d } = zonedParts(new Date(), timeZone);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Real elapsed ms until the next local midnight in `timeZone`. Computed as
// a true UTC instant via one fixed-point correction: a first-pass estimate
// using the offset at `now`, then re-reading the offset at that estimate,
// since on the day a DST transition happens the offset at the target
// midnight can differ from the offset right now. `now` is a parameter
// (not just `new Date()` internally) so this is directly testable.
export function msUntilMidnight(timeZone, now = new Date()) {
  const { y, m, d } = zonedParts(now, timeZone);
  const wallMidnight = Date.UTC(y, m - 1, d + 1, 0, 0, 0);
  const candidate = new Date(wallMidnight - zoneOffsetMs(now, timeZone));
  const nextMidnightUTC = wallMidnight - zoneOffsetMs(candidate, timeZone);
  return nextMidnightUTC - now.getTime();
}

export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

// Formats a stored timestamp (Date or ISO string) for display in `timeZone`.
export function formatTimestamp(timestamp, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

export function formatDateLabel(timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}

export function timezoneAbbrev(timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')?.value;
}
