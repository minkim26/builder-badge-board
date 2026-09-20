import { useEffect, useRef, useState } from 'react';
import { login, getSession, logout, respondToMfa, startTotpSetup, completeTotpSetup, totpUri } from './auth';
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
  DEFAULT_TIMEZONE,
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
  { key: 'description', label: 'Description', type: 'text' },
  { key: 'tags', label: 'Tags (comma-separated)', type: 'text' },
  { key: 'thumbnailUrl', label: 'Thumbnail URL', type: 'url' },
];

// Badges and articles both hit POST /{resource}/sync and need the same
// syncing/status/remount-key dance around it — shared here instead of
// duplicated per resource.
function useResourceSync(resource, noun, currentToken, onAuthError) {
  const [syncing, setSyncing] = useState(false);
  const [status, setStatus] = useState(null);
  const [key, setKey] = useState(0);

  async function handleSync() {
    setSyncing(true);
    setStatus(null);
    try {
      const result = await api.sync(resource, await currentToken());
      setStatus(`Synced ${result.synced} ${noun}${result.synced === 1 ? '' : 's'} from Builder Center.`);
      setKey((k) => k + 1); // remounts ResourceManager so it refetches
    } catch (err) {
      if (err.message.startsWith('401')) return onAuthError();
      setStatus(`Sync failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  }

  return { syncing, status, key, handleSync };
}

// Sign-in is up to two steps: email + password, then — the user pool requires
// TOTP MFA — a 6-digit code. On the very first sign-in no authenticator is
// enrolled yet, so the second step also shows the secret to add to one.
function LoginForm({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState(null); // set once the password is accepted and Cognito wants a code
  const [secret, setSecret] = useState(null); // TOTP secret, only during first-time enrollment
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  function startOver(message) {
    setChallenge(null);
    setSecret(null);
    setCode('');
    setPassword('');
    setError(message);
  }

  async function run(step) {
    setError(null);
    setPending(true);
    try {
      await step();
    } catch (err) {
      // A challenge session expires (see AuthSessionValidity in
      // template.yaml) and can't be reused — only a fresh sign-in gets a new
      // one. A wrong code is a different error type and stays on this step
      // for another try. Before a challenge exists, NotAuthorizedException is
      // just a wrong password and is shown as-is.
      if (challenge && err.cognitoType === 'NotAuthorizedException') {
        startOver('That sign-in expired. Enter your password again.');
      } else {
        setError(err.message);
      }
    } finally {
      setPending(false);
    }
  }

  function handlePassword(e) {
    e.preventDefault();
    run(async () => {
      const result = await login(username, password);
      if (result.session) return onLogin(result.session);
      let next = result.challenge;
      if (next.name === 'MFA_SETUP') {
        const setup = await startTotpSetup(next);
        setSecret(setup.secret);
        next = { ...next, session: setup.session };
      }
      setChallenge(next);
    });
  }

  function handleCode(e) {
    e.preventDefault();
    run(async () => {
      const finish = challenge.name === 'MFA_SETUP' ? completeTotpSetup : respondToMfa;
      onLogin(await finish(challenge, code));
    });
  }

  if (challenge) {
    const enrolling = challenge.name === 'MFA_SETUP';
    let submitLabel = enrolling ? 'Finish setup' : 'Verify';
    if (pending) submitLabel = 'Checking...';
    return (
      <form onSubmit={handleCode} className="login-form">
        <h2>{enrolling ? 'Set up two-factor sign-in' : 'Two-factor code'}</h2>
        {error && <p className="error">{error}</p>}
        {enrolling && (
          <>
            <p>
              Add this key to an authenticator app (1Password, Google Authenticator, Authy) as a
              time-based code, then enter the 6-digit code it shows.
            </p>
            <code className="totp-secret">{secret}</code>
            <a href={totpUri(challenge.label, secret)}>Open in authenticator app</a>
          </>
        )}
        <label>
          {enrolling ? 'Code from your app' : 'Authentication code'}
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.trim())}
            required
          />
        </label>
        <button type="submit" disabled={pending}>{submitLabel}</button>
        <button type="button" onClick={() => startOver(null)} disabled={pending}>Cancel</button>
      </form>
    );
  }

  return (
    <form onSubmit={handlePassword} className="login-form">
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
  const [sessionCheckFailed, setSessionCheckFailed] = useState(false);
  const [badges, setBadges] = useState([]);
  const [articles, setArticles] = useState([]);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [timezoneError, setTimezoneError] = useState(null);
  const [timezoneSaving, setTimezoneSaving] = useState(false);
  const timezoneEditedRef = useRef(false);
  const synced = latestSync(badges);
  const articleSynced = latestSync(articles);

  // A transient failure throws instead of resolving — surface it as a retry
  // state rather than mistake it for "not signed in".
  function checkSession() {
    getSession()
      .then((s) => {
        setSessionCheckFailed(false);
        setSession(s);
      })
      .catch(() => setSessionCheckFailed(true));
  }

  useEffect(checkSession, []);

  // Public read, independent of login — the public page reads this same
  // setting, so it's the site-wide source of truth, not a per-browser one.
  // Guarded by timezoneEditedRef: if the admin changes the timezone before
  // this resolves, applying it would overwrite that edit with the stale
  // value this request started with.
  useEffect(() => {
    api.getSettings().then((s) => {
      if (!timezoneEditedRef.current) setTimezone(s.timezone);
    }).catch(() => {});
  }, []);

  function handleAuthError() {
    logout();
    setSession(null);
  }

  // Disabled on the select while this runs (see render below) so a second
  // change can't fire before the first PUT resolves — otherwise an
  // out-of-order response could leave the saved value behind what's shown.
  async function handleTimezoneChange(tz) {
    const previous = timezone;
    timezoneEditedRef.current = true;
    setTimezone(tz);
    setTimezoneError(null);
    setTimezoneSaving(true);
    try {
      await api.updateSettings({ timezone: tz }, await currentToken());
    } catch (err) {
      if (err.message.startsWith('401')) return handleAuthError();
      setTimezone(previous);
      setTimezoneError('Failed to save — try again.');
    } finally {
      setTimezoneSaving(false);
    }
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

  const badgeSync = useResourceSync('badges', 'earned badge', currentToken, handleAuthError);
  const articleSync = useResourceSync('articles', 'article', currentToken, handleAuthError);

  if (sessionCheckFailed) {
    return (
      <div className="admin-header">
        <p className="error">Couldn't check your session.</p>
        <button type="button" onClick={checkSession}>Retry</button>
      </div>
    );
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
          Timezone <TimezoneSelect value={timezone} onChange={handleTimezoneChange} disabled={timezoneSaving} />
        </label>
        {timezoneError && <span className="error">{timezoneError}</span>}
        <button type="button" onClick={handleAuthError}>Log out</button>
      </div>

      <section>
        <h3>Today's Checklist</h3>
        <DailyChecklist timezone={timezone} />
      </section>

      <section>
        <h3>Badges</h3>
        <p className="sync-row">
          <button type="button" onClick={badgeSync.handleSync} disabled={badgeSync.syncing}>
            {badgeSync.syncing ? 'Syncing...' : 'Sync from Builder Center'}
          </button>
          <small className="field-hint"> Earned badges only — in-progress badges sync via the Tampermonkey script below.</small>
        </p>
        {badgeSync.status && <p className="sync-status">{badgeSync.status}</p>}
        {synced && <p className="sync-meta">Last synced {formatTimestamp(synced, timezone)}</p>}
        <ProgressSyncSetup />
        <ResourceManager
          key={badgeSync.key}
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
        <p className="sync-row">
          <button type="button" onClick={articleSync.handleSync} disabled={articleSync.syncing}>
            {articleSync.syncing ? 'Syncing...' : 'Sync from Builder Center'}
          </button>
        </p>
        {articleSync.status && <p className="sync-status">{articleSync.status}</p>}
        {articleSynced && <p className="sync-meta">Last synced {formatTimestamp(articleSynced, timezone)}</p>}
        <ResourceManager
          key={articleSync.key}
          resource="articles"
          idKey="articleId"
          fields={ARTICLE_FIELDS}
          getToken={currentToken}
          onAuthError={handleAuthError}
          onData={setArticles}
        />
      </section>
    </div>
  );
}
