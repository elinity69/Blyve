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
    initPromise = supabase.auth.getSession().then(({ data: { session } }) => {
      cachedSession = session;
      cachedUser = session?.user ?? null;
      sessionHydrated = true;
      syncAccessToken(session);
      return session;
    });
  }
  return initPromise;
}

export function getCachedSession(): Session | null {
  return cachedSession;
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
