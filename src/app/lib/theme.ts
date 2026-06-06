const THEME_STORAGE_KEY = 'blyve_theme_v2';
const LEGACY_THEME_STORAGE_KEY = 'blyve_theme_v1';

export type ThemeMode = 'light' | 'dark' | 'oled';

export interface ThemeCache {
  userId: string;
  themeMode: ThemeMode;
}

export interface ProfileThemeInput {
  theme_mode?: string | null;
  dark_mode?: boolean | null;
}

const THEME_MODES: ThemeMode[] = ['light', 'dark', 'oled'];

export function isThemeMode(value: string | null | undefined): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'oled';
}

/** App defaults to dark mode; light mode is opt-in. */
export function resolveDarkMode(preference: boolean | null | undefined): boolean {
  return preference !== false;
}

export function resolveThemeMode(profile?: ProfileThemeInput | null): ThemeMode {
  if (isThemeMode(profile?.theme_mode ?? null)) {
    return profile!.theme_mode as ThemeMode;
  }
  return resolveDarkMode(profile?.dark_mode) ? 'oled' : 'light';
}

export function readThemeCache(): ThemeCache | null {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ThemeCache;
      if (typeof parsed.userId === 'string' && isThemeMode(parsed.themeMode)) {
        return parsed;
      }
    }

    const legacyRaw = localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw) as { userId?: string; darkMode?: boolean };
      if (typeof legacy.userId === 'string' && typeof legacy.darkMode === 'boolean') {
        return {
          userId: legacy.userId,
          themeMode: legacy.darkMode ? 'oled' : 'light',
        };
      }
    }
  } catch {
    // ignore corrupt cache
  }
  return null;
}

export function writeThemeCache(userId: string, themeMode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ userId, themeMode }));
  } catch {
    // ignore quota errors
  }
}

export function clearThemeCache(): void {
  try {
    localStorage.removeItem(THEME_STORAGE_KEY);
    localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement;
  root.classList.toggle('dark', mode !== 'light');
  root.classList.toggle('oled', mode === 'oled');
  root.style.colorScheme = mode === 'light' ? 'light' : 'dark';
  root.dataset.themeMode = mode;
}

/** @deprecated Use applyThemeMode */
export function applyResolvedTheme(isDark: boolean): void {
  applyThemeMode(isDark ? 'dark' : 'light');
}

export function applyThemePreference(preference: boolean | null | undefined): void {
  applyThemeMode(resolveDarkMode(preference) ? 'dark' : 'light');
}

export function applyBootTheme(): void {
  const cache = readThemeCache();
  if (cache) {
    applyThemeMode(cache.themeMode);
    return;
  }
  applyThemeMode('oled');
}

export function syncThemeFromProfile(
  userId: string,
  profile?: ProfileThemeInput | null
): void {
  const themeMode = resolveThemeMode(profile);
  applyThemeMode(themeMode);
  writeThemeCache(userId, themeMode);
}

export function profileUpdateForThemeMode(themeMode: ThemeMode): {
  theme_mode: ThemeMode;
  dark_mode: boolean;
} {
  return {
    theme_mode: themeMode,
    dark_mode: themeMode !== 'light',
  };
}

export const THEME_MODE_OPTIONS = THEME_MODES;
