import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import PublicPage from './PublicPage';
import { QUICK_LINKS } from './quickLinks';
import { THEMES, getStoredTheme, setStoredTheme, resolveTheme, applyTheme } from './theme';

// Loaded on demand so public visitors don't download the admin, auth and
// resource-manager code.
const AdminPage = lazy(() => import('./AdminPage'));

// Nav icons reuse the same Quick Links config as the public page's Quick
// Links section (see quickLinks.js) so the two never drift apart.
const GITHUB_LINK = QUICK_LINKS.find((l) => l.label === 'GitHub');
const LINKEDIN_LINK = QUICK_LINKS.find((l) => l.label === 'LinkedIn');

const THEME_LABELS = { system: 'System', light: 'Light', dark: 'Dark' };

function Icon({ className, children }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

// Admin is an icon rather than a labeled link so it doesn't invite clicks
// from visitors browsing the public page — the real gate is the Cognito
// login (with MFA) inside AdminPage itself, not this button being subtle.
function GearIcon() {
  return (
    <Icon className="quick-link-icon">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Icon>
  );
}

function ThemeIcon({ dark }) {
  return dark ? (
    <Icon className="theme-menu-icon">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </Icon>
  ) : (
    <Icon className="theme-menu-icon">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </Icon>
  );
}

// Hash routing instead of react-router: avoids needing an Amplify Hosting
// rewrite rule for client-side paths.
export default function App() {
  const [hash, setHash] = useState(window.location.hash);
  const [theme, setTheme] = useState(() => getStoredTheme());
  const themeMenuRef = useRef(null);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // ponytail: this applies after mount, so a stored choice that disagrees
  // with the OS can flash the wrong theme for one frame. A pre-hydration
  // inline script in index.html would close that gap; skipped as
  // unnecessary polish for a personal site — revisit if it's ever visibly
  // annoying.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const isAdmin = hash === '#admin';
  // Read once per render rather than tracked as live state — the page's
  // actual theme already updates via CSS alone regardless; this only feeds
  // the summary icon, and a stale glyph until the next render is fine.
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  function chooseTheme(next) {
    setTheme(next);
    setStoredTheme(next);
    themeMenuRef.current?.removeAttribute('open');
  }

  return (
    <div className="app">
      <nav>
        <a href="#">Home</a>
        <div className="nav-icons">
          <a
            className="nav-icon-link"
            href={GITHUB_LINK.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
          >
            <img className="quick-link-icon icon-light" src={GITHUB_LINK.iconLight} alt="" />
            <img className="quick-link-icon icon-dark" src={GITHUB_LINK.iconDark} alt="" />
          </a>
          <a
            className="nav-icon-link"
            href={LINKEDIN_LINK.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="LinkedIn"
          >
            <img className="quick-link-icon icon-light" src={LINKEDIN_LINK.iconLight} alt="" />
            <img className="quick-link-icon icon-dark" src={LINKEDIN_LINK.iconDark} alt="" />
          </a>
          <a className="nav-icon-link" href="#admin" aria-label="Admin">
            <GearIcon />
          </a>
          <details className="theme-menu" ref={themeMenuRef}>
            <summary aria-label={`Theme: ${THEME_LABELS[theme]}`}>
              <ThemeIcon dark={resolveTheme(theme, prefersDark) === 'dark'} />
            </summary>
            <div className="theme-menu-list">
              {THEMES.map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-current={theme === t ? 'true' : undefined}
                  onClick={() => chooseTheme(t)}
                >
                  {THEME_LABELS[t]}
                </button>
              ))}
            </div>
          </details>
        </div>
      </nav>
      <Suspense fallback={<p role="status">Loading...</p>}>
        {isAdmin ? <AdminPage /> : <PublicPage />}
      </Suspense>
    </div>
  );
}
