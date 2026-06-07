import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { supabase } from './lib/supabase';
import { AuthScreen } from './components/AuthScreen';
import { OnboardingWizard } from './components/OnboardingWizard';
import { MessagesScreen } from './components/MessagesScreen';
import { SettingsScreen } from './components/SettingsScreen';
import { BlyveProfileScreen } from './components/BlyveProfileScreen';
import { EditProfileScreen } from './components/EditProfileScreen';
import { BottomNavigation } from './components/BottomNavigation';
import { useIsMobile } from './components/ui/use-mobile';
import { api } from './lib/api';
import { LegalDocs } from './components/LegalDocs';
import { Toaster } from './components/ui/sonner';
import { AppDataProvider } from './context/AppDataContext';
import { ToastProvider } from './context/ToastContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { NotificationManager, syncSystemPushPreferenceToServiceWorker } from './lib/notifications';
import { useMessageRealtime } from './hooks/useMessageRealtime';
import { useTypingRealtime } from './hooks/useTypingRealtime';
import { NotificationPrompt } from './components/NotificationPrompt';
import { UnreadProvider } from './context/UnreadContext';
import { CallProvider, useCall } from './context/CallStateContext';
import { CallJoinScreen } from './components/CallJoinScreen';
import { parseCallJoinParams } from './lib/callJoinRoute';
import i18n from '../lib/i18n';
import {
  applyBootTheme,
  applyThemeMode,
  applyThemePreference,
  clearThemeCache,
  readThemeCache,
  syncThemeFromProfile,
} from './lib/theme';
import {
  getCachedAccessToken,
  getCachedUser,
  initAuthSession,
  resolveAuthUser,
  subscribeAuth,
} from './lib/authSession';
import { invalidateConversationMembershipCache } from './lib/conversationMembership';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 10,
      gcTime: 1000 * 60 * 30,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  },
});

interface AppContentProps {
  onUserIdChange?: (userId: string | null) => void;
}

function AppContent({ onUserIdChange }: AppContentProps = {}) {
  const [isDarkMode, setIsDarkMode] = useState(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : true
  );
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [needsProfilePicture, setNeedsProfilePicture] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [onboardingUserData, setOnboardingUserData] = useState<{ email?: string; name?: string }>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'messages' | 'profile'>('messages');
  const [profileScreenKey, setProfileScreenKey] = useState(0); // Key to force re-render and reset
  const closeProfileSubScreensRef = useRef<(() => void) | null>(null); // Ref zum Schließen von Sub-Screens
  const [showLegalDocs, setShowLegalDocs] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [callJoinParams, setCallJoinParams] = useState(() => parseCallJoinParams());
  const [showCallJoin, setShowCallJoin] = useState(() => parseCallJoinParams() != null);
  const { state: callState, callDisplayMode } = useCall();
  const isMobile = useIsMobile();
  const hideBottomNavigationForCall =
    callState === 'in_call' && callDisplayMode === 'fullscreen';
  const showBottomNavigation = !hideBottomNavigationForCall;

  const refreshCallJoinRoute = useCallback(() => {
    const params = parseCallJoinParams();
    if (params) {
      setCallJoinParams(params);
      setShowCallJoin(true);
    }
  }, []);

  useEffect(() => {
    refreshCallJoinRoute();
    window.addEventListener('popstate', refreshCallJoinRoute);
    return () => window.removeEventListener('popstate', refreshCallJoinRoute);
  }, [refreshCallJoinRoute]);

  useEffect(() => {
    if (isAuthenticated && !needsOnboarding) {
      refreshCallJoinRoute();
    }
  }, [isAuthenticated, needsOnboarding, refreshCallJoinRoute]);

  useEffect(() => {
    const init = async () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get('legal') === '1') {
        setShowLegalDocs(true);
      }

      let sessionUser: { id: string; email?: string | null } | null = null;

      try {
        const session = await initAuthSession();
        sessionUser = session?.user ?? null;

        // Apply cached theme immediately, then sync from profile once session is known
        const sessionUserId = sessionUser?.id ?? null;
        const cachedTheme = readThemeCache();
        if (cachedTheme) {
          applyThemeMode(cachedTheme.themeMode);
        } else {
          applyThemePreference(undefined);
        }

        if (sessionUserId) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('dark_mode, theme_mode')
            .eq('id', sessionUserId)
            .maybeSingle();
          syncThemeFromProfile(sessionUserId, profile);
        }
      } catch (error) {
        console.warn('Session check failed:', error);
        applyBootTheme();
      }

      const token = getCachedAccessToken() ?? (await api.getAccessToken());

      if (token && typeof token === 'string') {
      try {
        const user = sessionUser ?? getCachedUser() ?? (await resolveAuthUser());
        if (!user) {
          api.setAccessToken(null);
          throw new Error('No user found');
        }
        
        // Set current user ID for notifications
        setCurrentUserId(user.id);
        onUserIdChange?.(user.id);
        // Dispatch event for UnreadProvider
        window.dispatchEvent(new CustomEvent('user-id-change', { detail: { userId: user.id } }));

        // FIX: Verwende maybeSingle() statt single() - verhindert Crash bei neuen Usern
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id, name, email, avatar_url, display_name, username, bio, dark_mode, theme_mode, onboarding_complete')
          .eq('id', user.id)
          .maybeSingle();

        // WICHTIG: Wenn Profil null ist (aber kein Fehler), ist das ein neuer User
        if (profileError) {
          throw new Error(profileError?.message || 'Profile load error');
        }

        // Wenn kein Profil existiert, erstelle Fallback für neuen User
        if (!profile) {
          console.log('🆕 Neuer User erkannt - Profil existiert noch nicht, erstelle Fallback');
          const fallbackProfile = {
            id: user.id,
            email: user.email || '',
            name: '',
            avatar_url: null,
            bio: null,
            onboarding_complete: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          
          const mappedProfile = {
            name: fallbackProfile.name,
            email: fallbackProfile.email,
            imageUrl: fallbackProfile.avatar_url,
            profileComplete: false,
            onboarding_complete: false,
          };
          
          console.log('✅ Fallback-Profil erstellt für neuen User');
          console.log('Profile status:', {
            profileComplete: mappedProfile.profileComplete,
            hasImageUrl: !!mappedProfile.imageUrl,
            onboarding_complete: mappedProfile.onboarding_complete
          });
          setIsAuthenticated(true);
          
          // Neuer User -> Zeige Onboarding
          setNeedsOnboarding(true);
          setOnboardingUserData({
            email: fallbackProfile.email,
            name: fallbackProfile.name,
          });
          setLoading(false);
          return; // Früh beenden, kein Shop-Check für neuen User
        }

        // Map Supabase profile to expected format
        const mappedProfile = {
          name: profile.name,
          email: profile.email,
          imageUrl: profile.avatar_url,
          profileComplete: !!profile.name && !!profile.avatar_url && !!profile.bio,
          onboarding_complete: profile.onboarding_complete || false,
        };

        console.log('✅ Token is valid - Profile loaded successfully:', mappedProfile.name);
          console.log('Profile status:', {
          profileComplete: mappedProfile.profileComplete,
          hasImageUrl: !!mappedProfile.imageUrl,
          });
          syncThemeFromProfile(user.id, profile);
          setIsAuthenticated(true);

          // FIX: Prüfe onboarding_complete - wenn false oder null, zeige Onboarding
          // WICHTIG: Prüfe explizit auf false/null, nicht nur auf truthy
          const needsOnboardingCheck = mappedProfile.onboarding_complete === false || 
                                        mappedProfile.onboarding_complete === null || 
                                        mappedProfile.onboarding_complete === undefined;
          
          if (needsOnboardingCheck) {
            console.log('🏁 Debug: [App.tsx] User needs onboarding (wizard) - onboarding_complete:', mappedProfile.onboarding_complete);
            setNeedsOnboarding(true);
            setOnboardingUserData({
              email: mappedProfile.email || user?.email || '',
              name: mappedProfile.name || '',
            });
            console.log('🏁 Debug: [App.tsx] Onboarding state set, loading will be set to false in finally block');
          } else {
            console.log('🏁 Debug: [App.tsx] Profile onboarding complete:', mappedProfile.onboarding_complete);
            setNeedsOnboarding(false);
            setNeedsProfilePicture(false);
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn('Session expired or invalid — signing out:', message);
          await api.signout();
          setIsAuthenticated(false);
          setCurrentUserId(null);
          onUserIdChange?.(null);
        } finally {
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    };

    init();
  }, []);

  // Track Dark Mode changes and update all background layers
  useEffect(() => {
    const checkDarkMode = () => {
      const isDark = document.documentElement.classList.contains('dark');
      setIsDarkMode(isDark);
      
      const bgColor = isDark ? '#000000' : '#ffffff';
      document.body.style.backgroundColor = bgColor;
      document.documentElement.style.backgroundColor = bgColor;
      const blackCurtain = document.getElementById('black-curtain');
      if (blackCurtain) {
        blackCurtain.style.backgroundColor = bgColor;
      }
      const rootElement = document.getElementById('root');
      if (rootElement) {
        rootElement.style.backgroundColor = bgColor;
      }
    };
    
    // Initial check
    checkDarkMode();
    
    // Watch for changes
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    
    return () => observer.disconnect();
  }, []);

  const handleAuthSuccess = async () => {
    setIsAuthenticated(true);
    setLoading(true);
    // Check if new user needs onboarding
    try {
      // Use Supabase directly instead of API for profile check (more reliable)
      const user = getCachedUser() ?? (await resolveAuthUser());
      
      if (!user) {
        console.warn('No user found after login');
        setNeedsOnboarding(false);
        setNeedsProfilePicture(false);
        setLoading(false);
        setCurrentUserId(null);
        onUserIdChange?.(null);
        window.dispatchEvent(new CustomEvent('user-id-change', { detail: { userId: null } }));
        invalidateConversationMembershipCache();
        return;
      }
      
      // Set current user ID for notifications and unread context
      setCurrentUserId(user.id);
      onUserIdChange?.(user.id);
      // Dispatch event for UnreadProvider
      window.dispatchEvent(new CustomEvent('user-id-change', { detail: { userId: user.id } }));

      // Get profile directly from Supabase
      // FIX: Verwende maybeSingle() statt single() - verhindert Crash bei neuen Usern
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, name, email, avatar_url, display_name, username, bio, dark_mode, theme_mode, onboarding_complete')
        .eq('id', user.id)
        .maybeSingle();

      if (profileError) {
        console.error('Failed to load profile from Supabase:', profileError);
        // Continue anyway - user can still use the app
        setNeedsOnboarding(false);
        setNeedsProfilePicture(false);
        setLoading(false);
        return;
      }

      // WICHTIG: Wenn Profil null ist (aber kein Fehler), ist das ein neuer User
      if (!profile) {
        console.log('🆕 handleAuthSuccess: Neuer User erkannt - Profil existiert noch nicht, zeige Onboarding');
        setNeedsOnboarding(true);
        setOnboardingUserData({
          email: user.email || '',
          name: '',
        });
        setLoading(false);
        return;
      }

      console.log('Profile loaded from Supabase:', profile);
      syncThemeFromProfile(user.id, profile);
      
      // FIX: Prüfe onboarding_complete explizit - wenn false/null/undefined, zeige Onboarding
      // WICHTIG: Prüfe explizit auf false/null, nicht nur auf truthy
      const needsOnboardingCheck = profile?.onboarding_complete === false || 
                                    profile?.onboarding_complete === null || 
                                    profile?.onboarding_complete === undefined;
      
      if (needsOnboardingCheck) {
        console.log('🏁 Debug: [App.tsx handleAuthSuccess] User needs onboarding, showing wizard - onboarding_complete:', profile?.onboarding_complete);
        setNeedsOnboarding(true);
        setOnboardingUserData({
          email: profile?.email || user.email || '',
          name: profile?.name || '',
        });
        console.log('🏁 Debug: [App.tsx handleAuthSuccess] Onboarding state set, loading will be set to false in finally block');
      } else {
        console.log('🏁 Debug: [App.tsx handleAuthSuccess] Profile onboarding complete:', profile?.onboarding_complete);
        setNeedsOnboarding(false);
        setNeedsProfilePicture(false);
      }
    } catch (error: any) {
      console.error('Failed to check profile status:', error);
      // Don't block the app - continue without onboarding checks
      setNeedsOnboarding(false);
      setNeedsProfilePicture(false);
    } finally {
      setLoading(false);
    }
  };

  const handleProfilePictureComplete = () => {
    console.log('Profile picture upload completed');
    setNeedsProfilePicture(false);
  };

  const handleProfilePictureSkip = () => {
    console.log('Profile picture upload skipped');
    setNeedsProfilePicture(false);
  };

  const handleOnboardingComplete = async () => {
    console.log('✅ Onboarding completed - reloading app state...');
    
    try {
      // Wait a bit for database to be fully updated
      await new Promise(resolve => setTimeout(resolve, 500));
      
    // Reload profile to get updated data
      const user = getCachedUser() ?? (await resolveAuthUser());
      if (user) {
        // FIX: Verwende maybeSingle() - Profil sollte existieren, aber sicherheitshalber
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('id, name, email, avatar_url, display_name, username, bio, dark_mode, theme_mode, onboarding_complete')
          .eq('id', user.id)
          .maybeSingle();
        
        if (profileError) {
          console.error('❌ Error reloading profile after onboarding:', profileError);
        } else if (profile) {
          console.log('✅ Profile reloaded after onboarding:', profile.name);
          syncThemeFromProfile(user.id, profile);
          
          // Check if onboarding is really complete
          if (profile.onboarding_complete) {
            console.log('✅ Onboarding confirmed complete, entering app...');
            setNeedsOnboarding(false);
            setIsAuthenticated(true);
            
            window.dispatchEvent(new CustomEvent('app-data-reload'));
            window.dispatchEvent(new CustomEvent('conversation-list-reload-requested'));
          } else {
            console.warn('⚠️ Onboarding not complete in database, staying in onboarding');
          }
        } else {
          console.warn('⚠️ Profile not found after onboarding');
          setNeedsOnboarding(false);
          setIsAuthenticated(true);
        }
      } else {
        console.error('❌ No user found after onboarding');
        setNeedsOnboarding(false);
      }
    } catch (error) {
      console.error('❌ Failed to reload profile after onboarding:', error);
      // Still exit onboarding even on error
      setNeedsOnboarding(false);
      setIsAuthenticated(true);
    }
  };

  const handleSignOut = () => {
    clearThemeCache();
    applyThemePreference(undefined);
    setIsAuthenticated(false);
    setNeedsProfilePicture(false);
    setActiveTab('messages');
  };

  // Keep theme in sync when auth session restores or user switches account
  useEffect(() => {
    let mounted = true;

    const syncThemeForSession = async (userId: string) => {
      const { data: profile } = await supabase
        .from('profiles')
        .select('dark_mode, theme_mode')
        .eq('id', userId)
        .maybeSingle();
      if (mounted) {
        syncThemeFromProfile(userId, profile);
      }
    };

    const unsubscribe = subscribeAuth((event, session) => {
      if (!mounted) return;
      if (event === 'TOKEN_REFRESHED') return;

      if (event === 'SIGNED_OUT') {
        clearThemeCache();
        applyThemePreference(undefined);
        invalidateConversationMembershipCache();
        return;
      }

      const userId = session?.user?.id;
      if (!userId) return;

      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
        const cachedTheme = readThemeCache();
        if (cachedTheme?.userId === userId) {
          applyThemeMode(cachedTheme.themeMode);
        }
        window.setTimeout(() => {
          if (!mounted) return;
          void syncThemeForSession(userId);
        }, 0);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  // Live message preview, unread badges, sounds, and toasts
  useMessageRealtime(isAuthenticated && currentUserId ? currentUserId : null);
  useTypingRealtime(isAuthenticated && currentUserId ? currentUserId : null);

  useEffect(() => {
    if (!isAuthenticated || !currentUserId) return;
    void syncSystemPushPreferenceToServiceWorker();
    void NotificationManager.syncPushSubscription(currentUserId);
  }, [isAuthenticated, currentUserId]);

  useEffect(() => {
    if (!isAuthenticated) return;

    NotificationManager.resetActiveConversationTracking();

    const unlockAudio = () => {
      NotificationManager.unlockAudio();
    };

    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
    window.addEventListener('touchstart', unlockAudio, { passive: true });

    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
  }, [isAuthenticated]);

  // Navigate to messages tab and open a conversation (toast click, accepted call, etc.)
  useEffect(() => {
    const openConversationInMessages = (conversationId: string) => {
      setActiveTab('messages');
      localStorage.setItem('openConversation', conversationId);
      window.dispatchEvent(
        new CustomEvent('open-conversation', {
          detail: { conversationId },
        })
      );
    };

    const handleToastConversationClick = (event: CustomEvent) => {
      const { conversationId } = event.detail;
      if (conversationId) {
        openConversationInMessages(conversationId);
      }
    };

    const handleNavigateToConversation = (event: CustomEvent) => {
      const { conversationId } = event.detail;
      if (conversationId) {
        openConversationInMessages(conversationId);
      }
    };

    const handleNotificationClick = (event: CustomEvent) => {
      const { conversationId } = event.detail ?? {};
      if (conversationId) {
        openConversationInMessages(conversationId);
      }
    };

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data?.type) return;

      if (data.type === 'play-notification-sound') {
        NotificationManager.playNotificationSound({
          conversationId: data.conversationId ? String(data.conversationId) : undefined,
          groupId: data.groupId ? String(data.groupId) : undefined,
        });
        return;
      }

      if (data.type === 'notification-click' && data.conversationId) {
        openConversationInMessages(String(data.conversationId));
      }
    };

    window.addEventListener('notification-click', handleNotificationClick as EventListener);
    window.addEventListener('toast-conversation-click', handleToastConversationClick as EventListener);
    window.addEventListener('navigate-to-conversation', handleNavigateToConversation as EventListener);
    navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage);

    return () => {
      window.removeEventListener('notification-click', handleNotificationClick as EventListener);
      window.removeEventListener('toast-conversation-click', handleToastConversationClick as EventListener);
      window.removeEventListener('navigate-to-conversation', handleNavigateToConversation as EventListener);
      navigator.serviceWorker?.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, []);

  if (loading) {
    return (
      <div className="h-screen bg-black flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  // Track previous tab for direction calculation
  // Note: We update previousTabRef AFTER the render, so we can use it for direction calculation

  // Animation variants for page transitions (Persistent Stack - no gaps)
  const pageVariants = {
    initial: (direction: number) => ({
      x: `${100 * direction}%`,
      opacity: 1, // Start with opacity 1 to prevent flash
      zIndex: 1,
    }),
    animate: {
      x: 0,
      opacity: 1,
      zIndex: 2,
    },
    exit: (direction: number) => ({
      x: `${-100 * direction}%`,
      opacity: 1, // Keep opacity 1 during exit to prevent flash
      zIndex: 1,
    }),
  };

  const pageTransition = {
    type: "spring",
    stiffness: 300,
    damping: 30,
    mass: 1, // Keine Bounces
    clamp: true // WICHTIG: Verhindert Overshoot
  };

  // Keep Alive Navigation: renderScreen() entfernt - alle Screens werden permanent gemountet

  return (
    <div
      className="fixed inset-0 flex flex-col blyve-app-bg"
      style={{
        paddingTop: '0px',
        paddingBottom: '0px',
        width: '100vw',
        height: '100dvh',
      }}
    >
      {!isAuthenticated ? (
        <ErrorBoundary
          resetOnPropsChange={true}
          onError={(error, errorInfo) => {
            console.error('🚨 AuthScreen Error:', error, errorInfo);
          }}
        >
          {callJoinParams ? (
            <div className="fixed top-0 inset-x-0 z-[160] bg-blyve/95 px-4 py-2 text-center text-sm text-white">
              {i18n.t('call.joinViaInviteLoginRequired')}
            </div>
          ) : null}
          <AuthScreen onAuthSuccess={handleAuthSuccess} />
        </ErrorBoundary>
      ) : needsOnboarding ? (
        <ErrorBoundary
          resetOnPropsChange={true}
          onError={(error, errorInfo) => {
            console.error('🚨 OnboardingWizard Error:', error, errorInfo);
          }}
        >
        <OnboardingWizard
          userEmail={onboardingUserData.email}
          userName={onboardingUserData.name}
          onComplete={handleOnboardingComplete}
        />
        </ErrorBoundary>
      ) : showCallJoin && callJoinParams ? (
        <CallJoinScreen
          params={callJoinParams}
          onDone={() => {
            setShowCallJoin(false);
            setCallJoinParams(null);
          }}
        />
      ) : (
        <>
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden blyve-app-bg shadow-none md:shadow-none w-full md:pb-16 box-border">
            {/* Virtual Slide Map - Alle Screens permanent gemountet, horizontal positioniert */}
            <div className="relative min-h-0 flex-1 w-full overflow-hidden blyve-app-bg">
              {(['messages', 'profile'] as const).map((tab, index) => {
                const tabs = ['messages', 'profile'] as const;
                const activeIndex = tabs.indexOf(activeTab);

                // Berechne x-Position basierend auf Index (index from .map is stable for this fixed tab list)
                let xTarget = '0%';
                if (index < activeIndex) xTarget = '-100%';
                if (index > activeIndex) xTarget = '100%';
                
                return (
                  <motion.div
                    key={tab}
                    initial={false} // Keine Animation beim ersten Laden
                    animate={{ x: xTarget }}
                    transition={{ 
                      type: "spring", 
                      stiffness: 600, 
                      damping: 60, 
                      mass: 0.5,
                      restDelta: 0.01 // Stoppt Animation früher für smooth "Einrasten"
                    }}
                    className="absolute inset-0 w-full h-full blyve-app-bg"
                    style={{
                      zIndex: tab === activeTab ? 10 : 0,
                      backfaceVisibility: 'hidden',
                      willChange: 'transform',
                    }}
                  >
                    {tab === 'messages' && (
                      <ErrorBoundary
                        resetKeys={['messages']}
                        onError={(error, errorInfo) => {
                          console.error('🚨 MessagesScreen Error:', error, errorInfo);
                        }}
                        fallback={
                          <div className="h-full flex items-center justify-center p-4">
                            <div className="text-center">
                              <p className="text-gray-600 dark:text-gray-300 mb-4">
                                {i18n.t('errors.loadMessages')}
                              </p>
                              <button
                                onClick={() => window.location.reload()}
                                className="px-4 py-2 bg-blyve text-white rounded-lg"
                              >
                                {i18n.t('errors.reloadPage')}
                              </button>
                            </div>
                          </div>
                        }
                      >
                        <MessagesScreen isTabActive={activeTab === 'messages'} />
                      </ErrorBoundary>
                    )}
                    
                    {tab === 'profile' && (
                      <ErrorBoundary
                        resetKeys={['profile', profileScreenKey]}
                        onError={(error, errorInfo) => {
                          console.error('🚨 ProfileScreen Error:', error, errorInfo);
                        }}
                        fallback={
                          <div className="h-full flex items-center justify-center p-4">
                            <div className="text-center">
                              <p className="text-gray-600 dark:text-gray-300 mb-4">
                                {i18n.t('errors.loadProfile')}
                              </p>
                              <button
                                onClick={() => window.location.reload()}
                                className="px-4 py-2 bg-blyve text-white rounded-lg"
                              >
                                {i18n.t('errors.reloadPage')}
                              </button>
                            </div>
                          </div>
                        }
                      >
                        <BlyveProfileScreen
                          key={profileScreenKey}
                          isActive={activeTab === 'profile'}
                          onCloseSubScreens={closeProfileSubScreensRef}
                          onSignOut={handleSignOut}
                          onEditProfile={() => {
                            // Edit profile will be handled within BlyveProfileScreen
                          }}
                        />
                      </ErrorBoundary>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </div>
          {showBottomNavigation ? (
            <BottomNavigation
              activeTab={activeTab}
              onTabChange={(tab) => {
                if (tab === 'profile' && activeTab === 'profile') {
                  if (closeProfileSubScreensRef.current) {
                    closeProfileSubScreensRef.current();
                  }
                  return;
                }
                setActiveTab(tab);
              }}
            />
          ) : null}
        </>
      )}

      {showLegalDocs && (
        <div className="fixed inset-0 z-50 overflow-y-auto blyve-app-bg">
          <div className="p-4 max-w-4xl mx-auto">
            <button
              onClick={() => {
                setShowLegalDocs(false);
                const params = new URLSearchParams(window.location.search);
                params.delete('legal');
                window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
              }}
              className="mb-4 px-4 py-2 bg-gray-200 dark:bg-slate-800 rounded-full"
            >
              {i18n.t('onboarding.back')}
            </button>
          </div>
          <LegalDocs />
        </div>
      )}

      <Toaster />
      
      {/* Notification Permission Prompt */}
      {isAuthenticated && <NotificationPrompt userId={currentUserId} />}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        // Log error for debugging
        console.error('🚨 Global Error Boundary: Unhandled error:', error, errorInfo);
        // TODO: Hier könnte später Sentry oder ein anderer Error Tracking Service integriert werden
      }}
    >
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AppDataProvider>
          <CallProvider>
            <UnreadProviderWrapper>
              <AppContent />
            </UnreadProviderWrapper>
          </CallProvider>
        </AppDataProvider>
      </ToastProvider>
    </QueryClientProvider>
    </ErrorBoundary>
  );
}

// Wrapper component to manage userId state for UnreadProvider
function UnreadProviderWrapper({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  
  // Listen for userId changes from AppContent
  useEffect(() => {
    const handleUserIdChange = (event: CustomEvent) => {
      setUserId(event.detail.userId);
    };
    
    window.addEventListener('user-id-change', handleUserIdChange as EventListener);
    return () => {
      window.removeEventListener('user-id-change', handleUserIdChange as EventListener);
    };
  }, []);
  
  return (
    <UnreadProvider currentUserId={userId}>
      {children}
    </UnreadProvider>
  );
}
