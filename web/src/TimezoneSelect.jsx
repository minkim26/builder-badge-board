import { TIMEZONE_OPTIONS } from './timezone';

// Admin-only: the timezone is a single site-wide setting (persisted via
// GET/PUT /settings), not a per-visitor preference, so the public page just
// displays it rather than offering this picker.
export default function TimezoneSelect({ value, onChange }) {
  return (
    <select className="timezone-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Timezone">
      {TIMEZONE_OPTIONS.map((tz) => (
        <option key={tz.value} value={tz.value}>{tz.label}</option>
      ))}
    </select>
  );
}
