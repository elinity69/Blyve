import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Settings, Edit2, Camera } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProfile } from '../hooks/useProfile';
import { useEdgeBackNavigation } from '../hooks/useEdgeBackNavigation';
import { SettingsScreen } from './SettingsScreen';
import { EditProfileScreen } from './EditProfileScreen';
import { MediaEditScreen } from './MediaEditScreen';
import { getOptimizedImageUrl } from '../lib/images';
import { supabase } from '../lib/supabase';
interface BlyveProfileScreenProps {
  onSignOut: () => void;
  onEditProfile: () => void;
  isActive?: boolean;
  onCloseSubScreens?: React.MutableRefObject<(() => void) | null>;
}

// ProfileUI wird jetzt als useMemo im Hauptkomponenten erstellt
// ProfileUI wird jetzt als useMemo im Hauptkomponenten erstellt
// --- MAIN COMPONENT ---
export function BlyveProfileScreen({
  onSignOut,
  onEditProfile,
  isActive = true,
  onCloseSubScreens,
}: BlyveProfileScreenProps) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { data: cachedProfile } = useProfile();
  
  const [profileProgress, setProfileProgress] = useState(0);

  // Calculate profile progress
  useEffect(() => {
    if (profile) {
      let progress = 0;
      if (profile.name) progress += 25;
      if (profile.imageUrl || (profile.images && profile.images.length > 0)) progress += 35;
      if (profile.bio) progress += 25;
      if (profile.username) progress += 15;
      setProfileProgress(Math.min(progress, 100));
    }
  }, [profile]);

  // Load profile
  const loadProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
      setLoading(false);
        return;
      }

      const { data: supabaseProfile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      if (supabaseProfile) {
        const mappedProfile = {
          ...supabaseProfile,
          imageUrl: supabaseProfile.avatar_url,
          name: supabaseProfile.name,
          email: supabaseProfile.email,
        };
        setProfile(mappedProfile);
      }
    } catch (error) {
      console.error('Failed to load profile:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // STALE-WHILE-REVALIDATE: Use cached profile immediately if available
    if (cachedProfile) {
      setProfile(cachedProfile);
      setLoading(false);
      loadProfile().catch(err => {
        console.warn('Background profile refresh failed (non-critical):', err);
      });
        } else {
      loadProfile();
    }
    
  }, [cachedProfile]);

  useEffect(() => {
    if (cachedProfile && !profile) {
      setProfile(cachedProfile);
        setLoading(false);
    } else if (cachedProfile && profile) {
      setLoading(false);
    }
  }, [cachedProfile, profile]);

  // Stack navigation (edge back on mobile)
  const [baseContent, setBaseContent] = useState<React.ReactNode>(<div />);
  
  const { pushScreen, popScreen, clearStack, renderLayers } = useEdgeBackNavigation({
    baseContent,
  });

  // ✅ Store pushScreen/popScreen in refs to avoid dependency issues
  const pushScreenRef = useRef(pushScreen);
  const popScreenRef = useRef(popScreen);
  
  useEffect(() => {
    pushScreenRef.current = pushScreen;
    popScreenRef.current = popScreen;
  }, [pushScreen, popScreen]);

  // ✅ Layer A: Profile Content (useMemo for optimization)
  const ProfileContent = useMemo(() => {
    if (loading && !profile && !cachedProfile) {
      return null; // Loading handled by parent
    }

    return (
      <div 
        className="fixed inset-0 bg-white dark:bg-black md:dark:bg-[#121212] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]" 
        style={{ 
          paddingBottom: '80px',
          zIndex: 0,
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          margin: 0,
          pointerEvents: 'auto',
        }}
      >
        {/* Profile Picture Section */}
        <div className="relative w-full bg-gradient-to-br from-orange-50 via-pink-50 to-red-50 dark:from-[#0A0A0A] dark:via-[#0A0A0A] dark:to-[#0A0A0A] dark:border dark:border-white/5 pb-2 border-b border-orange-100 dark:border-white/5">
          <div className="flex flex-col items-center pt-4 pb-1">
            <div className="relative">
              {profile?.imageUrl || (profile?.images && profile.images.length > 0) ? (
                <img
                  src={getOptimizedImageUrl(profile.imageUrl || profile.images[0], 600)}
                  alt={profile.name}
                  className="w-28 h-28 rounded-full object-cover border-4 shadow-2xl border-white dark:border-white/5"
                />
              ) : (
                <div
                  className="w-28 h-28 rounded-full bg-gradient-to-br from-orange-400 via-pink-400 to-red-400 flex items-center justify-center text-white text-3xl font-bold shadow-2xl border-4 border-white dark:border-slate-700"
                >
                  {profile?.name?.charAt(0).toUpperCase() || '?'}
                </div>
              )}
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-orange-500 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg whitespace-nowrap">
                {t('profile.complete', { percent: profileProgress })}
              </div>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-4 mb-1">
              {profile?.name || 'Unknown'}{profile?.age ? `, ${profile.age}` : ''}
            </h1>
            <div className="flex items-center gap-4 mt-2">
              <button
                onClick={() => {
                  pushScreenRef.current(
                    <SettingsScreen
                      onBack={popScreenRef.current}
                      onSignOut={onSignOut}
                    />,
                    'settings'
                  );
                }}
                className="flex flex-col items-center gap-1.5 p-3 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full transition-colors"
                style={{
                  touchAction: 'manipulation',
                  WebkitTapHighlightColor: 'transparent',
                  cursor: 'pointer'
                }}
              >
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-500 via-red-500 to-pink-500 flex items-center justify-center shadow-lg">
                  <Settings className="w-6 h-6 text-white" />
                </div>
                <span className="text-xs font-medium text-gray-900 dark:text-white">{t('profile.settings')}</span>
              </button>
              <button
                onClick={() => {
                  pushScreenRef.current(
                    <EditProfileScreen
                      onBack={popScreenRef.current}
                      onSave={() => {
                        loadProfile();
                        popScreenRef.current();
                      }}
                    />,
                    'edit-profile'
                  );
                }}
                className="flex flex-col items-center gap-1.5 p-3 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full transition-colors relative"
                style={{
                  touchAction: 'manipulation',
                  WebkitTapHighlightColor: 'transparent',
                  cursor: 'pointer'
                }}
              >
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-500 via-red-500 to-pink-500 flex items-center justify-center shadow-lg">
                  <Edit2 className="w-6 h-6 text-white" />
                </div>
                <span className="text-xs font-medium text-gray-900 dark:text-white">{t('profile.edit')}</span>
                {profileProgress < 100 && (
                  <div className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full border-2 border-white dark:border-[#0A0A0A]"></div>
                )}
              </button>
              <button
                onClick={() => {
                  pushScreenRef.current(
                    <MediaEditScreen
                      profile={profile}
                      onBack={() => {
                        loadProfile();
                        popScreenRef.current();
                      }}
                    />,
                    'add-media'
                  );
                }}
                className="flex flex-col items-center gap-1.5 p-3 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full transition-colors"
                style={{
                  touchAction: 'manipulation',
                  WebkitTapHighlightColor: 'transparent',
                  cursor: 'pointer'
                }}
              >
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-orange-500 via-red-500 to-pink-500 flex items-center justify-center shadow-lg">
                  <Camera className="w-6 h-6 text-white" />
                </div>
                <span className="text-xs font-medium text-gray-900 dark:text-white">{t('profile.addMedia')}</span>
              </button>
            </div>
          </div>
        </div>

      </div>
    );
  }, [profile, loading, cachedProfile, profileProgress, t, onSignOut, loadProfile]);
  // Note: pushScreen and popScreen are accessed via refs to avoid dependency issues

  // ✅ Update baseContent when ProfileContent changes (only when dependencies actually change)
  const prevDepsRef = useRef<string>('');
  useEffect(() => {
    // Create a stable key from dependencies to avoid unnecessary updates
    const depsKey = JSON.stringify({
      profileId: profile?.id,
      loading,
      profileProgress,
    });
    
    if (prevDepsRef.current !== depsKey) {
      prevDepsRef.current = depsKey;
      setBaseContent(ProfileContent);
    }
  }, [ProfileContent, profile?.id, loading, profileProgress]);

  // ✅ Clear stack when tab becomes inactive
  useEffect(() => {
    if (!isActive) {
      clearStack();
    }
  }, [isActive, clearStack]);

  // ✅ Expose clearStack to parent
  useEffect(() => {
    if (onCloseSubScreens) {
      onCloseSubScreens.current = clearStack;
    }
  }, [clearStack, onCloseSubScreens]);

  // Only show loading if we don't have profile data yet
  if (loading && !profile && !cachedProfile) {
    return (
      <div className="h-full flex items-center justify-center bg-white dark:bg-black md:dark:bg-[#121212]">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-transparent border-t-orange-600 border-r-red-600 border-b-pink-600 border-l-orange-600 dark:border-t-orange-400 dark:border-r-red-400 dark:border-b-pink-400 dark:border-l-orange-400 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-300">Profile</p>
        </div>
      </div>
    );
  }

  // ✅ CRITICAL: Only render Profile Screen when tab is active
  // This prevents the Profile Screen from overlaying other tabs
  if (!isActive) {
    return null;
  }

  // ✅ Render both layers using the navigation hook
  return renderLayers();
  }
