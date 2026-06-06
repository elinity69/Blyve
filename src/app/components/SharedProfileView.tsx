import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from 'framer-motion';
import { User } from '../types';
import { getOptimizedImageUrl } from '../lib/images';
import { useTranslation } from 'react-i18next';
import { useLongPress } from '../hooks/useLongPress';

interface SharedProfileViewProps {
  profile: any;
  onClose: () => void;
  bottomAccessory?: React.ReactNode;
  conversationId?: string;
  onOpenConversationActions?: (
    event: React.MouseEvent | React.PointerEvent,
    conversationId: string
  ) => void;
}

export function SharedProfileView({
  profile,
  onClose,
  bottomAccessory,
  conversationId,
  onOpenConversationActions,
}: SharedProfileViewProps) {
  const { t, i18n } = useTranslation();
  const [imageIndex, setImageIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const y = useMotionValue(0);
  const opacity = useTransform(y, [0, 200], [1, 0.5]);

  const user: User = useMemo(() => {
    const imagesFromProfile = Array.isArray(profile?.images) ? profile.images : [];
    const avatar = profile?.avatar_url || profile?.imageUrl || imagesFromProfile[0] || undefined;

    return {
      id: profile?.id || 'unknown',
      name: profile?.display_name || profile?.name || profile?.username || 'Unknown',
      username: profile?.username || undefined,
      bio: profile?.bio || '',
      avatar_url: avatar,
      images: imagesFromProfile,
      gender: profile?.gender,
      createdAt: profile?.member_since || profile?.created_at || profile?.createdAt || undefined,
    };
  }, [profile]);

  const memberSinceLabel = useMemo(() => {
    if (!user.createdAt) return null;
    const date = new Date(user.createdAt);
    if (Number.isNaN(date.getTime())) return null;
    const locale = i18n.language?.startsWith('de')
      ? 'de-DE'
      : i18n.language?.startsWith('es')
        ? 'es-ES'
        : 'en-US';
    const formatted = date.toLocaleDateString(locale, {
      month: 'short',
      year: 'numeric',
    });
    return t('profile.memberSince', { date: formatted });
  }, [i18n.language, t, user.createdAt]);

  useEffect(() => {
    const checkTouchDevice = () => {
      setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
    };
    checkTouchDevice();
    window.addEventListener('resize', checkTouchDevice);
    return () => window.removeEventListener('resize', checkTouchDevice);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)');
    const updateDesktop = () => setIsDesktop(mediaQuery.matches);
    updateDesktop();
    mediaQuery.addEventListener('change', updateDesktop);
    return () => mediaQuery.removeEventListener('change', updateDesktop);
  }, []);

  const allImages = useMemo(() => {
    const profileImage = user.avatar_url;
    const galleryImages = user.images || [];
    const images: string[] = [];

    if (profileImage && typeof profileImage === 'string' && profileImage.trim().length > 0) {
      images.push(profileImage);
    }

    galleryImages.forEach((img: string) => {
      if (
        img &&
        typeof img === 'string' &&
        img.trim().length > 0 &&
        img !== profileImage &&
        !images.includes(img)
      ) {
        images.push(img);
      }
    });

    return images;
  }, [user.avatar_url, user.images]);

  const currentImage = allImages[imageIndex] || user.avatar_url;

  useEffect(() => {
    setImageIndex(0);
  }, [user.id]);

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setIsDragging(false);
    const threshold = 100;
    if (info.offset.y > threshold || info.velocity.y > 500) {
      onClose();
    } else {
      y.set(0);
    }
  };

  const handleDragStart = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    // Only allow drag-to-dismiss when at the top of the scroll area and dragging downward
    if (scrollTop > 4 || info.delta.y < 0) {
      y.set(0);
      setIsDragging(false);
      return;
    }
    setIsDragging(true);
    y.set(0);
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  const openActionsFromProfile = (event: React.MouseEvent | React.PointerEvent) => {
    if (!conversationId || !onOpenConversationActions) return;
    onOpenConversationActions(event, conversationId);
  };

  const { bind: profileLongPress } = useLongPress(openActionsFromProfile);
  const profileActionHandlers =
    conversationId && onOpenConversationActions
      ? {
          onContextMenu: (event: React.MouseEvent) => {
            event.preventDefault();
            openActionsFromProfile(event);
          },
          ...profileLongPress,
        }
      : {};

  return (
    <AnimatePresence>
      <motion.div
        key="shared-profile-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      <motion.div
        key="shared-profile-modal-root"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={
          isDesktop
            ? 'fixed inset-0 z-50 flex items-center justify-center p-6 pointer-events-none'
            : 'fixed inset-0 z-50 pointer-events-none'
        }
      >
        <motion.div
          drag={isDesktop ? false : 'y'}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.2 }}
          onDragStart={isDesktop ? undefined : handleDragStart}
          onDragEnd={isDesktop ? undefined : handleDragEnd}
          initial={isDesktop ? { opacity: 0, scale: 0.96, y: 0 } : { y: '100%' }}
          animate={isDesktop ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }}
          exit={isDesktop ? { opacity: 0, scale: 0.96, y: 0 } : { y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          className={
            isDesktop
              ? 'relative flex h-[min(88vh,660px)] w-[340px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-black md:dark:bg-[#121212] pointer-events-auto'
              : 'absolute bottom-0 left-0 right-0 cursor-grab rounded-t-3xl bg-white shadow-2xl active:cursor-grabbing dark:bg-black md:dark:bg-[#121212] pointer-events-auto'
          }
          style={
            isDesktop
              ? undefined
              : {
                  height: '95vh',
                  maxHeight: '95vh',
                  y,
                  opacity,
                }
          }
          onClick={(e) => e.stopPropagation()}
        >
          {!isDesktop ? (
            <div className="pointer-events-none absolute left-0 right-0 top-0 z-30 flex h-12 items-center justify-center">
              <div className="h-1.5 w-12 rounded-full bg-gray-300 dark:bg-gray-700" />
            </div>
          ) : null}

          <div
            className={
              isDesktop
                ? 'flex min-h-0 flex-1 flex-col overflow-y-auto'
                : 'h-full overflow-y-auto'
            }
            style={{
              touchAction: isDesktop ? 'pan-y pinch-zoom' : scrollTop === 0 ? 'none' : 'pan-y pinch-zoom',
              pointerEvents: isDragging ? 'none' : 'auto',
            }}
            onScroll={handleScroll}
          >
            <div {...profileActionHandlers}>
            <div
              className={`relative w-full shrink-0 overflow-hidden ${isDesktop ? 'h-[400px]' : 'h-[45vh]'}`}
              style={{
                touchAction: 'inherit',
                userSelect: 'none',
                WebkitUserSelect: 'none',
              }}
            >
              {currentImage ? (
                <img
                  src={getOptimizedImageUrl(currentImage, 800)}
                  alt={user.name}
                  className="w-full h-full object-cover object-top"
                  draggable={false}
                  onDragStart={(e) => e.preventDefault()}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                />
              ) : (
                <div className="w-full h-full bg-blyve flex items-center justify-center">
                  <div className="text-8xl text-white/80 font-bold">{user.name?.charAt(0) || '?'}</div>
                </div>
              )}

              <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-white dark:from-black md:dark:from-[#121212] via-white/80 dark:via-black/80 md:dark:via-[#121212]/80 to-transparent pointer-events-none" />

              {allImages.length > 1 && isTouchDevice && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-20">
                  {allImages.map((_, idx) => (
                    <motion.button
                      key={idx}
                      onClick={(e) => {
                        e.stopPropagation();
                        setImageIndex(idx);
                      }}
                      className={`h-1.5 rounded-full transition-all ${idx === imageIndex ? 'w-8 bg-white' : 'w-1.5 bg-white/50'}`}
                      whileTap={{ scale: 0.9 }}
                      transition={{ duration: 0.1, ease: 'easeOut' }}
                    />
                  ))}
                </div>
              )}

              {allImages.length > 1 && isTouchDevice && (
                <>
                  <motion.button
                    onClick={(e) => {
                      e.stopPropagation();
                      setImageIndex((prev) => (prev > 0 ? prev - 1 : allImages.length - 1));
                    }}
                    className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/20 hover:bg-white/30 backdrop-blur-md rounded-full flex items-center justify-center text-white transition-colors z-20"
                    whileTap={{ scale: 0.95 }}
                    transition={{ duration: 0.1, ease: 'easeOut' }}
                  >
                    ←
                  </motion.button>
                  <motion.button
                    onClick={(e) => {
                      e.stopPropagation();
                      setImageIndex((prev) => (prev < allImages.length - 1 ? prev + 1 : 0));
                    }}
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/20 hover:bg-white/30 backdrop-blur-md rounded-full flex items-center justify-center text-white transition-colors z-20"
                    whileTap={{ scale: 0.95 }}
                    transition={{ duration: 0.1, ease: 'easeOut' }}
                  >
                    →
                  </motion.button>
                </>
              )}
            </div>

            <div className={`space-y-5 p-5 ${isDesktop ? 'pb-6' : ''}`} style={{ paddingBottom: isDesktop ? undefined : 120 }}>
              <div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                  {user.name}
                </h1>
                {user.username && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 -mt-1 mb-2">@{user.username}</p>
                )}
              </div>

              {user.bio && (
                <div>
                  <p className="text-gray-600 dark:text-gray-300 leading-relaxed">{user.bio}</p>
                  {memberSinceLabel && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{memberSinceLabel}</p>
                  )}
                </div>
              )}

              {user.gender && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 dark:bg-[#0A0A0A] dark:border dark:border-white/5 rounded-xl p-4">
                    <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 uppercase tracking-wide">Gender</p>
                    <p className="text-lg font-bold text-gray-900 dark:text-white">{user.gender}</p>
                  </div>
                </div>
              )}

              {bottomAccessory}
            </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
