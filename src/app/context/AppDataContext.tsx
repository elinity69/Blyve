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
import { Conversation } from '../hooks/useChat';

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
  conversations: Conversation[];
  refreshConversations: (knownUser?: User | null) => Promise<void>;
  updateConversationOptimistically: (conversationId: string, lastMessage: string, lastMessageAt: string) => void;
  isLoadingConversations: boolean;
  currentUserProfile: any | null;
  refreshCurrentUserProfile: (knownUser?: User | null) => Promise<void>;
  isLoadingProfile: boolean;
}

const noop = async () => {};
const defaultAppDataContext: AppDataContextType = {
  conversations: [],
  refreshConversations: noop,
  updateConversationOptimistically: () => {},
  isLoadingConversations: false,
  currentUserProfile: null,
  refreshCurrentUserProfile: noop,
  isLoadingProfile: false,
};

const AppDataContext = createContext<AppDataContextType>(defaultAppDataContext);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(true);
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
          .select('id, name, email, avatar_url, display_name, username, bio, images, dark_mode, ghost_mode, onboarding_complete')
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

  // Load Conversations
  const refreshConversations = useCallback(async (knownUser?: User | null) => {
    try {
      setIsLoadingConversations(true);
      console.log('🔄 AppDataContext: Loading conversations...');
      console.log('🔄 Debug: [refreshConversations] Resolving user...');

      const user = await resolveAuthUser(knownUser ?? undefined);
      console.log('✅ Debug: [refreshConversations] User retrieved:', user?.id || 'null');
      
      if (!user) {
        console.log('⚠️ AppDataContext: No user found for conversations');
        setConversations([]);
        return;
      }

      // Get all conversations where user is user1 or user2
      console.log('🔄 Debug: [refreshConversations] Fetching conversations from DB...');
      const convsPromise = Promise.resolve(
        supabase
          .from('conversations')
          .select('id,user1_id,user2_id,created_at,updated_at,last_message,last_message_at')
          .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
          .order('updated_at', { ascending: false, nullsFirst: false })
          .limit(200)
      );
      
      const convsResult = await timeoutPromise(
        convsPromise,
        10000, // 10 Sekunden für Conversations Query
        'Timeout: Failed to load conversations'
      );
      const { data: convsData, error: convsError } = convsResult;
      console.log('✅ Debug: [refreshConversations] Conversations fetched:', convsData?.length || 0, 'conversations');

      if (convsError) throw convsError;

      // Fetch blocked users (two simple filters — avoids PostgREST 400 on some .or() shapes)
      console.log('🔄 Debug: [refreshConversations] Fetching blocked users...');
      const blockedPromise = (async () => {
        const [asBlocker, asBlocked] = await Promise.all([
          supabase
            .from('blocked_users')
            .select('blocker_id, blocked_user_id')
            .eq('blocker_id', user.id),
          supabase
            .from('blocked_users')
            .select('blocker_id, blocked_user_id')
            .eq('blocked_user_id', user.id),
        ]);
        const err = asBlocker.error || asBlocked.error;
        if (err) {
          console.warn('⚠️ [refreshConversations] blocked_users:', err.message);
          return [];
        }
        const map = new Map<string, { blocker_id: string; blocked_user_id: string }>();
        for (const row of [...(asBlocker.data || []), ...(asBlocked.data || [])]) {
          const key = `${row.blocker_id}:${row.blocked_user_id}`;
          map.set(key, row);
        }
        return [...map.values()];
      })();

      const blockedResult = await timeoutPromise(
        blockedPromise,
        5000, // 5 Sekunden für Blocked Users Query
        'Timeout: Failed to load blocked users'
      );
      const blockedData = blockedResult;
      console.log('✅ Debug: [refreshConversations] Blocked users fetched:', blockedData?.length || 0, 'blocks');

      const blockedByMe = new Set(
        (blockedData || [])
          .filter((b: { blocker_id: string }) => b.blocker_id === user.id)
          .map((b: { blocked_user_id: string }) => b.blocked_user_id)
      );

      const blockedMe = new Set(
        (blockedData || [])
          .filter((b: { blocked_user_id: string }) => b.blocked_user_id === user.id)
          .map((b: { blocker_id: string }) => b.blocker_id)
      );

      const blockedIds = new Set([...blockedByMe, ...blockedMe]);

      const visibleConvs = (convsData || []).filter((conv) => {
        const otherUserId = conv.user1_id === user.id ? conv.user2_id : conv.user1_id;
        return !blockedIds.has(otherUserId);
      });

      const otherUserIds = [
        ...new Set(
          visibleConvs.map((conv) =>
            conv.user1_id === user.id ? conv.user2_id : conv.user1_id
          )
        ),
      ];

      const profileMap = new Map<string, {
        id: string;
        name: string | null;
        display_name: string | null;
        username: string | null;
        images: string[] | null;
        avatar_url: string | null;
        ghost_mode: boolean | null;
      }>();

      if (otherUserIds.length > 0) {
        const profilesPromise = Promise.resolve(
          supabase
            .from('profiles')
            .select('id, name, display_name, username, images, avatar_url, ghost_mode')
            .in('id', otherUserIds)
        );
        const profilesResult = await timeoutPromise(
          profilesPromise,
          10000,
          'Timeout: Failed to load conversation profiles'
        );
        for (const profile of profilesResult.data || []) {
          profileMap.set(profile.id, profile);
        }
      }

      const enrichedConversations: Conversation[] = visibleConvs.map((conv) => {
        const otherUserId = conv.user1_id === user.id ? conv.user2_id : conv.user1_id;
        const profile = profileMap.get(otherUserId);
        const displayLabel = profile?.display_name || profile?.name || 'Unknown';
        return {
          ...conv,
          other_user: {
            id: otherUserId,
            name: displayLabel,
            display_name: profile?.display_name || profile?.name || undefined,
            username: profile?.username || undefined,
            imageUrl: profile?.images?.[0] || profile?.avatar_url || undefined,
            is_online: false,
            ghost_mode: profile?.ghost_mode || false,
          },
          has_messages: !!conv.last_message,
        };
      });

      const filteredConversations = enrichedConversations.filter(Boolean) as Conversation[];
      const sortedChats = filteredConversations.sort((a, b) => {
        const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : (a.updated_at ? new Date(a.updated_at).getTime() : 0);
        const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : (b.updated_at ? new Date(b.updated_at).getTime() : 0);
        return bTime - aTime;
      });

      console.log('✅ Debug: [refreshConversations] Setting conversations...');
      setConversations(sortedChats);
      console.log('✅ Debug: [refreshConversations] Completed successfully');
    } catch (err: any) {
      console.error('❌ Debug: [refreshConversations] Error loading conversations:', err);
      setConversations([]);
    } finally {
      // KRITISCH: Loading-State IMMER zurücksetzen, egal was passiert
      console.log('✅ Debug: [refreshConversations] Finally block - setting loading to false');
      setIsLoadingConversations(false);
    }
  }, []);

  // Optimistically update conversation after sending message
  const updateConversationOptimistically = useCallback((conversationId: string, lastMessage: string, lastMessageAt: string) => {
    setConversations((prev) => {
      const updated = prev.map((conv) => {
        if (conv.id === conversationId) {
          return {
            ...conv,
            last_message: lastMessage,
            last_message_at: lastMessageAt,
            updated_at: lastMessageAt,
          };
        }
        return conv;
      });
      
      // Sort by last_message_at (most recent first)
      return updated.sort((a, b) => {
        const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : (a.updated_at ? new Date(a.updated_at).getTime() : 0);
        const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : (b.updated_at ? new Date(b.updated_at).getTime() : 0);
        return bTime - aTime;
      });
    });
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
      setIsLoadingConversations(false);
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
        setIsLoadingConversations(false);
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
        
        console.log('🔄 Debug: [loadUserData] Calling refreshConversations...');
        const conversationsPromise = refreshConversations(user).catch(err => {
          console.error('❌ AppDataContext: Error loading conversations:', err);
        });
        
        const loadDataPromise = Promise.allSettled([
          profilePromise,
          conversationsPromise,
        ]);
        
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
        const promiseNames = ['refreshCurrentUserProfile', 'refreshConversations'];
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
        setConversations([]);
        setCurrentUserProfile(null);
        setIsLoadingConversations(false);
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
      
      // KRITISCH: Auch bei Fehler Loading-State zurücksetzen
      setIsLoadingConversations(false);
      setIsLoadingProfile(false);
    } finally {
      // CRITICAL: Always reset loading states in finally block (safety net)
      // This ensures states are reset even if an error occurs or function returns early
      setIsLoadingConversations(false);
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
  }, [refreshCurrentUserProfile, refreshConversations]);

  // Initial load + shared auth listener (token sync in authSession)
  useEffect(() => {
    let mounted = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const finishLoading = () => {
      if (!mounted) return;
      setIsLoadingConversations(false);
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
        setConversations([]);
        setCurrentUserProfile(null);
        finishLoading();
        isLoadingRef.current = false;
        lastLoadUserIdRef.current = null;
        currentUserIdRef.current = null;
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
        void loadUserData(user);
      }
    };
    window.addEventListener('app-data-reload', handleReload);
    return () => window.removeEventListener('app-data-reload', handleReload);
  }, [loadUserData]);

  const value = useMemo<AppDataContextType>(
    () => ({
      conversations,
      refreshConversations,
      updateConversationOptimistically,
      isLoadingConversations,
      currentUserProfile,
      refreshCurrentUserProfile,
      isLoadingProfile,
    }),
    [
      conversations,
      refreshConversations,
      updateConversationOptimistically,
      isLoadingConversations,
      currentUserProfile,
      refreshCurrentUserProfile,
      isLoadingProfile,
    ]
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
