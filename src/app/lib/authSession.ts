import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { api } from './api';

type AuthListener = (event: AuthChangeEvent, session: Session | null) => void;

let cachedSession: Session | null = null;
let cachedUser: User | null = null;
let sessionHydrated = false;
let initPromise: Promise<Session | null> | null = null;
let listenerRegistered = false;

const listeners = new Set<AuthListener>();

/** Returns true if the session token is expired or expires within the next 60 seconds. */
function isSessionExpired(session: Session): boolean {
  if (!session.expires_at) return false;
  return session.expires_at * 1000 - Date.now() < 60_000;
}

function syncAccessToken(session: Session | null) {
  if (session?.access_token) {
    api.setAccessToken(session.access_token);
  } else if (!session) {
    api.setAccessToken(null);
  }
}

function emit(event: AuthChangeEvent, session: Session | null) {
  cachedSession = session;
  cachedUser = session?.user ?? null;
  listeners.forEach((listener) => {
    try {
      listener(event, session);
    } catch (error) {
      console.warn('authSession listener error:', error);
    }
  });
}

function isInvalidRefreshTokenError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message ?? error ?? '').toLowerCase();
  return (
    message.includes('invalid refresh token') ||
    message.includes('refresh token not found') ||
    message.includes('refresh_token_not_found')
  );
}

/** Clear stale Supabase/local auth after expired or revoked refresh tokens. */
export async function clearInvalidAuthSession(): Promise<void> {
  cachedSession = null;
  cachedUser = null;
  sessionHydrated = true;
  api.setAccessToken(null);
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // ignore — local storage is already cleared via signOut scope local when possible
  }
}

/** Register a single Supabase auth listener for the whole app. */
export function ensureAuthListener() {
  if (listenerRegistered) return;
  listenerRegistered = true;

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    syncAccessToken(session);
    emit(event, session);
  });

  return data.subscription;
}

/** Load session once at startup; safe to call multiple times. */
export function initAuthSession(): Promise<Session | null> {
  if (!initPromise) {
    ensureAuthListener();
    initPromise = supabase.auth
      .getSession()
      .then(async ({ data: { session }, error }) => {
        if (error) {
          if (isInvalidRefreshTokenError(error)) {
            await clearInvalidAuthSession();
            return null;
          }
          throw error;
        }
        cachedSession = session;
        cachedUser = session?.user ?? null;
        sessionHydrated = true;
        syncAccessToken(session);
        return session;
      })
      .catch(async (error) => {
        // Reset so next call can retry.
        initPromise = null;
        if (isInvalidRefreshTokenError(error)) {
          await clearInvalidAuthSession();
          return null;
        }
        sessionHydrated = true;
        cachedSession = null;
        cachedUser = null;
        api.setAccessToken(null);
        throw error;
      });
  }
  return initPromise;
}

/**
 * Returns a valid (non-expired) access token. If the cached session is
 * expired or missing, forces a Supabase token refresh before returning.
 * This is the correct method to call before every authenticated request.
 */
export async function getOrRefreshSession(): Promise<Session | null> {
  // Fast path: in-memory session that is still valid.
  if (cachedSession && !isSessionExpired(cachedSession)) {
    return cachedSession;
  }

  // Read from the Supabase SDK's own storage (e.g. localStorage).
  // This covers the case where the user just logged in but the auth listener
  // hasn't fired yet — the SDK already has the session, we just lack it in cache.
  const { data: current } = await supabase.auth.getSession();
  const currentSession = current?.session ?? null;

  if (currentSession && !isSessionExpired(currentSession)) {
    // Session exists and is valid — cache it and return without a network call.
    cachedSession = currentSession;
    cachedUser = currentSession.user ?? null;
    sessionHydrated = true;
    syncAccessToken(currentSession);
    return currentSession;
  }

  // No session at all — user is logged out.
  if (!currentSession) {
    return null;
  }

  // Session exists but is expired — exchange refresh token for a new access token.
  const { data, error } = await supabase.auth.refreshSession();
  if (error) {
    if (isInvalidRefreshTokenError(error)) {
      await clearInvalidAuthSession();
      return null;
    }
    // Refresh failed for another reason (e.g. network error) — return the stale
    // session so the request can at least attempt to run (the 401 retry in api.ts
    // will call refreshSession explicitly if needed).
    return currentSession;
  }

  const session = data?.session ?? null;
  cachedSession = session;
  cachedUser = session?.user ?? null;
  sessionHydrated = true;
  syncAccessToken(session);
  // Reset init promise so future initAuthSession() calls pick up the fresh session.
  initPromise = null;
  return session;
}

export function getCachedSession(): Session | null {
  return cachedSession;
}

export function getCachedAccessToken(): string | null {
  return cachedSession?.access_token ?? null;
}

export function getCachedUser(): User | null {
  return cachedUser;
}

export function subscribeAuth(listener: AuthListener): () => void {
  listeners.add(listener);
  if (sessionHydrated) {
    listener('INITIAL_SESSION', cachedSession);
  }
  return () => {
    listeners.delete(listener);
  };
}

/** Prefer cached user/session; optional explicit user from caller. */
export async function resolveAuthUser(knownUser?: User | null): Promise<User | null> {
  if (knownUser) return knownUser;
  if (cachedUser) return cachedUser;
  const session = await initAuthSession();
  return session?.user ?? null;
}
