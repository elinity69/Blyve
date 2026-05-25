import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, Check, Globe, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTranslation } from 'react-i18next';
import i18n, { APP_LANGUAGES, normalizeAppLanguage, type AppLanguageCode } from '../../lib/i18n';
import {
  normalizeUsernameInput,
  validateUsernameFormat,
  isUsernameAvailable,
  suggestAvailableUsername,
} from '../lib/username';
import { formatSupabaseClientError } from '../lib/supabaseErrors';

interface OnboardingWizardProps {
  userEmail?: string;
  userName?: string;
  onComplete: () => void;
}

export function OnboardingWizard({ userName, onComplete }: OnboardingWizardProps) {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState({
    displayName: userName || '',
    username: '',
    bio: '',
    legalAccepted: false,
  });
  const [profileImage, setProfileImage] = useState<File | null>(null);
  const [profileImagePreview, setProfileImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle');
  const [usernameSuggestion, setUsernameSuggestion] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<AppLanguageCode>(() =>
    normalizeAppLanguage(i18n.language)
  );

  /** 5 Seiten: Sprache, Anzeigename, Username, Avatar+BIO, Legal */
  const totalSteps = 5;

  const handleLanguageSelect = (code: AppLanguageCode) => {
    setSelectedLanguage(code);
    void i18n.changeLanguage(code);
  };

  const updateForm = (patch: Partial<typeof formData>) => {
    setFormData((prev) => ({ ...prev, ...patch }));
    setError('');
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError(t('onboarding.errorImageSize'));
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError(t('onboarding.errorImageType'));
      return;
    }
    setProfileImage(file);
    const reader = new FileReader();
    reader.onloadend = () => setProfileImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (currentStep !== 2) {
      setUsernameStatus('idle');
      return;
    }
    const u = normalizeUsernameInput(formData.username);

    if (u.length < 3) {
      setUsernameStatus('invalid');
      setUsernameSuggestion(null);
      return;
    }
    const fmtErr = validateUsernameFormat(u);
    if (fmtErr !== null) {
      setUsernameStatus('invalid');
      setUsernameSuggestion(null);
      return;
    }

    setUsernameStatus('checking');
    const timer = setTimeout(async () => {
      const avail = await isUsernameAvailable(supabase, u);
      if (avail) {
        setUsernameStatus('available');
        setUsernameSuggestion(null);
      } else {
        setUsernameStatus('taken');
        const sug = await suggestAvailableUsername(supabase, u);
        setUsernameSuggestion(sug);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [formData.username, currentStep]);

  const handleNext = async () => {
    if (currentStep === 1 && !formData.displayName.trim()) {
      setError(t('onboarding.errorDisplayNameRequired'));
      return;
    }
    if (currentStep === 2) {
      const u = normalizeUsernameInput(formData.username);
      const fmtErr = validateUsernameFormat(u);
      if (fmtErr === 'SHORT') {
        setError(t('onboarding.errorUsernameShort'));
        return;
      }
      if (fmtErr === 'INVALID') {
        setError(t('onboarding.errorUsernameInvalid'));
        return;
      }
      const avail = await isUsernameAvailable(supabase, u);
      if (!avail) {
        setError(t('onboarding.errorUsernameTaken'));
        return;
      }
    }
    if (currentStep === 3) {
      if (!profileImage) {
        setError(t('onboarding.errorPhotoRequired'));
        return;
      }
    }
    setCurrentStep((prev) => Math.min(prev + 1, totalSteps - 1));
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
    setError('');
  };

  const handleFinish = async () => {
    setLoading(true);
    setError('');
    if (!formData.legalAccepted) {
      setError(t('onboarding.errorLegalRequired'));
      setLoading(false);
      return;
    }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const u = normalizeUsernameInput(formData.username);
      if (validateUsernameFormat(u) !== null || !(await isUsernameAvailable(supabase, u, user.id))) {
        throw new Error(t('onboarding.errorUsernameTaken'));
      }

      let imageUrl = null as string | null;
      if (profileImage) {
        const filePath = `${user.id}/${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(filePath, profileImage, { contentType: 'image/jpeg' });
        if (uploadError) {
          const msg = (uploadError.message || '').toLowerCase();
          if (msg.includes('bucket not found') || (msg.includes('not found') && msg.includes('bucket'))) {
            throw new Error(t('onboarding.errorStorageBucket'));
          }
          throw uploadError;
        }
        const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(filePath);
        imageUrl = publicUrl;
      }

      const display = formData.displayName.trim();
      const updateData = {
        name: display,
        display_name: display,
        username: u,
        gender: 'diverse' as const,
        bio: formData.bio,
        avatar_url: imageUrl,
        images: imageUrl ? [imageUrl] : [],
        onboarding_complete: true,
      };

      const upsertData = {
        id: user.id,
        ...updateData,
        onboarding_complete: true,
      };

      const { error: updateError } = await supabase
        .from('profiles')
        .upsert(upsertData, { onConflict: 'id' });

      if (updateError) throw updateError;

      try {
        const { data: { session }, error: refreshError } = await supabase.auth.refreshSession();
        if (!refreshError && session?.access_token) {
          const { api } = await import('../lib/api');
          api.setAccessToken(session.access_token);
        }
      } catch {
        /* non-blocking */
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
      onComplete();
    } catch (err: unknown) {
      console.error('Onboarding finish failed:', err);
      const detail = formatSupabaseClientError(err);
      setError(detail || t('onboarding.errorSaveGeneric'));
    } finally {
      setLoading(false);
    }
  };

  const applyUsernameSuggestion = () => {
    if (usernameSuggestion) {
      updateForm({ username: usernameSuggestion });
    }
  };

  return (
    <div className="h-full bg-white dark:bg-black md:dark:bg-[#121212] flex flex-col">
      {currentStep > 0 && (
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-center justify-end mb-3">
            <button
              type="button"
              onClick={onComplete}
              className="w-10 h-10 rounded-full flex items-center justify-center text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 tracking-wide">
              {t('onboarding.stepOf', { current: currentStep + 1, total: totalSteps })}
            </span>
            <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 tracking-wide">
              {Math.round(((currentStep + 1) / totalSteps) * 100)}%
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-[#0A0A0A] rounded-full h-1 overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-orange-500 to-orange-600 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${((currentStep + 1) / totalSteps) * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <AnimatePresence mode="wait">
          {currentStep === 0 && (
            <motion.div
              key="step0"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex flex-col min-h-[60vh]"
            >
              <div className="flex justify-center mb-5">
                <div className="w-14 h-14 rounded-full bg-orange-100 dark:bg-orange-500/15 flex items-center justify-center">
                  <Globe className="w-7 h-7 text-orange-600" />
                </div>
              </div>
              <h2 className="text-[28px] font-bold text-gray-900 dark:text-white text-center mb-2">
                {t('onboarding.languageTitle')}
              </h2>
              <p className="text-[15px] text-gray-500 dark:text-gray-400 text-center mb-8">
                {t('onboarding.languageSubtitle')}
              </p>
              <div className="space-y-3">
                {APP_LANGUAGES.map((language) => {
                  const isActive = selectedLanguage === language.code;
                  return (
                    <button
                      key={language.code}
                      type="button"
                      onClick={() => handleLanguageSelect(language.code)}
                      className={`w-full flex items-center justify-between gap-3 px-5 h-[56px] rounded-2xl border text-left transition-colors ${
                        isActive
                          ? 'border-orange-500 bg-orange-50 dark:bg-orange-500/10'
                          : 'border-gray-200 dark:border-white/10 bg-white dark:bg-[#0A0A0A] hover:border-orange-300 dark:hover:border-orange-500/40'
                      }`}
                    >
                      <span className="flex items-center gap-3 min-w-0">
                        <span className="text-2xl leading-none" aria-hidden>
                          {language.flag}
                        </span>
                        <span className="text-[16px] font-semibold text-gray-900 dark:text-white truncate">
                          {language.label}
                        </span>
                      </span>
                      {isActive ? (
                        <span className="w-7 h-7 rounded-full bg-orange-600 flex items-center justify-center shrink-0">
                          <Check className="w-4 h-4 text-white stroke-[3]" />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                type="button"
                onClick={handleNext}
                className="w-full mt-8 h-[48px] bg-orange-600 text-white rounded-full font-semibold text-base shadow-md"
              >
                {t('onboarding.continue')}
              </motion.button>
            </motion.div>
          )}

          {currentStep === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex flex-col justify-center min-h-[50vh]"
            >
              <h2 className="text-[32px] font-bold text-gray-900 dark:text-white mb-2">
                {t('onboarding.displayNameTitle')}
              </h2>
              <p className="text-[15px] text-gray-500 dark:text-gray-400 mb-6">
                {t('onboarding.displayNameSubtitle')}
              </p>
              <input
                type="text"
                value={formData.displayName}
                onChange={(e) => updateForm({ displayName: e.target.value })}
                placeholder={t('onboarding.displayNamePlaceholder')}
                className="w-full h-[50px] px-6 text-[15px] border border-gray-300 dark:border-white/5 dark:bg-[#0A0A0A] dark:text-white rounded-full focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
              />
            </motion.div>
          )}

          {currentStep === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex flex-col justify-center min-h-[50vh]"
            >
              <h2 className="text-[32px] font-bold text-gray-900 dark:text-white mb-2">
                {t('onboarding.usernameTitle')}
              </h2>
              <p className="text-[15px] text-gray-500 dark:text-gray-400 mb-4">
                {t('onboarding.usernameHint')}
              </p>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-[15px]">@</span>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => updateForm({ username: normalizeUsernameInput(e.target.value) })}
                  placeholder={t('onboarding.usernamePlaceholder')}
                  autoCapitalize="off"
                  autoCorrect="off"
                  className="w-full h-[50px] pl-9 pr-12 text-[15px] border border-gray-300 dark:border-white/5 dark:bg-[#0A0A0A] dark:text-white rounded-full focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                  {usernameStatus === 'checking' && (
                    <div className="w-4 h-4 border-2 border-orange-600 border-t-transparent rounded-full animate-spin" />
                  )}
                  {usernameStatus === 'available' && <span className="text-green-500 text-lg">✓</span>}
                  {(usernameStatus === 'taken' || usernameStatus === 'invalid') && formData.username.length >= 3 && (
                    <span className="text-red-500 text-lg">✕</span>
                  )}
                </div>
              </div>
              <p className="mt-2 text-sm min-h-[22px]">
                {usernameStatus === 'available' && (
                  <span className="text-green-600 dark:text-green-400">{t('onboarding.usernameAvailable')}</span>
                )}
                {usernameStatus === 'taken' && (
                  <span className="text-red-600 dark:text-red-400">
                    {t('onboarding.usernameTaken')}{' '}
                    {usernameSuggestion && (
                      <button
                        type="button"
                        onClick={applyUsernameSuggestion}
                        className="underline text-orange-600"
                      >
                        {t('onboarding.usernameSuggest', { name: usernameSuggestion })}
                      </button>
                    )}
                  </span>
                )}
                {usernameStatus === 'invalid' && formData.username.length > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">{t('onboarding.usernameInvalidHint')}</span>
                )}
              </p>
            </motion.div>
          )}

          {currentStep === 3 && (
            <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="pb-4">
              <h2 className="text-[32px] font-bold text-gray-900 dark:text-white mb-2">{t('onboarding.avatarBioTitle')}</h2>
              <p className="text-[15px] text-gray-500 dark:text-gray-400 mb-6">{t('onboarding.avatarBioSubtitle')}</p>

              <p className="text-[14px] font-semibold text-gray-700 dark:text-gray-300 mb-2">{t('onboarding.photoTitle')}</p>
              <div className="w-32 h-32 rounded-full border-2 border-dashed border-orange-400 flex items-center justify-center mb-4 overflow-hidden">
                {profileImagePreview ? (
                  <img src={profileImagePreview} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Camera className="w-10 h-10 text-orange-500" />
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageSelect} className="hidden" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mb-6 h-10 px-4 bg-orange-600 text-white rounded-full text-sm font-semibold"
              >
                {t('onboarding.uploadPhoto')}
              </button>

              <p className="text-[14px] font-semibold text-gray-700 dark:text-gray-300 mb-2">{t('onboarding.bioTitle')}</p>
              <textarea
                value={formData.bio}
                onChange={(e) => updateForm({ bio: e.target.value })}
                placeholder={t('onboarding.bioPlaceholder')}
                className="w-full px-6 py-4 border border-gray-300 dark:border-white/5 dark:bg-[#0A0A0A] dark:text-white rounded-2xl focus:border-orange-500 focus:outline-none text-[15px]"
                rows={4}
              />
            </motion.div>
          )}

          {currentStep === 4 && (
            <motion.div key="step4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <h2 className="text-[32px] font-bold text-gray-900 dark:text-white mb-2">{t('onboarding.legalTitle')}</h2>
              <p className="text-[15px] text-gray-500 dark:text-gray-400 mb-6">{t('onboarding.legalSubtitle')}</p>
              <label className="flex items-start gap-3 text-[15px] text-gray-700 dark:text-gray-300 cursor-pointer">
                <div className="relative flex-shrink-0 mt-0.5">
                  <input
                    type="checkbox"
                    checked={formData.legalAccepted}
                    onChange={(e) => updateForm({ legalAccepted: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-6 h-6 border-2 border-gray-300 dark:border-white/5 rounded-md peer-checked:bg-orange-600 peer-checked:border-transparent transition-all duration-200 flex items-center justify-center">
                    {formData.legalAccepted && <Check className="w-4 h-4 text-white stroke-[3]" />}
                  </div>
                </div>
                <span className="flex-1 leading-relaxed">
                  {t('onboarding.legalAcceptPrefix')}{' '}
                  <a href="#" className="text-orange-600 underline">{t('onboarding.legalTos')}</a>
                  {' '}{t('onboarding.legalAnd')}{' '}
                  <a href="#" className="text-orange-600 underline">{t('onboarding.legalPrivacy')}</a>
                  {t('onboarding.legalAcceptSuffix')}
                </span>
              </label>
            </motion.div>
          )}
        </AnimatePresence>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>

      {currentStep > 0 && (
        <div className="px-6 pb-8 flex items-center justify-between gap-3">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            type="button"
            onClick={handleBack}
            className="px-5 h-[48px] rounded-full font-semibold disabled:opacity-30 disabled:cursor-not-allowed bg-gray-100 text-gray-700 border border-gray-200 dark:bg-black dark:text-gray-100 dark:border-[#1f2123]"
          >
            {t('onboarding.back')}
          </motion.button>
          {currentStep < totalSteps - 1 ? (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              type="button"
              onClick={handleNext}
              disabled={
                loading ||
                (currentStep === 2 &&
                  (usernameStatus !== 'available' ||
                    !formData.username ||
                    normalizeUsernameInput(formData.username).length < 3))
              }
              className="flex-1 h-[48px] bg-orange-600 text-white rounded-full font-semibold text-base shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('onboarding.continue')}
            </motion.button>
          ) : (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              type="button"
              onClick={handleFinish}
              disabled={loading || !formData.legalAccepted}
              className="flex-1 h-[48px] bg-orange-600 text-white rounded-full font-semibold text-base shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? t('onboarding.saving') : t('onboarding.finish')}
            </motion.button>
          )}
        </div>
      )}
    </div>
  );
}
