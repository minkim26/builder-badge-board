import { useEffect, useRef, useState } from 'react';
import * as api from './api';
import { BADGE_CATALOG, catalogEntry, latestSync } from './badgeCatalog';
import { QUICK_LINKS } from './quickLinks';
import { DEFAULT_TIMEZONE, formatTimestamp } from './timezone';

// Only render as a link if it's actually http(s) — a stored `javascript:` or
// other scheme in a URL field would otherwise be a live XSS on this page.
const isSafeUrl = (url) => /^https?:\/\//i.test(url);

function badgePercent(b) {
  const catalog = catalogEntry(b.name);
  if (!catalog?.target || !b.progress) return null;
  return Math.min(100, (Number(b.progress) / catalog.target) * 100);
}

// Hand-picked, not derived from target/unit: a plain "sort by streak length"
// would rank every 30-day streak above both 4-week ones (28 days < 30), which
// doesn't match what actually reads as impressive. This is the initial-load
// order for the whole grid, earned or not — "Load more" just extends it.
const IMPORTANT_BADGES = [
  '90-Day Comment Streak',
  '90-Day Like Streak',
  '90-Day Visit Streak',
  '4-Week Article Publishing Streak',
  '4-Week Wish Vote Streak',
  '30-Day Comment Streak',
  '30-Day Visit Streak',
];

function sortBadges(badges) {
  return [...badges].sort((a, b) => {
    const ai = IMPORTANT_BADGES.indexOf(a.name);
    const bi = IMPORTANT_BADGES.indexOf(b.name);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return BADGE_CATALOG.findIndex((c) => c.name === a.name) - BADGE_CATALOG.findIndex((c) => c.name === b.name);
  });
}

const INITIAL_BADGE_COUNT = 7;

// AWS's own badge icon filenames already encode the real grouping
// (ABC_DigitalBadge_<Category>_...), so category comes from that instead of
// a second hand-maintained list that could drift from BADGE_CATALOG.
// "Getting Started" one-time badges are folded into "community" — there's no
// dedicated pill for them.
function badgeCategory(catalog) {
  return catalog?.icon?.includes('_HotStreaks_') ? 'streaks' : 'community';
}

// Finer-grained than badgeCategory() above (which folds GettingStarted and
// EnsuringQualityContent into one "community" filter pill) — this drives the
// small color accent on earned cards (see index.css's --cat-* variables),
// where the three groups' real badge artwork genuinely looks different.
function badgeAccentCategory(catalog) {
  if (catalog?.icon?.includes('_HotStreaks_')) return 'streaks';
  if (catalog?.icon?.includes('_EnsuringQualityContent_')) return 'quality';
  if (catalog?.icon?.includes('_GettingStarted_')) return 'start';
  // Sync accepts AWS display names without catalog validation (handler.js),
  // so a badge not yet in BADGE_CATALOG lands here — no .cat-unknown rule
  // exists, so it falls back to the pre-redesign single-accent look instead
  // of being mislabeled into a real category.
  return 'unknown';
}

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'earned', label: 'Earned' },
  { key: 'in-progress', label: 'In Progress' },
];

const CATEGORY_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'community', label: 'Community' },
  { key: 'streaks', label: 'Streaks' },
];

export default function PublicPage() {
  const [badges, setBadges] = useState([]);
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timezone, setTimezone] = useState(DEFAULT_TIMEZONE);
  const [selectedBadge, setSelectedBadge] = useState(null);
  const [showAllBadges, setShowAllBadges] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const dialogRef = useRef(null);
  const synced = latestSync(badges);
  const selectedCatalog = selectedBadge ? catalogEntry(selectedBadge.name) : null;
  const selectedPct = selectedBadge ? badgePercent(selectedBadge) : null;

  const filtersActive = statusFilter !== 'all' || categoryFilter !== 'all';
  const filteredBadges = sortBadges(badges).filter((b) => {
    if (statusFilter !== 'all' && b.status !== statusFilter) return false;
    if (categoryFilter !== 'all' && badgeCategory(catalogEntry(b.name)) !== categoryFilter) return false;
    return true;
  });
  const visibleBadges = filtersActive || showAllBadges ? filteredBadges : filteredBadges.slice(0, INITIAL_BADGE_COUNT);

  useEffect(() => {
    Promise.all([api.list('badges'), api.list('articles')])
      .then(([b, a]) => {
        setBadges(b);
        setArticles(a);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Fetched independently, with its own silent fallback to DEFAULT_TIMEZONE —
  // a hiccup on this one setting shouldn't blank out badges/articles too.
  useEffect(() => {
    api.getSettings().then((s) => setTimezone(s.timezone)).catch(() => {});
  }, []);

  // <dialog> is the source of truth for open/closed (it also closes itself on
  // Escape), so this just keeps it in sync with selectedBadge rather than the
  // other way around.
  useEffect(() => {
    if (selectedBadge) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [selectedBadge]);

  return (
    <div>
      <header className="hero">
        <p className="hero-label">Builder Badge Board</p>
        <h1>Minsu Kim</h1>
        <p className="hero-tagline">AWS builder. Here's what I've shipped and written.</p>
      </header>

      {error && <p className="error">{error}</p>}

      <section>
        <h2>Quick Links</h2>
        <ul className="quick-links">
          {QUICK_LINKS.map((l) => (
            <li key={l.href}>
              <a href={l.href} target="_blank" rel="noopener noreferrer">
                {l.icon && <img className="quick-link-icon" src={l.icon} alt="" />}
                {l.iconLight && <img className="quick-link-icon icon-light" src={l.iconLight} alt="" />}
                {l.iconDark && <img className="quick-link-icon icon-dark" src={l.iconDark} alt="" />}
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Badges</h2>
        {loading ? (
          <ul className="badge-grid">
            {Array.from({ length: 7 }, (_, i) => <li key={i} className="badge-card skeleton-card" />)}
          </ul>
        ) : (
          <>
            <div className="badge-header-row">
              <p className="badge-progress">
                {badges.filter((b) => b.status === 'earned').length} / {BADGE_CATALOG.length} earned
                {synced && ` · Last synced ${formatTimestamp(synced, timezone)}`}
              </p>
              <div className="badge-filters">
                <label className="badge-filter-group">
                  Status:
                  <select className="timezone-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    {STATUS_FILTERS.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                </label>
                <label className="badge-filter-group">
                  Category:
                  <select className="timezone-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                    {CATEGORY_FILTERS.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            {filteredBadges.length === 0 && !error && (
              <p>{badges.length === 0 ? 'No badges yet.' : 'No badges match this filter.'}</p>
            )}
            <ul className="badge-grid">
              {visibleBadges.map((b) => {
                const catalog = catalogEntry(b.name);
                const pct = badgePercent(b);
                const accentClass = b.status === 'earned' ? ` cat-${badgeAccentCategory(catalog)}` : '';
                return (
                  <li key={b.badgeId} className={`badge-card badge-${b.status}${accentClass}`}>
                    <button type="button" className="badge-card-trigger" onClick={() => setSelectedBadge(b)}>
                      {catalog?.icon && <img className="badge-icon" src={`/badges/${catalog.icon}`} alt="" width="64" height="64" />}
                      <strong className="badge-name">{b.name}</strong>
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
                    </button>
                  </li>
                );
              })}
            </ul>
            {!filtersActive && filteredBadges.length > INITIAL_BADGE_COUNT && (
              <button type="button" className="load-more" onClick={() => setShowAllBadges((v) => !v)}>
                {showAllBadges ? 'Show less' : `Load more (${filteredBadges.length - INITIAL_BADGE_COUNT} more)`}
              </button>
            )}
          </>
        )}
      </section>

      <section>
        <h2>Articles</h2>
        {loading ? (
          <ul className="article-grid">
            {Array.from({ length: 4 }, (_, i) => <li key={i} className="article-card skeleton-card" />)}
          </ul>
        ) : (
          <>
            {articles.length === 0 && !error && <p>No articles yet.</p>}
            <ul className="article-grid">
              {articles.map((a) => {
                const linkable = isSafeUrl(a.url);
                const CardLink = linkable ? 'a' : 'div';
                const linkProps = linkable ? { href: a.url, target: '_blank', rel: 'noopener noreferrer' } : {};
                return (
                  <li key={a.articleId} className="article-card">
                    <CardLink className="article-card-link" {...linkProps}>
                      {a.thumbnailUrl && isSafeUrl(a.thumbnailUrl) && (
                        <img className="article-thumb" src={a.thumbnailUrl} alt="" />
                      )}
                      <span className="article-title">{a.title}</span>
                      {a.publishDate && <span className="article-date">{a.publishDate}</span>}
                      {a.description && <span className="article-description">{a.description}</span>}
                    </CardLink>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <dialog
        ref={dialogRef}
        className={`badge-dialog${selectedBadge?.status === 'earned' ? ` cat-${badgeAccentCategory(selectedCatalog)}` : ''}`}
        aria-labelledby="badge-dialog-title"
        onClose={() => setSelectedBadge(null)}
        onClick={(e) => {
          // e.target === the dialog on any click outside its rendered box
          // (the ::backdrop) — but also on a click inside the dialog's own
          // padding/flex-gap, which has nothing more specific to hit. Compare
          // coordinates against the actual box instead of relying on target.
          const rect = e.currentTarget.getBoundingClientRect();
          const clickedOutside =
            e.clientX < rect.left || e.clientX > rect.right ||
            e.clientY < rect.top || e.clientY > rect.bottom;
          if (clickedOutside) setSelectedBadge(null);
        }}
      >
        {selectedBadge && (
          <>
            <button type="button" className="dialog-close" onClick={() => setSelectedBadge(null)} aria-label="Close">
              ×
            </button>
            {selectedCatalog?.icon && (
              <img className="badge-icon badge-icon-lg" src={`/badges/${selectedCatalog.icon}`} alt="" width="96" height="96" />
            )}
            <h3 id="badge-dialog-title" className="badge-name">{selectedBadge.name}</h3>
            <span className="badge-status">{selectedBadge.status}</span>
            {selectedBadge.dateEarned && <p className="badge-date">{selectedBadge.dateEarned}</p>}
            {selectedPct !== null && (
              <>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${selectedPct}%` }} />
                </div>
                <p className="badge-date">{selectedBadge.progress} / {selectedCatalog.target} {selectedCatalog.unit}</p>
              </>
            )}
            {selectedCatalog?.criteria && <p className="badge-dialog-criteria">{selectedCatalog.criteria}</p>}
          </>
        )}
      </dialog>
    </div>
  );
}
