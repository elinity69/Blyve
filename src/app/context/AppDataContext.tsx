import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  ReactNode,
} from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { getCachedUser, initAuthSession, resolveAuthUser, subscribeAuth } from '../lib/authSession';
import { invalidateConversationMembershipCache } from '../lib/conversationMembership';

/**
 * Timeout Promise Helper - "The Watchdog"
 * 
 * Wraps a promise with a timeout. If the promise doesn't resolve/reject
 * within the specified time, it rejects with a timeout error.
 * 
 * @param promise - The promise to wrap
 * @param ms - Timeout in milliseconds
 * @param errorMessage - Optional custom error message
 * @returns Promise that rejects on timeout
 */
function timeoutPromise<T>(
  promise: Promise<T>,
  ms: number,
  errorMessage = `Operation timed out after ${ms}ms`
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(errorMessage));
      }, ms);
    }),
  ]);
}

// Timeout deaktiviert im Dev-Modus für ungestörtes Debugging
// Prüfe verschiedene Dev-Modus-Indikatoren (React Native/Expo, Vite, Node)
const isDevMode = 
  (typeof __DEV__ !== 'undefined' && __DEV__) || // React Native/Expo
  (typeof import.meta !== 'undefined' && import.meta.env?.DEV) || // Vite
  (typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'development') || // Vite MODE
  (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development'); // Node/Webpack

const INIT_TIMEOUT_MS = isDevMode ? Infinity : 15000;

interface UserProfile {
  id: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  display_name?: string | null;
  username?: string | null;
  bio?: string | null;
  images?: string[] | null;
  dark_mode?: boolean | null;
  theme_mode?: string | null;
  ghost_mode?: boolean | null;
  onboarding_complete?: boolean | null;
  imageUrl?: string | null;
}

interface AppDataContextType {
  currentUserProfile: UserProfile | null;
  refreshCurrentUserProfile: (knownUser?: User | null) => Promise<void>;
  isLoadingProfile: boolean;
}

const noop = async () => {};
const defaultAppDataContext: AppDataContextType = {
  currentUserProfile: null,
  refreshCurrentUserProfile: noop,
  isLoadingProfile: false,
};

const AppDataContext = createContext<AppDataContextType>(defaultAppDataContext);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  const refreshCurrentUserProfile = useCallback(async (knownUser?: User | null) => {
    try {
      const sessionUser = await resolveAuthUser(knownUser ?? undefined);
      
      if (!sessionUser) {
        setCurrentUserProfile(null);
        return;
      }

      const profilePromise = Promise.resolve(
        supabase
          .from('profiles')
          .select('id, name, email, avatar_url, display_name, username, bio, images, dark_mode, theme_mode, ghost_mode, onboarding_complete')
          .eq('id', sessionUser.id)
          .maybeSingle()
      );
      
      const result = await timeoutPromise(
        profilePromise,
        10000,
        'Timeout: Failed to load user profile'
      );
      const { data, error } = result;
      if (error) console.warn('AppDataContext: profile fetch error', error);

      const finalProfile: UserProfile = data || { id: sessionUser.id };

      if (!finalProfile.email && sessionUser.email) {
        finalProfile.email = sessionUser.email;
        Promise.resolve(
          supabase
            .from('profiles')
            .update({ email: sessionUser.email })
            .eq('id', sessionUser.id)
        ).then(({ error: updateError }) => {
          if (updateError) console.warn('AppDataContext: Failed to update email in DB:', updateError);
        }).catch((err: any) => {
          console.warn('AppDataContext: Error updating email:', err);
        });
      }

      if (data && !finalProfile.email && sessionUser.email) {
        finalProfile.email = sessionUser.email;
      }

      setCurrentUserProfile(finalProfile);
      if (sessionUser?.id) {
        currentUserIdRef.current = sessionUser.id;
      }
    } catch (error) {
      console.error('AppDataContext: Error loading profile:', error);
      try {
        const sessionUser = await resolveAuthUser(knownUser ?? undefined);
        if (sessionUser?.email) {
          setCurrentUserProfile({ id: sessionUser.id, email: sessionUser.email });
        } else {
          setCurrentUserProfile(null);
        }
      } catch (fallbackError) {
        console.error('AppDataContext: Fallback also failed:', fallbackError);
        setCurrentUserProfile(null);
      }
    } finally {
      setIsLoadingProfile(false);
    }
  }, []);

  // Ref to prevent multiple simultaneous loads
  const isLoadingRef = useRef(false);
  const lastLoadUserIdRef = useRef<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);

  const loadUserData = useCallback(async (knownUser?: User | null) => {
    let user = knownUser;
    if (user === undefined) {
      user = await resolveAuthUser();
    }
    const currentUserId = user?.id || null;

    if (isLoadingRef.current && lastLoadUserIdRef.current === currentUserId) {
      return;
    }

    isLoadingRef.current = true;
    lastLoadUserIdRef.current = currentUserId;
    if (currentUserId) {
      currentUserIdRef.current = currentUserId;
    }

    const timeoutId = INIT_TIMEOUT_MS === Infinity ? null : setTimeout(() => {
      if (isLoadingRef.current) {
        console.error(`AppDataContext: Load timeout after ${INIT_TIMEOUT_MS}ms`);
        isLoadingRef.current = false;
        setIsLoadingProfile(false);
      }
    }, INIT_TIMEOUT_MS);

    try {
      if (user) {
        const profilePromise = refreshCurrentUserProfile(user).catch(err => {
          console.error('AppDataContext: Error loading profile:', err);
        });
        if (isDevMode) {
          await Promise.allSettled([profilePromise]);
        } else {
          await timeoutPromise(
            Promise.allSettled([profilePromise]),
            20000,
            'Timeout: Overall data loading process took too long'
          );
        }
      } else {
        setCurrentUserProfile(null);
        setIsLoadingProfile(false);
      }
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      const isAuthError =
        errorMessage.includes('JWT expired') ||
        errorMessage.includes('Refresh Token Not Found') ||
        errorMessage.includes('Invalid refresh token') ||
        errorMessage.includes('session_not_found') ||
        errorMessage.includes('invalid_token');
      if (isAuthError) {
        console.warn('AppDataContext: Auth error loading user data:', errorMessage);
      } else {
        console.warn('AppDataContext: Non-critical error loading user data:', errorMessage);
      }
      setIsLoadingProfile(false);
    } finally {
      setIsLoadingProfile(false);
      if (timeoutId) clearTimeout(timeoutId);
      isLoadingRef.current = false;
      setTimeout(() => {
        if (!isLoadingRef.current) lastLoadUserIdRef.current = null;
      }, 1000);
    }
  }, [refreshCurrentUserProfile]);

  // Initial load + shared auth listener (token sync in authSession)
  useEffect(() => {
    let mounted = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const finishLoading = () => {
      if (!mounted) return;
      setIsLoadingProfile(false);
    };

    const bootstrap = async () => {
      timeoutId =
        INIT_TIMEOUT_MS === Infinity
          ? null
          : setTimeout(() => {
              if (mounted) {
                console.error(`AppDataContext: Init timeout after ${INIT_TIMEOUT_MS}ms`);
                finishLoading();
              }
            }, INIT_TIMEOUT_MS);

      try {
        const session = await initAuthSession();
        if (mounted && session?.user) {
          currentUserIdRef.current = session.user.id;
          await loadUserData(session.user);
        } else if (mounted) {
          finishLoading();
        }
      } catch (error) {
        console.warn('AppDataContext: init failed:', error);
        finishLoading();
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    };

    void bootstrap();

    const unsubscribe = subscribeAuth((event, session) => {
      if (!mounted) return;
      if (event === 'TOKEN_REFRESHED') return;

      if (event === 'SIGNED_IN') {
        if (!session?.user) return;
        const newUserId = session.user.id;
        const isSameUser = currentUserIdRef.current === newUserId;
        if (isSameUser && isLoadingRef.current) return;
        if (isSameUser) return;

        currentUserIdRef.current = newUserId;
        window.setTimeout(() => {
          if (!mounted) return;
          void loadUserData(session.user);
        }, 0);
        return;
      }

      if (event === 'SIGNED_OUT') {
        api.setAccessToken(null);
        setCurrentUserProfile(null);
        finishLoading();
        isLoadingRef.current = false;
        lastLoadUserIdRef.current = null;
        currentUserIdRef.current = null;
        invalidateConversationMembershipCache();
      }
    });

    return () => {
      mounted = false;
      if (timeoutId) clearTimeout(timeoutId);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleReload = () => {
      const user = getCachedUser();
      if (user) {
        void refreshCurrentUserProfile(user);
      }
      window.dispatchEvent(new CustomEvent('conversation-list-reload-requested'));
    };
    window.addEventListener('app-data-reload', handleReload);
    return () => window.removeEventListener('app-data-reload', handleReload);
  }, [refreshCurrentUserProfile]);

  const value = useMemo<AppDataContextType>(
    () => ({
      currentUserProfile,
      refreshCurrentUserProfile,
      isLoadingProfile,
    }),
    [currentUserProfile, refreshCurrentUserProfile, isLoadingProfile]
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const context = useContext(AppDataContext);
  if (context === defaultAppDataContext) {
    console.warn('useAppData used outside AppDataProvider; using defaults.');
  }
  return context;
}
