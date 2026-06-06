/**
 * Persists the user's last 4 reaction emojis to localStorage.
 * Unique, ordered by most-recent use. Scoped to message reactions only.
 */

const STORAGE_KEY = 'blyve_reaction_recents';
const MAX_RECENTS = 4;

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

function saveRecents(emojis: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(emojis));
  } catch {
    // storage full or unavailable — silently ignore
  }
}

/** Return current recents without subscribing (used at render time). */
export function getRecentReactionEmojis(): string[] {
  return loadRecents();
}

/**
 * Prepend `emoji` to the recents list.
 * If already present, move it to front. Keeps at most MAX_RECENTS entries.
 */
export function recordRecentReactionEmoji(emoji: string): string[] {
  const prev = loadRecents();
  const filtered = prev.filter((e) => e !== emoji);
  const next = [emoji, ...filtered].slice(0, MAX_RECENTS);
  saveRecents(next);
  return next;
}
