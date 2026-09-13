import { TIMEZONE_OPTIONS } from './timezone';

// Shared by the public and admin pages so there's exactly one control for
// the one timezone preference that governs every timestamp on the page.
export default function TimezoneSelect({ value, onChange }) {
  return (
    <select className="timezone-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Timezone">
      {TIMEZONE_OPTIONS.map((tz) => (
        <option key={tz.value} value={tz.value}>{tz.label}</option>
      ))}
    </select>
  );
}
