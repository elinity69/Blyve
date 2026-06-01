import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AnimatePresence } from 'framer-motion';
import { Settings, Edit2, Camera } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useProfile } from '../hooks/useProfile';
import { MobileNavStack, type MobileNavStackApi } from './MobileNavStack';
import { SettingsScreen } from './SettingsScreen';
import { EditProfileScreen } from './EditProfileScreen';
import { MediaEditScreen } from './MediaEditScreen';
import { getOptimizedImageUrl } from '../lib/images';
import { supabase } from '../lib/supabase';
import { getCachedUser, resolveAuthUser } from '../lib/authSession';
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
  
  // Load profile
  const loadProfile = async () => {
    try {
      const user = getCachedUser() ?? (await resolveAuthUser());
      if (!user) {
      setLoading(false);
        return;
      }

      const { data: supabaseProfile, error } = await supabase
        .from('profiles')
        .select('id, name, email, avatar_url, display_name, username, bio, images')
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

  const mobileNavApiRef = useRef<MobileNavStackApi | null>(null);
  const [profilePreview, setProfilePreview] = useState<React.ReactNode>(<div />);

  const pushScreen = React.useCallback((content: React.ReactNode, id?: string) => {
    mobileNavApiRef.current?.pushScreen(content, id);
  }, []);

  const popScreen = React.useCallback(() => {
    mobileNavApiRef.current?.popScreen();
  }, []);

  const clearStack = React.useCallback(() => {
    mobileNavApiRef.current?.clearStack();
  }, []);

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
        <div className="relative w-full bg-gradient-to-br from-blyve/10 via-blyve/5 to-blyve/10 dark:from-[#0A0A0A] dark:via-[#0A0A0A] dark:to-[#0A0A0A] dark:border dark:border-white/5 pb-2 border-b border-blyve/20 dark:border-white/5">
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
                  className="w-28 h-28 rounded-full bg-blyve flex items-center justify-center text-white text-3xl font-bold shadow-2xl border-4 border-white dark:border-slate-700"
                >
                  {profile?.name?.charAt(0).toUpperCase() || '?'}
                </div>
              )}
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mt-4 mb-1">
              {profile?.name || 'Unknown'}{profile?.age ? `, ${profile.age}` : ''}
            </h1>
            <div className="flex items-center gap-4 mt-2">
              <button
                onClick={() => {
                  pushScreen(
                    <SettingsScreen
                      onBack={popScreen}
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
                <div className="w-12 h-12 rounded-full bg-blyve flex items-center justify-center shadow-lg">
                  <Settings className="w-6 h-6 text-white" />
                </div>
                <span className="text-xs font-medium text-gray-900 dark:text-white">{t('profile.settings')}</span>
              </button>
              <button
                onClick={() => {
                  pushScreen(
                    <EditProfileScreen
                      onBack={popScreen}
                      onSave={() => {
                        loadProfile();
                        popScreen();
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
                <div className="w-12 h-12 rounded-full bg-blyve flex items-center justify-center shadow-lg">
                  <Edit2 className="w-6 h-6 text-white" />
                </div>
                <span className="text-xs font-medium text-gray-900 dark:text-white">{t('profile.edit')}</span>
              </button>
              <button
                onClick={() => {
                  pushScreen(
                    <MediaEditScreen
                      profile={profile}
                      onBack={() => {
                        loadProfile();
                        popScreen();
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
                <div className="w-12 h-12 rounded-full bg-blyve flex items-center justify-center shadow-lg">
                  <Camera className="w-6 h-6 text-white" />
                </div>
                <span className="text-xs font-medium text-gray-900 dark:text-white">{t('profile.addMedia')}</span>
              </button>
            </div>
          </div>
        </div>

      </div>
    );
  }, [profile, loading, cachedProfile, t, onSignOut, loadProfile]);
  // Note: pushScreen and popScreen are accessed via refs to avoid dependency issues

  // ✅ Update baseContent when ProfileContent changes (only when dependencies actually change)
  const prevDepsRef = useRef<string>('');
  useEffect(() => {
    // Create a stable key from dependencies to avoid unnecessary updates
    const depsKey = JSON.stringify({
      profileId: profile?.id,
      loading,
    });
    
    if (prevDepsRef.current !== depsKey) {
      prevDepsRef.current = depsKey;
      setProfilePreview(ProfileContent);
    }
  }, [ProfileContent, profile?.id, loading]);

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
          <div className="w-16 h-16 border-4 border-transparent border-t-blyve border-r-blyve/70 border-b-blyve/50 border-l-blyve dark:border-t-blyve dark:border-r-blyve/70 dark:border-b-blyve/50 dark:border-l-blyve rounded-full animate-spin mx-auto mb-4"></div>
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

  return (
    <MobileNavStack preview={profilePreview} apiRef={mobileNavApiRef} />
  );
}
