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

// Debug-Log für Dev-Modus-Erkennung
if (isDevMode) {
  console.log('🐛 Dev-Modus erkannt: Timeouts deaktiviert für ungestörtes Debugging');
}

interface AppDataContextType {
  currentUserProfile: any | null;
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
  const [currentUserProfile, setCurrentUserProfile] = useState<any | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  // Load Current User Profile
  const refreshCurrentUserProfile = useCallback(async (knownUser?: User | null) => {
    try {
      console.log('🔄 AppDataContext: Loading current user profile...');
      console.log('🔄 Debug: [refreshCurrentUserProfile] Resolving user...');

      const sessionUser = await resolveAuthUser(knownUser ?? undefined);
      console.log('✅ Debug: [refreshCurrentUserProfile] User retrieved:', sessionUser?.id || 'null');
      
      if (!sessionUser) {
        console.log('⚠️ AppDataContext: No user found for profile');
        setCurrentUserProfile(null);
        return;
      }

      console.log('🔄 Debug: [refreshCurrentUserProfile] Fetching profile from DB...');
      const profilePromise = Promise.resolve(
        supabase
          .from('profiles')
          .select('id, name, email, avatar_url, display_name, username, bio, images, dark_mode, theme_mode, ghost_mode, onboarding_complete')
          .eq('id', sessionUser.id)
          .maybeSingle()
      );
      
      const result = await timeoutPromise(
        profilePromise,
        10000, // 10 Sekunden für Profile Query
        'Timeout: Failed to load user profile'
      );
      const { data, error } = result;
      console.log('✅ Debug: [refreshCurrentUserProfile] Profile fetched:', data ? 'success' : 'null', error ? 'error' : 'no error');

      // WICHTIG: Erstelle Fallback-Objekt, wenn Profil nicht existiert
      const finalProfile = data || { id: sessionUser.id };

      // ERZWINGEN der Email aus der Session - IMMER, wenn sessionUser existiert
      if (!finalProfile.email && sessionUser.email) {
        console.log('🔧 AppDataContext: FORCE applying email from session:', sessionUser.email);
        finalProfile.email = sessionUser.email;
        
        // Versuch Reparatur im Hintergrund (Fehler ignorieren)
        Promise.resolve(
          supabase
            .from('profiles')
            .update({ email: sessionUser.email })
            .eq('id', sessionUser.id)
        ).then(({ error: updateError }) => {
          if (updateError) {
            console.warn('⚠️ AppDataContext: Failed to update email in DB (non-critical):', updateError);
          } else {
            console.log('✅ AppDataContext: Email fixed in database');
          }
        }).catch((err: any) => {
          console.warn('⚠️ AppDataContext: Error updating email (non-critical):', err);
        });
      }

      // ZUSÄTZLICHE SICHERHEIT: Falls Profil existiert, aber Email immer noch fehlt
      if (data && !finalProfile.email && sessionUser.email) {
        console.log('🔧 AppDataContext: Additional safety check - applying email from session');
        finalProfile.email = sessionUser.email;
      }

      console.log('✅ Debug: [refreshCurrentUserProfile] Setting current user profile...');
      setCurrentUserProfile(finalProfile);
      // Update current user ID ref
      if (sessionUser?.id) {
        currentUserIdRef.current = sessionUser.id;
      }
      console.log('✅ AppDataContext: Current user profile loaded', { 
        hasEmail: !!finalProfile.email, 
        email: finalProfile.email ? '***' : 'MISSING' 
      });
      console.log('✅ Debug: [refreshCurrentUserProfile] Completed successfully');
    } catch (error) {
      console.error('❌ Debug: [refreshCurrentUserProfile] Error loading profile:', error);
      // Auch bei Fehler: Versuche zumindest ein minimales Profil mit Email zu erstellen
      try {
        const sessionUser = await resolveAuthUser(knownUser ?? undefined);
        if (sessionUser?.email) {
          console.log('🔧 AppDataContext: Creating fallback profile with email from session');
          setCurrentUserProfile({ id: sessionUser.id, email: sessionUser.email });
        } else {
          setCurrentUserProfile(null);
        }
      } catch (fallbackError) {
        console.error('❌ AppDataContext: Fallback also failed:', fallbackError);
        setCurrentUserProfile(null);
      }
    } finally {
      // KRITISCH: Loading-State IMMER zurücksetzen, egal was passiert
      console.log('✅ Debug: [refreshCurrentUserProfile] Finally block - setting loading to false');
      setIsLoadingProfile(false);
    }
  }, []);

  // Ref to prevent multiple simultaneous loads
  const isLoadingRef = useRef(false);
  const lastLoadUserIdRef = useRef<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  // Load data when user is authenticated
  const loadUserData = useCallback(async (knownUser?: User | null) => {
    // GUARD LOG: Log am Anfang, VOR allen Checks
    console.log('🚪 Debug: [loadUserData] ENTRY - Function called', {
      isLoadingRef: isLoadingRef.current,
      lastLoadUserId: lastLoadUserIdRef.current,
      currentUserIdRef: currentUserIdRef.current,
      hasKnownUser: knownUser !== undefined,
    });
    
    console.log('🔄 Debug: [loadUserData] Starting - resolving user...');
    let user = knownUser;
    if (user === undefined) {
      user = await resolveAuthUser();
    }
    console.log('✅ Debug: [loadUserData] User retrieved:', user?.id || 'null');
    const currentUserId = user?.id || null;

    // Prevent multiple simultaneous loads for the same user
    if (isLoadingRef.current && lastLoadUserIdRef.current === currentUserId) {
      console.log('⚠️ AppDataContext: Already loading for this user, skipping...', {
        isLoadingRef: isLoadingRef.current,
        lastLoadUserId: lastLoadUserIdRef.current,
        currentUserId: currentUserId
      });
      // CRITICAL: Even if skipping, ensure loading states are reset (in case of previous error)
      setIsLoadingProfile(false);
      return;
    }

    isLoadingRef.current = true;
    lastLoadUserIdRef.current = currentUserId;
    if (currentUserId) {
      currentUserIdRef.current = currentUserId; // Update current user ID ref
    }

    // SICHERHEITS-TIMEOUT: Nur in Production, im Dev-Modus deaktiviert
    const timeoutId = INIT_TIMEOUT_MS === Infinity ? null : setTimeout(() => {
      if (isLoadingRef.current) {
        console.error(`⏱️ AppDataContext: Load timeout after ${INIT_TIMEOUT_MS}ms - forcing completion`);
        isLoadingRef.current = false;
        setIsLoadingProfile(false);
      }
    }, INIT_TIMEOUT_MS);

    try {
      console.log('🔄 AppDataContext: Loading user data...', currentUserId);
      if (user) {
        console.log('✅ AppDataContext: User found, loading data...');
        
        // Load all data in parallel with error handling for each
        // WICHTIG: Jede Funktion hat bereits ihren eigenen Timeout, aber wir wrappen
        // den gesamten Prozess zusätzlich mit einem Timeout
        
        console.log('🔄 Debug: [loadUserData] Starting parallel data load...');
        console.log('🔄 Debug: [loadUserData] Calling refreshCurrentUserProfile...');
        const profilePromise = refreshCurrentUserProfile(user).catch(err => {
          console.error('❌ AppDataContext: Error loading profile:', err);
        });
        
        const loadDataPromise = Promise.allSettled([profilePromise]);
        
        console.log('🔄 Debug: [loadUserData] Waiting for all promises to settle...');
        // Timeout nur in Production, im Dev-Modus deaktiviert
        let results;
        if (isDevMode) {
          results = await loadDataPromise; // Kein Timeout im Dev-Modus
        } else {
          results = await timeoutPromise(
            loadDataPromise,
            20000, // 20 Sekunden für gesamten Load-Prozess (länger als einzelne Timeouts)
            'Timeout: Overall data loading process took too long'
          );
        }
        
        // DETAILLIERTES LOGGING: Welches Promise hat funktioniert, welches nicht?
        console.log('📊 Debug: [loadUserData] Promise.allSettled results:');
        const promiseNames = ['refreshCurrentUserProfile'];
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            console.log(`  ✅ ${promiseNames[index]}: FULFILLED`);
          } else {
            console.error(`  ❌ ${promiseNames[index]}: REJECTED -`, result.reason);
          }
        });
        
        console.log('✅ Debug: [loadUserData] All promises settled');
        console.log('✅ AppDataContext: All data load attempts completed');
      } else {
        console.log('⚠️ AppDataContext: No user found, clearing data...');
        setCurrentUserProfile(null);
        setIsLoadingProfile(false);
      }
    } catch (error: any) {
      // SOFTER ERROR HANDLER: Nur bei echten Auth-Fehlern ausloggen
      const errorMessage = error?.message || String(error);
      const isAuthError = 
        errorMessage.includes('JWT expired') ||
        errorMessage.includes('Refresh Token Not Found') ||
        errorMessage.includes('Invalid refresh token') ||
        errorMessage.includes('session_not_found') ||
        errorMessage.includes('invalid_token');
      
      if (isAuthError) {
        // Echter Auth-Fehler - User muss sich neu einloggen
        console.warn('⚠️ AppDataContext: Auth error loading user data:', errorMessage);
        // NICHT automatisch ausloggen - das macht der Auth-Listener
      } else {
        // Netzwerk-Fehler, Timeout, Server-Hiccup - NICHT ausloggen
        console.warn('⚠️ AppDataContext: Non-critical error loading user data (keeping session):', errorMessage);
        // Im Dev-Modus: Noch geduldiger
        if (isDevMode) {
          console.debug('🐛 Dev-Modus: Ignoring non-critical load error, keeping user logged in');
        }
      }
      
      setIsLoadingProfile(false);
    } finally {
      setIsLoadingProfile(false);
      
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      isLoadingRef.current = false;
      // Reset lastLoadUserId only after a delay to prevent rapid re-loads
      setTimeout(() => {
        if (!isLoadingRef.current) {
          lastLoadUserIdRef.current = null;
        }
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
                console.error(
                  `⏱️ AppDataContext: Init timeout after ${INIT_TIMEOUT_MS}ms - forcing completion`
                );
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
