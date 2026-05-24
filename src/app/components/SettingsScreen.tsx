import { Settings, LogOut, AlertCircle, Eye, Globe, ChevronLeft, Moon, Sun } from 'lucide-react';
import { Button } from './ui/button';
import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { getOptimizedImageUrl } from '../lib/images';
import { toast } from '../lib/toast';
import { useTranslation } from 'react-i18next';
// NavigationStack is handled by parent - no need to import
import { NotificationManager } from '../lib/notifications';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';

interface SettingsScreenProps {
  onSignOut: () => void;
  onBack?: () => void;
  previousScreen?: React.ReactNode; // Optional: Previous screen for parallax effect
}

export function SettingsScreen({ onSignOut, onBack, previousScreen }: SettingsScreenProps) {
  const { t, i18n } = useTranslation();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [ghostMode, setGhostMode] = useState(false);
  const [updatingGhostMode, setUpdatingGhostMode] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [updatingDarkMode, setUpdatingDarkMode] = useState(false);

  // Track Dark Mode
  useEffect(() => {
    const checkDarkMode = () => {
      setDarkMode(document.documentElement.classList.contains('dark'));
    };
    
    checkDarkMode();
    
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    
    return () => observer.disconnect();
  }, []);

  const fetchProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }

      // 1. Hole Profil direkt aus der DB
      const { data: profileData, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (profileData) {
        // Map Supabase data to expected format
        const mappedProfile = {
          ...profileData,
          imageUrl: profileData.avatar_url,
          name: profileData.name,
          email: profileData.email,
          createdAt: profileData.created_at
        };
        setProfile(mappedProfile);
        setGhostMode(profileData.ghost_mode || false);
        setDarkMode(profileData.dark_mode || false);
        
      }
    } catch (e) {
      console.error("Error fetching profile:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const handleSignOut = () => {
    api.signout();
    onSignOut();
  };

  const handleDeleteAccount = async () => {
    if (deletingAccount) return;
    const confirmed = window.confirm(
      'Bist du sicher? Dieser Vorgang löscht dein Konto unwiderruflich.'
    );
    if (!confirmed) return;

    setDeletingAccount(true);
    try {
      await api.deleteAccount();
      await supabase.auth.signOut();
      onSignOut();
    } catch (error: any) {
      console.error('Failed to delete account:', error);
      toast.error('Fehler', error.message || 'Failed to delete account. Please try again.');
    } finally {
      setDeletingAccount(false);
    }
  };

  const handleToggleGhostMode = async () => {
    setUpdatingGhostMode(true);
    try {
      const newGhostMode = !ghostMode;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      
      if (!user) {
        throw new Error('Nicht eingeloggt');
      }

      // Update directly in Supabase
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ ghost_mode: newGhostMode })
        .eq('id', user.id);

      if (updateError) throw updateError;

      setGhostMode(newGhostMode);
      setProfile({ ...profile, ghostMode: newGhostMode, ghost_mode: newGhostMode });
    } catch (error: any) {
      console.error('Failed to update ghost mode:', error);
      toast.error('Fehler', error.message || 'Fehler beim Aktualisieren des Ghost Mode. Bitte versuche es erneut.');
    } finally {
      setUpdatingGhostMode(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-gray-600 dark:text-gray-400">Loading settings...</p>
      </div>
    );
  }

  const currentLocale = i18n.language?.startsWith('de')
    ? 'de-DE'
    : i18n.language?.startsWith('es')
      ? 'es-ES'
      : 'en-US';
  const memberSinceIso = profile?.member_since || profile?.created_at || profile?.createdAt;
  const memberSinceDate = memberSinceIso ? new Date(memberSinceIso) : null;
  const hasValidMemberSince = Boolean(memberSinceDate && !Number.isNaN(memberSinceDate.getTime()));
  const memberSinceLabel = hasValidMemberSince
    ? t('profile.memberSince', {
        date: memberSinceDate!.toLocaleDateString(currentLocale, {
          year: 'numeric',
          month: 'short',
        }),
      })
    : null;

  const content = (
    <div className="h-full overflow-y-auto pb-20 bg-white dark:bg-black md:dark:bg-[#121212]">
      {/* Header */}
      <div className="sticky top-0 bg-white/80 dark:bg-black/80 md:dark:bg-[#121212]/80 backdrop-blur-md border-b border-gray-200 dark:border-white/5 p-4 z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {onBack && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onBack();
                  }}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-white/10 rounded-full transition-colors relative z-50"
                >
                  <ChevronLeft className="w-6 h-6 text-gray-700 dark:text-white" />
                </button>
              )}
              <Settings className="w-6 h-6 text-orange-600" />
              <h1 className="text-2xl font-bold">{t('settings.title')}</h1>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSignOut}
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <LogOut className="w-4 h-4 mr-2" />
                {t('settings.signOut')}
              </Button>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-8">
          {/* Profile Info with Picture - Read-only Preview */}
          {profile && (
            <div>
              <h2 className="font-bold mb-4">{t('settings.profile')}</h2>
              <div className="bg-orange-50 dark:bg-[#0A0A0A] md:dark:bg-[#0A0A0A] border border-orange-200 dark:border-white/5 rounded-2xl p-4">
                <div className="flex items-start gap-4 mb-4">
                  {/* Profile Picture - Read-only */}
                  <div className="relative flex-shrink-0">
                    {profile.imageUrl || (profile.images && profile.images.length > 0 && profile.images[0]) ? (
                      <img
                        src={getOptimizedImageUrl(profile.imageUrl || (profile.images && profile.images[0]), 100)}
                        alt={profile.name}
                        className="w-20 h-20 rounded-full object-cover border-3 border-white shadow-lg"
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-full bg-orange-500 flex items-center justify-center text-white text-2xl font-bold">
                        {profile.name?.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>

                  {/* Profile Info */}
                  <div className="flex-1">
                    <h3 className="font-bold mb-1">{profile.name}</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{profile.email || 'No email'}</p>
                    {profile.bio && (
                      <p className="text-xs text-gray-700 mb-1 italic line-clamp-2">"{profile.bio}"</p>
                    )}
                    {memberSinceLabel && (
                      <p className="text-xs text-gray-500">{memberSinceLabel}</p>
                    )}
                  </div>
                </div>

                {/* Info Text */}
                <div className="bg-blue-50 dark:bg-[#0A0A0A] md:dark:bg-[#0A0A0A] border-2 border-blue-200 dark:border-white/5 rounded-xl p-3 text-center">
                  <p className="text-xs text-blue-800 dark:text-blue-200">
                    💡 <strong>{t('profile.note')}</strong> {t('profile.changeMainImage')}
                  </p>
                  </div>
              </div>
            </div>
          )}

          {/* Dark Mode Toggle */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              {darkMode ? <Moon className="w-5 h-5 text-orange-600" /> : <Sun className="w-5 h-5 text-orange-600" />}
              <h2 className="font-bold text-gray-900 dark:text-white">{t('settings.darkMode')}</h2>
            </div>
            <div className="bg-orange-50 dark:bg-[#0A0A0A] md:dark:bg-[#0A0A0A] border border-orange-200 dark:border-white/5 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold mb-1 text-gray-900 dark:text-white">{t('settings.darkMode')}</h3>
                  <p className="text-xs text-gray-600 dark:text-gray-300">
                    {t('settings.themeSubtitle')}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    const newDarkMode = !darkMode;
                    setUpdatingDarkMode(true);
                    try {
                      const { data: { user } } = await supabase.auth.getUser();
                      if (!user) throw new Error('User not authenticated');
                      const { error } = await supabase
                        .from('profiles')
                        .update({ dark_mode: newDarkMode })
                        .eq('id', user.id);
                      if (error) throw error;
                      setDarkMode(newDarkMode);
                      if (newDarkMode) {
                        document.documentElement.classList.add('dark');
                      } else {
                        document.documentElement.classList.remove('dark');
                      }
                    } catch (error: any) {
                      console.error('Failed to update dark mode:', error);
                      toast.error('Fehler', error.message || 'Failed to update dark mode.');
                    } finally {
                      setUpdatingDarkMode(false);
                    }
                  }}
                  disabled={updatingDarkMode}
                  className={`relative w-14 h-7 rounded-full transition-colors flex-shrink-0 ${
                    darkMode ? 'bg-orange-600' : 'bg-gray-300'
                  }`}
                >
                  <div
                    className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full transition-transform ${
                      darkMode ? 'translate-x-7' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Ghost mode (reduced visibility / privacy) */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Eye className="w-5 h-5 text-orange-600" />
              <h2 className="font-bold text-gray-900 dark:text-white">{t('settings.ghostMode')}</h2>
            </div>
            <div className="bg-orange-50 dark:bg-[#0A0A0A] md:dark:bg-[#0A0A0A] border border-orange-200 dark:border-white/5 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold mb-1 text-gray-900 dark:text-white">{t('profile.ghostMode')}</h3>
                  <p className="text-xs text-gray-600 dark:text-gray-300">{t('profile.ghostModeDesc')}</p>
                </div>
                <button
                  type="button"
                  onClick={handleToggleGhostMode}
                  disabled={updatingGhostMode}
                  className={`relative w-14 h-7 rounded-full transition-colors flex-shrink-0 ${
                    ghostMode ? 'bg-orange-600' : 'bg-gray-300'
                  }`}
                >
                  <div
                    className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full transition-transform ${
                      ghostMode ? 'translate-x-7' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Language Selection - EXACT COPY OF GENDER PREFERENCE STYLE */}
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Globe className="w-5 h-5 text-orange-600" />
              <h2 className="font-bold text-gray-900 dark:text-white">{t('settings.language')}</h2>
            </div>
            {/* Language Selection */}
            <div className="bg-orange-50 dark:bg-[#0A0A0A] md:dark:bg-[#0A0A0A] border border-orange-200 dark:border-white/5 rounded-2xl p-4">
              <div className="mb-3">
                <h3 className="font-semibold mb-1 text-gray-900 dark:text-white">{t('settings.language')}</h3>
                <p className="text-xs text-gray-600 dark:text-gray-300">
                  {t('profile.selectLanguage')}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => i18n.changeLanguage('de')}
                  className="px-4 py-2 rounded-full text-sm font-semibold transition-colors"
                  style={(() => {
                    const isDark = document.documentElement.classList.contains('dark');
                    if (i18n.language === 'de' || i18n.language === 'de-DE') {
                      return { color: '#ffffff', backgroundColor: '#ea580c' };
                    }
                    if (isDark) {
                      return { 
                        color: '#ffffff', 
                        backgroundColor: '#1e293b',
                        WebkitTextFillColor: '#ffffff',
                        WebkitTextStrokeColor: '#ffffff'
                      };
                    }
                    return { color: '#374151', backgroundColor: 'rgba(255, 255, 255, 0.8)' };
                  })()}
                >
                  🇩🇪 Deutsch
                </button>
                <button
                  onClick={() => i18n.changeLanguage('en')}
                  className="px-4 py-2 rounded-full text-sm font-semibold transition-colors"
                  style={(() => {
                    const isDark = document.documentElement.classList.contains('dark');
                    if (i18n.language === 'en' || i18n.language === 'en-US') {
                      return { color: '#ffffff', backgroundColor: '#ea580c' };
                    }
                    if (isDark) {
                      return { 
                        color: '#ffffff', 
                        backgroundColor: '#1e293b',
                        WebkitTextFillColor: '#ffffff',
                        WebkitTextStrokeColor: '#ffffff'
                      };
                    }
                    return { color: '#374151', backgroundColor: 'rgba(255, 255, 255, 0.8)' };
                  })()}
                >
                  🇺🇸 English
                </button>
                <button
                  onClick={() => i18n.changeLanguage('es')}
                  className="px-4 py-2 rounded-full text-sm font-semibold transition-colors"
                  style={(() => {
                    const isDark = document.documentElement.classList.contains('dark');
                    if (i18n.language === 'es' || i18n.language === 'es-ES') {
                      return { color: '#ffffff', backgroundColor: '#ea580c' };
                    }
                    if (isDark) {
                      return { 
                        color: '#ffffff', 
                        backgroundColor: '#1e293b',
                        WebkitTextFillColor: '#ffffff',
                        WebkitTextStrokeColor: '#ffffff'
                      };
                    }
                    return { color: '#374151', backgroundColor: 'rgba(255, 255, 255, 0.8)' };
                  })()}
                >
                  🇪🇸 Español
                </button>
              </div>
            </div>
          </div>


          {/* Delete Account Section */}
          <div className="bg-red-50 dark:bg-[#0A0A0A] md:dark:bg-[#0A0A0A] border border-red-200 dark:border-red-900/30 rounded-2xl p-4">
            <div className="mb-3">
              <h3 className="font-bold text-red-900 dark:text-red-400 mb-2">{t('settings.deleteAccount')}</h3>
              <p className="text-sm text-red-700 dark:text-red-300 mb-4">
                {t('settings.deleteAccountDesc')}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeleteAccount}
                disabled={deletingAccount}
                className="border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                <AlertCircle className="w-4 h-4 mr-2" />
                {deletingAccount ? t('profile.loading') : t('settings.deleteAccount')}
              </Button>
            </div>
          </div>

          {/* Impressum & Rechtliches */}
          <div className="bg-white dark:bg-[#0A0A0A] md:dark:bg-[#0A0A0A] border border-gray-200 dark:border-white/10 rounded-2xl p-4">
            <button
              onClick={() => {
                window.location.href = '/?legal=1';
              }}
            className="text-sm font-medium text-gray-900 dark:text-white hover:text-gray-700 dark:hover:text-gray-200 underline transition-colors"
            >
              {t('profile.legal')}
            </button>
          </div>

          {/* Feedback / Bug melden */}
          <div className="bg-white dark:bg-[#0A0A0A] md:dark:bg-[#0A0A0A] border border-gray-200 dark:border-white/10 rounded-2xl p-4">
            <button
              onClick={() => {
                window.location.href = 'mailto:support@blyve.com?subject=Blyve%20Feedback';
              }}
            className="text-sm font-medium text-gray-900 dark:text-white hover:text-gray-700 dark:hover:text-gray-200 underline transition-colors"
            >
              {t('profile.feedback')}
            </button>
          </div>
        </div>
      </div>
  );

  if (onBack) {
    return <div className="h-full">{content}</div>;
  }

  return <>{content}</>;
}