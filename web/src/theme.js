// Site-wide light/dark/system theme choice, persisted per-browser (unlike
// the timezone setting in timezone.js, this genuinely is a per-visitor
// preference, not a site-owner setting). `storage`/`root` are parameters
// with real-world defaults so these are directly testable without a DOM,
// same pattern as timezone.js's `now` parameter on msUntilMidnight.
export const THEMES = ['system', 'light', 'dark'];
const STORAGE_KEY = 'theme';

function safeLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

// Falls back to 'system' for anything unset or invalid — a stale value from
// a future/older version of this script, or storage blocked in private
// browsing.
export function getStoredTheme(storage = safeLocalStorage()) {
  try {
    const value = storage?.getItem(STORAGE_KEY);
    return THEMES.includes(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export function setStoredTheme(theme, storage = safeLocalStorage()) {
  try {
    storage?.setItem(STORAGE_KEY, theme);
  } catch {
    // Private browsing or storage disabled — the choice just won't persist
    // across reloads, which is a reasonable degrade, not a crash.
  }
}

// The theme to actually render: 'system' resolves to whatever the OS
// currently prefers.
export function resolveTheme(theme, prefersDark) {
  return theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
}

// Applies `theme` to the document: an explicit choice sets data-theme so
// index.css's [data-theme] rules override prefers-color-scheme; 'system'
// clears it so the CSS media query decides.
export function applyTheme(theme, root = document.documentElement) {
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}
