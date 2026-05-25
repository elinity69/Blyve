const THEME_STORAGE_KEY = 'blyve_theme_v1';

export interface ThemeCache {
  userId: string;
  darkMode: boolean;
}

/** App defaults to dark mode; light mode is opt-in via settings (dark_mode = false). */
export function resolveDarkMode(preference: boolean | null | undefined): boolean {
  return preference !== false;
}

export function readThemeCache(): ThemeCache | null {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ThemeCache;
    if (typeof parsed.userId === 'string' && typeof parsed.darkMode === 'boolean') {
      return parsed;
    }
  } catch {
    // ignore corrupt cache
  }
  return null;
}

export function writeThemeCache(userId: string, darkMode: boolean): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ userId, darkMode }));
  } catch {
    // ignore quota errors
  }
}

export function clearThemeCache(): void {
  try {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function applyResolvedTheme(isDark: boolean): void {
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
}

export function applyThemePreference(preference: boolean | null | undefined): void {
  applyResolvedTheme(resolveDarkMode(preference));
}

/** Apply cached user theme synchronously before React mounts. */
export function applyBootTheme(): void {
  const cache = readThemeCache();
  if (cache) {
    applyResolvedTheme(cache.darkMode);
    return;
  }
  applyThemePreference(undefined);
}

export function syncThemeFromProfile(
  userId: string,
  darkMode: boolean | null | undefined
): void {
  const resolved = resolveDarkMode(darkMode);
  applyResolvedTheme(resolved);
  writeThemeCache(userId, resolved);
}
