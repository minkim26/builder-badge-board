import { useEffect, useState } from 'react';
import { login, getSession, logout } from './auth';
import ResourceManager from './ResourceManager';
import { BADGE_CATALOG, catalogEntry, latestSync } from './badgeCatalog';
import { TAMPERMONKEY_SCRIPT } from './tampermonkeyScript';
import { QUICK_LINKS } from './quickLinks';
import TimezoneSelect from './TimezoneSelect';
import {
  dateKeyFor,
  msUntilMidnight,
  formatCountdown,
  formatDateLabel,
  timezoneAbbrev,
  formatTimestamp,
  getStoredTimezone,
  setStoredTimezone,
} from './timezone';
import * as api from './api';

const CHECKLIST_ITEMS = ['Visited Builder Center', 'Liked a post', 'Left a comment'];

// localStorage-backed and keyed by date on purpose: this is a personal daily
// nudge, not real data — losing it costs nothing, and keying by date means
// it naturally resets every day with no cleanup logic needed. `timezone`
// comes from the parent so it's the same one control governing every
// timestamp on the page, not a checklist-only setting.
function DailyChecklist({ timezone }) {
  const [dateKey, setDateKey] = useState(() => dateKeyFor(timezone));
  const [msLeft, setMsLeft] = useState(() => msUntilMidnight(timezone));
  const [checked, setChecked] = useState({});

  // Ticks every second so the countdown is live and so a real midnight
  // rollover (not just a timezone switch) is caught without a page reload.
  useEffect(() => {
    const tick = () => {
      setDateKey(dateKeyFor(timezone));
      setMsLeft(msUntilMidnight(timezone));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timezone]);

  // Reloads the checklist whenever the effective date changes, whether from
  // an actual midnight rollover or the user switching timezones.
  useEffect(() => {
    try {
      setChecked(JSON.parse(localStorage.getItem(`badge-board-checklist-${dateKey}`)) || {});
    } catch {
      setChecked({});
    }
  }, [dateKey]);

  function toggle(item) {
    const next = { ...checked, [item]: !checked[item] };
    setChecked(next);
    try {
      localStorage.setItem(`badge-board-checklist-${dateKey}`, JSON.stringify(next));
    } catch {
      // private browsing / storage disabled — checklist just won't persist
    }
  }

  return (
    <div>
      <p className="checklist-meta">
        {formatDateLabel(timezone)} · resets in {formatCountdown(msLeft)} ({timezoneAbbrev(timezone)})
      </p>
      <ul className="checklist">
        {CHECKLIST_ITEMS.map((item) => (
          <li key={item}>
            <label>
              <input type="checkbox" checked={Boolean(checked[item])} onChange={() => toggle(item)} />
              {item}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CopyScriptButton() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(TAMPERMONKEY_SCRIPT);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return <button type="button" onClick={handleCopy}>{copied ? 'Copied!' : 'Copy script'}</button>;
}

function ProgressSyncSetup() {
  const profileLink = QUICK_LINKS[0]?.href;
  return (
    <details className="setup-panel">
      <summary>Enable in-progress badge sync (one-time setup)</summary>
      <ol>
        <li>
          Install the <a href="https://www.tampermonkey.net/" target="_blank" rel="noopener noreferrer">Tampermonkey</a> browser extension.
        </li>
        <li>
          Click "Copy script" below, then in Tampermonkey: Dashboard → "+" → paste over the
          template → replace <code>REPLACE_WITH_YOUR_SYNC_KEY</code> with your real sync key → save.
        </li>
        <li>
          In <code>chrome://extensions</code>, turn on Developer mode, then enable "Allow User
          Scripts" for Tampermonkey — without it, Chrome silently blocks the script.
        </li>
        <li>
          Visit your{' '}
          {profileLink ? (
            <a href={profileLink} target="_blank" rel="noopener noreferrer">Builder Center badges tab</a>
          ) : (
            'Builder Center badges tab'
          )}{' '}
          and open the console (F12) — look for <code>[badge-board] synced N in-progress badges</code>.
        </li>
      </ol>
      <CopyScriptButton />
    </details>
  );
}

const BADGE_FIELDS = [
  {
    key: 'name',
    label: 'Badge',
    type: 'select',
    options: BADGE_CATALOG.map((b) => b.name),
    helpText: (v) => catalogEntry(v.name)?.criteria,
  },
  { key: 'status', label: 'Status', type: 'select', options: ['earned', 'in-progress'] },
  { key: 'dateEarned', label: 'Date Earned', type: 'date', showIf: (v) => v.status === 'earned' },
  {
    key: 'progress',
    label: 'Progress',
    type: 'number',
    min: 0,
    max: (v) => catalogEntry(v.name)?.target,
    showIf: (v) => Boolean(catalogEntry(v.name)?.target),
    helpText: (v) => {
      const b = catalogEntry(v.name);
      return b?.target ? `Out of ${b.target} ${b.unit}` : null;
    },
  },
];

const ARTICLE_FIELDS = [
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'url', label: 'URL', type: 'url' },
  { key: 'publishDate', label: 'Publish Date', type: 'date' },
  { key: 'tags', label: 'Tags (comma-separated)', type: 'text' },
];

function LoginForm({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const session = await login(username, password);
      onLogin(session);
    } catch (err) {
      setError(err.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="login-form">
      <h2>Admin Login</h2>
      {error && <p className="error">{error}</p>}
      <label>
        Email
        <input type="email" value={username} onChange={(e) => setUsername(e.target.value)} required />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <button type="submit" disabled={pending}>{pending ? 'Signing in...' : 'Sign in'}</button>
    </form>
  );
}

export default function AdminPage() {
  const [session, setSession] = useState(undefined); // undefined: not checked yet, null: checked, none found
  const [badgesKey, setBadgesKey] = useState(0);
  const [syncStatus, setSyncStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [badges, setBadges] = useState([]);
  const [timezone, setTimezone] = useState(getStoredTimezone);
  const synced = latestSync(badges);

  useEffect(() => {
    getSession().then(setSession);
  }, []);

  function handleAuthError() {
    logout();
    setSession(null);
  }

  function handleTimezoneChange(tz) {
    setTimezone(tz);
    setStoredTimezone(tz);
  }

  // Re-checked (and silently refreshed if expired) right before each
  // authenticated call, instead of trusting the idToken from state — a tab
  // left open past the ~1hr ID token lifetime would otherwise keep sending a
  // stale one and get logged out instead of transparently refreshed.
  async function currentToken() {
    const s = await getSession();
    setSession(s);
    return s?.idToken;
  }

  async function handleSync() {
    setSyncing(true);
    setSyncStatus(null);
    try {
      const result = await api.sync('badges', await currentToken());
      setSyncStatus(`Synced ${result.synced} earned badge${result.synced === 1 ? '' : 's'} from Builder Center.`);
      setBadgesKey((k) => k + 1); // remounts ResourceManager so it refetches
    } catch (err) {
      if (err.message.startsWith('401')) return handleAuthError();
      setSyncStatus(`Sync failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  }

  if (session === undefined) {
    return null;
  }

  if (!session) {
    return <LoginForm onLogin={setSession} />;
  }

  return (
    <div>
      <div className="admin-header">
        <h2>Admin</h2>
        <label className="timezone-picker">
          Timezone <TimezoneSelect value={timezone} onChange={handleTimezoneChange} />
        </label>
        <button type="button" onClick={handleAuthError}>Log out</button>
      </div>

      <section>
        <h3>Today's Checklist</h3>
        <DailyChecklist timezone={timezone} />
      </section>

      <section>
        <h3>Badges</h3>
        <p className="sync-row">
          <button type="button" onClick={handleSync} disabled={syncing}>
            {syncing ? 'Syncing...' : 'Sync from Builder Center'}
          </button>
          <small className="field-hint"> Earned badges only — in-progress badges sync via the Tampermonkey script below.</small>
        </p>
        {syncStatus && <p className="sync-status">{syncStatus}</p>}
        {synced && <p className="sync-meta">Last synced {formatTimestamp(synced, timezone)}</p>}
        <ProgressSyncSetup />
        <ResourceManager
          key={badgesKey}
          resource="badges"
          idKey="badgeId"
          fields={BADGE_FIELDS}
          getToken={currentToken}
          onAuthError={handleAuthError}
          onData={setBadges}
        />
      </section>

      <section>
        <h3>Articles</h3>
        <ResourceManager
          resource="articles"
          idKey="articleId"
          fields={ARTICLE_FIELDS}
          getToken={currentToken}
          onAuthError={handleAuthError}
        />
      </section>
    </div>
  );
}
