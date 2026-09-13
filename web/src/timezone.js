// Every stored timestamp in this app is a UTC ISO-8601 string — one absolute
// instant, no timezone attached (see handler.js's `new Date().toISOString()`
// writes). Timezone only matters when turning that instant into something a
// human reads, so the conversion happens here, once, at display time — not
// in the backend, and not baked into stored data.
export const TIMEZONE_STORAGE_KEY = 'badge-board-timezone';
export const DEFAULT_TIMEZONE = 'America/Los_Angeles';
export const TIMEZONE_OPTIONS = [
  { value: 'America/Los_Angeles', label: 'Pacific' },
  { value: 'America/Denver', label: 'Mountain' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/New_York', label: 'Eastern' },
  { value: 'UTC', label: 'UTC' },
];

export function getStoredTimezone() {
  try {
    return localStorage.getItem(TIMEZONE_STORAGE_KEY) || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function setStoredTimezone(tz) {
  try {
    localStorage.setItem(TIMEZONE_STORAGE_KEY, tz);
  } catch {
    // private browsing / storage disabled — just won't persist
  }
}

// A Date whose getFullYear/getHours/etc. read as the wall-clock time in
// `timeZone` — its own getTime() isn't a real UTC instant, but subtracting
// two such Dates still gives an accurate duration, which is all
// dateKeyFor/msUntilMidnight below need it for.
export function zonedNow(timeZone) {
  return new Date(new Date().toLocaleString('en-US', { timeZone }));
}

export function dateKeyFor(timeZone) {
  const z = zonedNow(timeZone);
  return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`;
}

export function msUntilMidnight(timeZone) {
  const z = zonedNow(timeZone);
  const midnight = new Date(z);
  midnight.setHours(24, 0, 0, 0);
  return midnight - z;
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
