import { useEffect, useState } from 'react';
import * as api from './api';
import { BADGE_CATALOG, catalogEntry, latestSync } from './badgeCatalog';
import { QUICK_LINKS } from './quickLinks';
import TimezoneSelect from './TimezoneSelect';
import { getStoredTimezone, setStoredTimezone, formatTimestamp } from './timezone';

// Only render as a link if it's actually http(s) — a stored `javascript:` or
// other scheme in a URL field would otherwise be a live XSS on this page.
const isSafeUrl = (url) => /^https?:\/\//i.test(url);

export default function PublicPage() {
  const [badges, setBadges] = useState([]);
  const [articles, setArticles] = useState([]);
  const [error, setError] = useState(null);
  const [timezone, setTimezone] = useState(getStoredTimezone);
  const synced = latestSync(badges);

  function handleTimezoneChange(tz) {
    setTimezone(tz);
    setStoredTimezone(tz);
  }

  useEffect(() => {
    Promise.all([api.list('badges'), api.list('articles')])
      .then(([b, a]) => {
        setBadges(b);
        setArticles(a);
      })
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div>
      <h1>Builder Badge Board</h1>
      {error && <p className="error">{error}</p>}

      <section>
        <h2>Badges</h2>
        <p className="badge-progress">
          {badges.filter((b) => b.status === 'earned').length} / {BADGE_CATALOG.length} earned
          {synced && (
            <>
              {' · Last synced '}{formatTimestamp(synced, timezone)}{' '}
              <TimezoneSelect value={timezone} onChange={handleTimezoneChange} />
            </>
          )}
        </p>
        {badges.length === 0 && !error && <p>No badges yet.</p>}
        <ul className="badge-grid">
          {badges.map((b) => {
            const catalog = catalogEntry(b.name);
            const pct = catalog?.target && b.progress ? Math.min(100, (Number(b.progress) / catalog.target) * 100) : null;
            return (
              <li key={b.badgeId} className={`badge-card badge-${b.status}`}>
                {catalog?.icon && <img className="badge-icon" src={`/badges/${catalog.icon}`} alt="" width="64" height="64" />}
                <strong>{b.name}</strong>
                {catalog?.criteria && <span className="badge-criteria">{catalog.criteria}</span>}
                <span className="badge-status">{b.status}</span>
                {b.dateEarned && <span className="badge-date">{b.dateEarned}</span>}
                {pct !== null && (
                  <>
                    <div className="progress-bar">
                      <div className="progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="badge-date">{b.progress} / {catalog.target} {catalog.unit}</span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2>Articles</h2>
        {articles.length === 0 && !error && <p>No articles yet.</p>}
        <ul className="article-grid">
          {articles.map((a) => (
            <li key={a.articleId} className="article-card">
              {a.thumbnailUrl && <img className="article-thumb" src={a.thumbnailUrl} alt="" />}
              {isSafeUrl(a.url) ? (
                <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a>
              ) : (
                <span>{a.title}</span>
              )}
              {a.publishDate && <span className="article-date">{a.publishDate}</span>}
              {a.description && <span className="article-description">{a.description}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Quick Links</h2>
        <ul className="quick-links">
          {QUICK_LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
