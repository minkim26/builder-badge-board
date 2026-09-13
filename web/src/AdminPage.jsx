import { useState } from 'react';
import { login, getSession, logout } from './auth';
import ResourceManager from './ResourceManager';
import { BADGE_CATALOG } from './badgeCatalog';

const catalogEntry = (name) => BADGE_CATALOG.find((b) => b.name === name);

const BADGE_FIELDS = [
  {
    key: 'name',
    label: 'Badge',
    type: 'select',
    options: BADGE_CATALOG.map((b) => b.name),
    helpText: (v) => catalogEntry(v.name)?.criteria,
  },
  { key: 'status', label: 'Status', type: 'select', options: ['earned', 'in-progress'] },
  { key: 'dateEarned', label: 'Date Earned', type: 'date' },
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
  const [session, setSession] = useState(() => getSession());

  function handleAuthError() {
    logout();
    setSession(null);
  }

  if (!session) {
    return <LoginForm onLogin={setSession} />;
  }

  return (
    <div>
      <div className="admin-header">
        <h2>Admin</h2>
        <button type="button" onClick={handleAuthError}>Log out</button>
      </div>

      <section>
        <h3>Badges</h3>
        <ResourceManager
          resource="badges"
          idKey="badgeId"
          fields={BADGE_FIELDS}
          token={session.idToken}
          onAuthError={handleAuthError}
        />
      </section>

      <section>
        <h3>Articles</h3>
        <ResourceManager
          resource="articles"
          idKey="articleId"
          fields={ARTICLE_FIELDS}
          token={session.idToken}
          onAuthError={handleAuthError}
        />
      </section>
    </div>
  );
}
