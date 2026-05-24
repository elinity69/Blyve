import type { SupabaseClient } from '@supabase/supabase-js';

/** Allowed: lowercase letters, digits, underscore; length 3–30 */
export const USERNAME_REGEX = /^[a-z][a-z0-9_]{2,29}$/;

export type UsernameFormatError = 'SHORT' | 'INVALID';

export function normalizeUsernameInput(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 30);
}

export function validateUsernameFormat(username: string): UsernameFormatError | null {
  if (username.length < 3) return 'SHORT';
  if (!USERNAME_REGEX.test(username)) return 'INVALID';
  return null;
}

/** Returns true if username is free (no row or only current user). */
export async function isUsernameAvailable(
  supabase: SupabaseClient,
  username: string,
  excludeUserId?: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error('isUsernameAvailable:', error);
    return false;
  }
  if (!data) return true;
  if (excludeUserId && data.id === excludeUserId) return true;
  return false;
}

/** Suggest username, username1, username2, … until one is free */
export async function suggestAvailableUsername(
  supabase: SupabaseClient,
  base: string,
  excludeUserId?: string,
): Promise<string> {
  const clean = normalizeUsernameInput(base);
  if (clean.length < 3) {
    const padded = `${clean}user`.slice(0, 30).replace(/[^a-z0-9_]/g, '');
    const candidate = padded.length >= 3 ? padded : 'user123';
    return pickAvailable(supabase, candidate, excludeUserId);
  }
  return pickAvailable(supabase, clean, excludeUserId);
}

async function pickAvailable(
  supabase: SupabaseClient,
  base: string,
  excludeUserId?: string,
): Promise<string> {
  for (let i = 0; i < 50; i += 1) {
    const candidate = i === 0 ? base : `${base}${i}`.slice(0, 30);
    if (candidate.length < 3) continue;
    if (validateUsernameFormat(candidate) !== null) continue;
    // eslint-disable-next-line no-await-in-loop
    const ok = await isUsernameAvailable(supabase, candidate, excludeUserId);
    if (ok) return candidate;
  }
  return `${base}${Date.now()}`.slice(0, 30);
}
