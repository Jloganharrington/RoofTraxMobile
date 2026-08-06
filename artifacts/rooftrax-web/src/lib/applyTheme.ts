/**
 * applyTheme — single source of truth for toggling the .dark class.
 *
 * Call it:
 *  (a) when the user picks a new theme in the Appearance tab,
 *  (b) after a successful profile load (server preference wins, re-syncs
 *      localStorage), and
 *  (c) from a matchMedia change listener while the current preference is
 *      'system'.
 *
 * The unauthenticated marketing page uses localStorage/system only; it never
 * calls this with a profile value.
 */

export type ThemeValue = 'light' | 'dark' | 'system';

/** A media-query listener we can remove when the theme changes away from system. */
let _systemListener: ((e: MediaQueryListEvent) => void) | null = null;
let _mql: MediaQueryList | null = null;

function _clearSystemListener() {
  if (_mql && _systemListener) {
    _mql.removeEventListener('change', _systemListener);
    _systemListener = null;
    _mql = null;
  }
}

function _applyResolved(resolved: 'light' | 'dark') {
  if (resolved === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

/**
 * Apply a theme preference.
 * Persists to localStorage so the pre-paint bootstrap reads it on next load.
 */
export function applyTheme(theme: ThemeValue) {
  _clearSystemListener();

  localStorage.setItem('rt_theme', theme);

  if (theme === 'system') {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    _applyResolved(mql.matches ? 'dark' : 'light');

    const listener = (e: MediaQueryListEvent) => {
      _applyResolved(e.matches ? 'dark' : 'light');
    };
    mql.addEventListener('change', listener);
    _mql = mql;
    _systemListener = listener;
  } else {
    _applyResolved(theme);
  }
}
