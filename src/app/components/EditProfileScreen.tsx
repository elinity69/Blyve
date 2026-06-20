import { useState, useEffect, useRef } from 'react';
import {
  normalizeUsernameInput,
  validateUsernameFormat,
  isUsernameAvailable,
} from '../lib/username';
import { User, UtensilsCrossed, ChevronLeft, Save } from 'lucide-react';
import { Button } from './ui/button';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { getCachedUser, resolveAuthUser } from '../lib/authSession';
import { toast } from '../lib/toast';
import { useTranslation } from 'react-i18next';
// NavigationStack is handled by parent - no need to import

interface EditProfileScreenProps {
  onBack: () => void;
  onSave?: () => void;
  previousScreen?: React.ReactNode; // Optional: Previous screen for parallax effect
}

export function EditProfileScreen({ onBack, onSave, previousScreen }: EditProfileScreenProps) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [originalImages, setOriginalImages] = useState<string[]>([]); // Track original images for cleanup

  // Form fields
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const [bio, setBio] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [favoriteFood, setFavoriteFood] = useState('');
  const [gender, setGender] = useState('');

  // Ref to prevent multiple simultaneous loads
  const isLoadingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    // Reset loading state and load profile on mount
    mountedRef.current = true;
    isLoadingRef.current = false;
    setLoading(true);
    loadProfile();
    
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadProfile = async () => {
    // Prevent multiple simultaneous loads
    if (isLoadingRef.current || !mountedRef.current) {
      console.log('⚠️ EditProfileScreen: Already loading or unmounted, skipping...');
      return;
    }

    isLoadingRef.current = true;
    try {
      console.log('EditProfileScreen - Loading profile...');
      // Load directly from Supabase (more reliable than API)
      const user = getCachedUser() ?? (await resolveAuthUser());
      if (!user) {
        console.warn('⚠️ EditProfileScreen: No authenticated user');
        if (mountedRef.current) {
          setLoading(false);
        }
        isLoadingRef.current = false;
        return;
      }
      
      if (!mountedRef.current) {
        console.log('⚠️ EditProfileScreen: Component unmounted, skipping profile load');
        isLoadingRef.current = false;
        return;
      }

      // Use maybeSingle() instead of single() to handle 406 errors gracefully
      const { data: supabaseProfile, error } = await supabase
        .from('profiles')
        .select('id, name, display_name, username, bio, avatar_url, images, pronouns, gender, favorite_food')
        .eq('id', user.id)
        .maybeSingle();

      if (error) {
        console.error('Error loading profile from Supabase:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        
        // If it's a 406 error (Not Acceptable), try with explicit headers
        if (error.code === 'PGRST116' || error.message?.includes('406')) {
          console.log('⚠️ Got 406 error, trying alternative query...');
          try {
            // Try with a simpler query
            const { data: altProfile, error: altError } = await supabase
              .from('profiles')
              .select('id, name, display_name, username, bio, avatar_url, images, pronouns, gender, favorite_food')
              .eq('id', user.id)
              .maybeSingle();
            
            if (!altError && altProfile) {
              console.log('✅ Alternative query succeeded');
              // Use the alternative profile data
              if (mountedRef.current) {
                const ap = altProfile as typeof altProfile & { imageUrl?: string; favoriteFood?: string };
                setProfile(ap);
                setName(ap.display_name || ap.name || '');
                setUsername(ap.username || '');
                setBio(ap.bio || '');
                setPronouns(ap.pronouns || '');
                setGender(ap.gender || '');
                setFavoriteFood(ap.favorite_food || ap.favoriteFood || '');
                
                const images = ap.images || [];
                setOriginalImages(images.filter((img: string) => img && typeof img === 'string' && img.trim().length > 0));
                
                if (ap.avatar_url) {
                  ap.imageUrl = ap.avatar_url;
                }
                setLoading(false);
                isLoadingRef.current = false;
                return;
              }
            }
          } catch (altErr) {
            console.error('Alternative query also failed:', altErr);
          }
        }
        
        // Don't throw - just show empty form
        if (mountedRef.current) {
          setLoading(false);
        }
        isLoadingRef.current = false;
        return;
      }

      if (!mountedRef.current) {
        isLoadingRef.current = false;
        return;
      }

      if (supabaseProfile) {
        setProfile(supabaseProfile);
        setName(supabaseProfile.display_name || supabaseProfile.name || '');
        setUsername(supabaseProfile.username || '');
        setBio(supabaseProfile.bio || '');
        setPronouns(supabaseProfile.pronouns || '');
        setGender(supabaseProfile.gender || '');
        setFavoriteFood(supabaseProfile.favorite_food || (supabaseProfile as any).favoriteFood || '');
        
        // Track original images for cleanup comparison
        const images = supabaseProfile.images || [];
        setOriginalImages(images.filter((img: string) => img && typeof img === 'string' && img.trim().length > 0));
        
        // Map avatar_url for display
        if (supabaseProfile.avatar_url) {
          (supabaseProfile as any).imageUrl = supabaseProfile.avatar_url;
        }
      } else {
        console.warn('⚠️ EditProfileScreen: No profile found for user');
      }
      
      // Always set loading to false, even if no profile found
      if (mountedRef.current) {
        setLoading(false);
      }
    } catch (error) {
      console.error('EditProfileScreen - Failed to load profile:', error);
      // Ensure loading is set to false even on error
      if (mountedRef.current) {
        setLoading(false);
      }
    } finally {
      isLoadingRef.current = false;
    }
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const u = normalizeUsernameInput(username);
      if (!u) {
        setUsernameStatus('idle');
        return;
      }
      if (u.length < 3) {
        setUsernameStatus('invalid');
        return;
      }
      const fmt = validateUsernameFormat(u);
      if (fmt !== null) {
        setUsernameStatus('invalid');
        return;
      }
      setUsernameStatus('checking');
      const user = getCachedUser() ?? (await resolveAuthUser());
      if (!user || cancelled) return;
      const avail = await isUsernameAvailable(supabase, u, user.id);
      if (!cancelled) setUsernameStatus(avail ? 'available' : 'taken');
    };
    const t = setTimeout(run, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [username]);

  // Helper function to extract file path from Supabase Storage URL
  const extractFilePathFromUrl = (url: string): string | null => {
    if (!url || typeof url !== 'string') return null;
    
    // Extract path from URL: https://...supabase.co/storage/v1/object/public/avatars/userId/timestamp.jpg
    const urlParts = url.split('/avatars/');
    if (urlParts.length > 1) {
      return urlParts[1];
    }
    
    // Also handle old bucket format just in case
    const oldBucketParts = url.split('/make-f25f69ec-profile-pics/');
    if (oldBucketParts.length > 1) {
      return oldBucketParts[1];
    }
    
    return null;
  };

  // Helper function to delete image from storage
  const deleteImageFromStorage = async (imageUrl: string): Promise<void> => {
    try {
      const filePath = extractFilePathFromUrl(imageUrl);
      if (!filePath) {
        console.warn('Could not extract file path from URL:', imageUrl);
        return;
      }

      const { error } = await supabase.storage
        .from('avatars')
        .remove([filePath]);
      
      if (error) {
        console.warn('Failed to delete image from storage:', error);
      } else {
        console.log('Successfully deleted image from storage:', filePath);
      }
    } catch (err) {
      console.warn('Error deleting image from storage:', err);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      console.log('Saving profile changes...');
      
      // Get current user
      const user = getCachedUser() ?? (await resolveAuthUser());
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Get current profile to check images
      const { data: currentProfile, error: profileError } = await supabase
        .from('profiles')
        .select('images')
        .eq('id', user.id)
        .single();

      if (profileError) {
        console.warn('Could not fetch current profile for image cleanup:', profileError);
      }

      // Get current images from DB
      const currentImages = (currentProfile?.images || []).filter(
        (img: string) => img && typeof img === 'string' && img.trim().length > 0
      );

      // Ensure max 9 images - trim if necessary
      let imagesToKeep = currentImages.slice(0, 9);
      const imagesToDelete = currentImages.slice(9);

      // Delete extra images from storage (if more than 9)
      if (imagesToDelete.length > 0) {
        console.log(`Found ${imagesToDelete.length} extra images, deleting from storage...`);
        await Promise.all(imagesToDelete.map((img: string) => deleteImageFromStorage(img)));
      }

      // Compare original images (from loadProfile) with current images to find removed ones
      const removedImages = originalImages.filter(
        (originalImg) => !currentImages.includes(originalImg)
      );

      // Delete removed images from storage
      if (removedImages.length > 0) {
        console.log(`Found ${removedImages.length} removed images, deleting from storage...`);
        await Promise.all(removedImages.map(img => deleteImageFromStorage(img)));
      }

      const u = normalizeUsernameInput(username);
      const usernameFmtErr = validateUsernameFormat(u);
      if (usernameFmtErr === 'SHORT') {
        toast.error(t('onboarding.usernameTitle'), t('onboarding.errorUsernameShort'));
        setSaving(false);
        return;
      }
      if (usernameFmtErr === 'INVALID') {
        toast.error(t('onboarding.usernameTitle'), t('onboarding.errorUsernameInvalid'));
        setSaving(false);
        return;
      }
      if (!(await isUsernameAvailable(supabase, u, user.id))) {
        toast.error(t('onboarding.usernameTitle'), t('onboarding.errorUsernameTaken'));
        setSaving(false);
        return;
      }

      // Build update data object - only include valid values
      const display = name.trim();
      const updateData: any = {
        name: display || null,
        display_name: display || null,
        username: u,
        bio: bio.trim() || null,
      };

      // Update images array if it was trimmed (ensure max 9)
      if (imagesToKeep.length !== currentImages.length) {
        updateData.images = imagesToKeep;
        // Sync avatar_url with images[0]
        updateData.avatar_url = imagesToKeep.length > 0 ? imagesToKeep[0] : null;
      }

      // Add optional fields only if they have valid values
      if (pronouns && pronouns.trim()) {
        updateData.pronouns = pronouns.trim();
      }

      if (gender && gender.trim()) {
        updateData.gender = gender.trim();
      }
      
      // Handle favorite_food - use snake_case for database column
      if (favoriteFood !== undefined && favoriteFood !== null && favoriteFood.trim()) {
        updateData.favorite_food = favoriteFood.trim();
      } else {
        // Explicitly set to null if empty
        updateData.favorite_food = null;
      }
      
      // (wird in Settings bearbeitet), daher nicht hier senden

      // CRITICAL: Filter out any protected fields that might accidentally be included
      // These fields can ONLY be updated via RPC functions, not direct updates
      const allowedFields = [
        'name', 'display_name', 'username', 'bio', 'images', 'avatar_url', 'pronouns', 'gender',
        'favorite_food',
      ];
      
      const filteredUpdateData: any = {};
      for (const key of allowedFields) {
        if (updateData.hasOwnProperty(key)) {
          filteredUpdateData[key] = updateData[key];
        }
      }

      console.log('Updating profile with filtered data:', Object.keys(filteredUpdateData));

      // Use real Supabase update instead of API/KV Store
      const { error: updateError } = await supabase
        .from('profiles')
        .update(filteredUpdateData)
        .eq('id', user.id);

      if (updateError) {
        console.error('Failed to update profile:', updateError);
        console.error('Error message:', updateError.message);
        console.error('Error details:', updateError.details);
        console.error('Error hint:', updateError.hint);
        console.error('Error code:', updateError.code);
        throw updateError;
      }

      // Update originalImages to reflect current state after save
      if (updateData.images) {
        setOriginalImages(updateData.images);
      }

      const deletedCount = imagesToDelete.length + removedImages.length;
      if (deletedCount > 0) {
        console.log(`Cleaned up ${deletedCount} images from storage`);
      }

      console.log('Profile saved successfully to Supabase');
      toast.success(t('profile.success'), t('profile.editProfileSaved'));
      
      if (onSave) onSave();
      // Don't automatically navigate back - let user stay on edit screen
    } catch (error: any) {
      console.error('Failed to save profile:', error);
      console.error('Error message:', error?.message);
      console.error('Error details:', error?.details);
      console.error('Error hint:', error?.hint);
      console.error('Error code:', error?.code);
      console.error('Full error object:', JSON.stringify(error, null, 2));
      toast.error(t('profile.error'), `${t('profile.failedToSaveProfile')}${error?.message ? ` ${error.message}` : ''}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-white dark:bg-black md:dark:bg-[#121212]">
        <p className="text-gray-600 dark:text-gray-300">Loading profile...</p>
      </div>
    );
  }

  // NavigationStack is handled by parent - just return content
  return (
    <div className="h-full overflow-y-auto pb-20 bg-white dark:bg-black md:dark:bg-[#121212]">
      {/* Header */}
      <div className="sticky top-0 bg-white/80 dark:bg-black/80 md:dark:bg-[#121212]/80 backdrop-blur-md border-b border-gray-200 dark:border-white/5 p-4 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onBack();
              }}
              className="p-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-full transition-colors relative z-50"
            >
              <ChevronLeft className="w-6 h-6 text-gray-700 dark:text-gray-300" />
            </button>
            <div className="flex items-center gap-2">
              <User className="w-6 h-6 text-blyve" />
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('profile.editProfile')}</h1>
            </div>
          </div>
          <Button
            onClick={handleSave}
            disabled={
              saving ||
              !name.trim() ||
              !normalizeUsernameInput(username) ||
              usernameStatus !== 'available'
            }
            className="bg-blyve hover:bg-blyve-hover text-white shadow-lg"
          >
            <Save className="w-4 h-4 mr-2" />
            {saving ? t('profile.loading') : t('profile.save')}
          </Button>
        </div>
      </div>

      {/* Header Background with Gradient */}
      <div className="bg-gradient-to-b from-blyve/10 to-white dark:from-[#0A0A0A] dark:to-black dark:border dark:border-white/5 pb-8 rounded-b-3xl">
        <div className="flex flex-col items-center pt-6 pb-4">
          {/* Profile Picture - Read-only Preview */}
          <div className="relative mb-4">
            {(profile?.imageUrl || profile?.avatar_url || (profile?.images && profile.images.length > 0 && profile.images[0])) ? (
              <img
                src={profile.imageUrl || profile.avatar_url || (profile.images && profile.images[0])}
                alt={profile.name || 'Profile'}
                className="w-32 h-32 rounded-full object-cover border-4 border-white shadow-xl"
                onError={(e) => {
                  // Fallback if image fails to load
                  e.currentTarget.style.display = 'none';
                }}
              />
            ) : (
              <div className="w-32 h-32 rounded-full bg-blyve flex items-center justify-center text-white text-4xl font-bold shadow-xl border-4 border-white">
                {name?.charAt(0).toUpperCase() || '?'}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6 -mt-4">
        {/* Info Box - Positioned to overlap header slightly */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-800 rounded-xl p-4 text-center">
          <p className="text-sm text-blue-800 dark:text-blue-300">
            💡 <strong>{t('profile.note')}</strong> {t('profile.changeMainImage')}
          </p>
        </div>

        {/* Basic Info */}
        <div className="space-y-4">
          <h2 className="font-bold dark:text-white">{t('profile.basicInformation')}</h2>
          
          {/* Display name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('onboarding.displayNameTitle')} *
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Max Mustermann"
                className="w-full pl-10 pr-4 py-3 bg-white dark:bg-[#0A0A0A] border border-gray-200 dark:border-white/5 dark:text-white rounded-xl focus:border-blyve dark:focus:border-blyve focus:outline-none focus:ring-2 focus:ring-blyve/20 transition-colors shadow-sm"
                required
              />
            </div>
          </div>

          {/* Username */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('onboarding.usernameTitle')} * <span className="text-amber-600 text-xs">({t('profile.unique')})</span>
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">@</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(normalizeUsernameInput(e.target.value))}
                placeholder="maxmustermann"
                autoCapitalize="off"
                className="w-full pl-8 pr-10 py-3 bg-white dark:bg-[#0A0A0A] border border-gray-200 dark:border-white/5 dark:text-white rounded-xl focus:border-blyve dark:focus:border-blyve focus:outline-none focus:ring-2 focus:ring-blyve/20 transition-colors shadow-sm"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-lg">
                {usernameStatus === 'checking' && <span className="inline-block w-4 h-4 border-2 border-blyve border-t-transparent rounded-full animate-spin" />}
                {usernameStatus === 'available' && <span className="text-green-500">✓</span>}
                {(usernameStatus === 'taken' || usernameStatus === 'invalid') && username.length >= 3 && (
                  <span className="text-red-500">✕</span>
                )}
              </div>
            </div>
            {usernameStatus === 'taken' && (
              <p className="text-xs text-red-600 mt-1">{t('onboarding.usernameTaken')} {t('profile.chooseAnotherName')}</p>
            )}
          </div>

          {/* Pronouns */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Pronouns
            </label>
            <select
              value={pronouns}
              onChange={(e) => setPronouns(e.target.value)}
              className="w-full px-4 py-3 bg-white dark:bg-[#0A0A0A] border border-gray-200 dark:border-white/5 dark:text-white rounded-xl focus:border-blyve dark:focus:border-blyve focus:outline-none focus:ring-2 focus:ring-blyve/20 transition-colors shadow-sm"
            >
              <option value="">Select pronouns (optional)</option>
              <option value="He/Him">He/Him</option>
              <option value="She/Her">She/Her</option>
              <option value="They/Them">They/Them</option>
              <option value="He/They">He/They</option>
              <option value="She/They">She/They</option>
              <option value="Any pronouns">Any pronouns</option>
              <option value="Prefer not to say">Prefer not to say</option>
            </select>
          </div>

          {/* Gender */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {t('onboarding.genderTitle')}
            </label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="w-full px-4 py-3 bg-white dark:bg-[#0A0A0A] border border-gray-200 dark:border-white/5 dark:text-white rounded-xl focus:border-blyve dark:focus:border-blyve focus:outline-none focus:ring-2 focus:ring-blyve/20 transition-colors shadow-sm"
            >
              <option value="">{t('profile.selectOptional')}</option>
              <option value="male">{t('profile.male')}</option>
              <option value="female">{t('profile.female')}</option>
              <option value="diverse">{t('profile.diverse')}</option>
            </select>
          </div>

          {/* Bio */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Bio
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell others about yourself — hobbies, topics you enjoy chatting about, a fun fact…"
              rows={4}
              maxLength={300}
              className="w-full px-4 py-3 bg-white dark:bg-[#0A0A0A] border border-gray-200 dark:border-white/5 dark:text-white rounded-xl focus:border-blyve dark:focus:border-blyve focus:outline-none focus:ring-2 focus:ring-blyve/20 transition-colors resize-none shadow-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              {bio.length}/300 characters
            </p>
          </div>

          {/* Location field removed — comms-only profiles */}
        </div>

        {/* Additional Info */}
        <div className="space-y-4">
          <h2 className="font-bold dark:text-white">{t('profile.additionalInformationOptional')}</h2>
          
          <div className="grid grid-cols-1 gap-4">
            {/* Favorite Food */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Favorite Food
              </label>
              <div className="relative">
                <UtensilsCrossed className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  value={favoriteFood}
                  onChange={(e) => setFavoriteFood(e.target.value)}
                  placeholder="e.g. Pizza, Sushi, Tacos"
                  className="w-full pl-10 pr-4 py-3 bg-white dark:bg-[#0A0A0A] border border-gray-200 dark:border-white/5 dark:text-white rounded-xl focus:border-blyve dark:focus:border-blyve focus:outline-none focus:ring-2 focus:ring-blyve/20 transition-colors shadow-sm"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Info Box */}
        <div className="bg-blue-50 dark:bg-[#0A0A0A] border-2 border-blue-200 dark:border-white/5 rounded-xl p-4">
          <p className="text-sm text-blue-800 dark:text-blue-300">
            💡 <strong>Tip:</strong> A clear photo and bio help friends recognize you in chat.
          </p>
        </div>
      </div>
    </div>
  );
}
