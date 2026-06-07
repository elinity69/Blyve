import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  motion,
  AnimatePresence,
  useMotionValue,
  useTransform,
  animate,
} from 'framer-motion';
import { User } from '../types';
import { getOptimizedImageUrl } from '../lib/images';
import { useTranslation } from 'react-i18next';
import { useLongPress } from '../hooks/useLongPress';
import { setSheetDragActive } from '../lib/navigationShellStyle';

// ── Gesture thresholds ─────────────────────────────────────────────────────
// Minimum downward distance (px) required to trigger dismiss on slow drag.
const DISMISS_DISTANCE_THRESHOLD = 140;
// Minimum release velocity (px/s in framer-motion units) to dismiss even on
// a short drag — allows a quick flick to dismiss with very little travel.
const DISMISS_VELOCITY_THRESHOLD = 500;
// Spring that snaps the card back into place on an aborted drag.
const SNAP_BACK_SPRING = { type: 'spring', damping: 34, stiffness: 400, mass: 0.85 } as const;
// Spring used when throwing the card off-screen — continues the finger's
// momentum so the dismiss feels like a natural throw, not a hard cut.
const DISMISS_EXIT_SPRING = { type: 'spring', damping: 28, stiffness: 240, mass: 0.9 } as const;

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
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  // ── Raw touch-driven drag state ─────────────────────────────────────────
  // We drive the card position ourselves via raw touch events instead of
  // framer-motion's `drag` prop.  This bypasses the browser `touchAction`
  // restriction that the NavigationStack shell imposes (`pan-y`), which
  // was stealing the touch stream before framer-motion could see it.
  const y = useMotionValue(typeof window !== 'undefined' ? window.innerHeight : 800);
  const isDraggingRef = useRef(false);
  const startYRef = useRef(0);
  const startScrollTopRef = useRef(0);
  const directionLockedRef = useRef<'drag' | 'scroll' | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const dismissingRef = useRef(false);

  // ── Derived visual transforms ───────────────────────────────────────────
  // Backdrop fades from 50% black → transparent as the card slides down.
  const backdropOpacity = useTransform(y, [0, 320], [0.5, 0]);
  // Card fades very subtly so content stays readable during the drag.
  const cardOpacity = useTransform(y, [0, 360], [1, 0.72]);
  // Gentle scale-down anchored at the bottom edge — matches iOS-style sheets.
  const cardScale = useTransform(y, [0, 420], [1, 0.97]);

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
    return t('profile.memberSince', {
      date: date.toLocaleDateString(locale, { month: 'short', year: 'numeric' }),
    });
  }, [i18n.language, t, user.createdAt]);

  useEffect(() => {
    const check = () => setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Reset dismissing flag on mount, animate card up from off-screen, and clear the sentinel on unmount.
  useEffect(() => {
    dismissingRef.current = false;
    animate(y, 0, { type: 'spring', damping: 38, stiffness: 320, mass: 1.1 });
    return () => {
      setSheetDragActive(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allImages = useMemo(() => {
    const profileImage = user.avatar_url;
    const galleryImages = user.images || [];
    const images: string[] = [];
    if (profileImage && typeof profileImage === 'string' && profileImage.trim().length > 0) {
      images.push(profileImage);
    }
    galleryImages.forEach((img: string) => {
      if (img && typeof img === 'string' && img.trim().length > 0 && img !== profileImage && !images.includes(img)) {
        images.push(img);
      }
    });
    return images;
  }, [user.avatar_url, user.images]);

  const currentImage = allImages[imageIndex] || user.avatar_url;

  useEffect(() => { setImageIndex(0); }, [user.id]);

  // ── Touch gesture handlers ──────────────────────────────────────────────
  // We use native addEventListener with { passive: false } so we can call
  // preventDefault() on touchmove to block native scroll while dragging.
  // React's onTouchMove is always passive since React 17, so it cannot
  // call preventDefault() — hence the switch to a native listener.
  useEffect(() => {
    if (isDesktop) return;
    const card = cardRef.current;
    if (!card) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (dismissingRef.current) return;
      const touch = e.touches[0];
      if (!touch) return;
      startYRef.current = touch.clientY;
      startScrollTopRef.current = scrollContainerRef.current?.scrollTop ?? 0;
      directionLockedRef.current = null;
      isDraggingRef.current = false;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (dismissingRef.current) return;
      const touch = e.touches[0];
      if (!touch) return;
      const dy = touch.clientY - startYRef.current;

      if (directionLockedRef.current === null) {
        if (Math.abs(dy) < 6) return;
        const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
        if (scrollTop > 4 || dy < 0) {
          directionLockedRef.current = 'scroll';
          return;
        }
        directionLockedRef.current = 'drag';
        isDraggingRef.current = true;
        setSheetDragActive(true);
      }

      if (directionLockedRef.current !== 'drag') return;

      // This is the key call — only works in a non-passive listener.
      e.preventDefault();

      y.set(Math.max(0, dy));
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (dismissingRef.current) return;
      setSheetDragActive(false);

      if (!isDraggingRef.current) {
        directionLockedRef.current = null;
        return;
      }

      isDraggingRef.current = false;
      directionLockedRef.current = null;

      const changedTouch = e.changedTouches[0];
      const dy = changedTouch ? changedTouch.clientY - startYRef.current : 0;
      const velY = y.getVelocity();

      const shouldDismiss =
        dy > DISMISS_DISTANCE_THRESHOLD ||
        velY > DISMISS_VELOCITY_THRESHOLD;

      if (shouldDismiss) {
        dismissingRef.current = true;
        animate(y, window.innerHeight, {
          ...DISMISS_EXIT_SPRING,
          velocity: velY,
          onComplete: onClose,
        });
      } else {
        animate(y, 0, { ...SNAP_BACK_SPRING, velocity: velY });
      }
    };

    card.addEventListener('touchstart', handleTouchStart, { passive: true });
    card.addEventListener('touchmove', handleTouchMove, { passive: false });
    card.addEventListener('touchend', handleTouchEnd, { passive: true });
    card.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      card.removeEventListener('touchstart', handleTouchStart);
      card.removeEventListener('touchmove', handleTouchMove);
      card.removeEventListener('touchend', handleTouchEnd);
      card.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [isDesktop, onClose, y]);

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

  const content = (
    <AnimatePresence>
      {/* Backdrop */}
      <motion.div
        key="shared-profile-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: isDesktop ? 0.2 : 0.28 }}
        className="fixed inset-0 z-[9000] bg-black/50 backdrop-blur-sm"
        style={isDesktop ? undefined : { opacity: backdropOpacity }}
        onClick={
          isDesktop
            ? onClose
            : () => {
                if (dismissingRef.current) return;
                dismissingRef.current = true;
                animate(y, window.innerHeight, { ...DISMISS_EXIT_SPRING, onComplete: onClose });
              }
        }
      />

      {/* Centering wrapper (desktop) / full-screen wrapper (mobile) */}
      <motion.div
        key="shared-profile-modal-root"
        initial={{ opacity: isDesktop ? 0 : 1 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: isDesktop ? 0 : 1 }}
        transition={{ duration: 0.28 }}
        className={
          isDesktop
            ? 'fixed inset-0 z-[9001] flex items-center justify-center p-6 pointer-events-none'
            : 'fixed inset-0 z-[9001] pointer-events-none'
        }
      >
        {/* Card */}
        <motion.div
          // ── Enter / exit animations ──────────────────────────────────
          ref={cardRef}
          initial={isDesktop ? { opacity: 0, scale: 0.96, y: 0 } : false}
          animate={isDesktop ? { opacity: 1, scale: 1, y: 0 } : false}
          exit={isDesktop ? { opacity: 0, scale: 0.96, y: 0 } : false}
          transition={
            isDesktop
              ? { type: 'spring', damping: 30, stiffness: 300 }
              : { type: 'spring', damping: 38, stiffness: 320, mass: 1.1 }
          }
          className={
            isDesktop
              ? 'relative flex h-[min(88vh,660px)] w-[340px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-black md:dark:bg-[#121212] pointer-events-auto'
              : 'absolute bottom-0 left-0 right-0 rounded-t-3xl bg-white shadow-2xl dark:bg-black md:dark:bg-[#121212] pointer-events-auto'
          }
          style={
            isDesktop
              ? undefined
              : {
                  height: '95vh',
                  maxHeight: '95vh',
                  y,
                  opacity: cardOpacity,
                  scale: cardScale,
                  transformOrigin: 'bottom center',
                  touchAction: 'none',
                }
          }
          onClick={(e) => e.stopPropagation()}
        >
          {/* Drag handle pill */}
          {!isDesktop ? (
            <div className="pointer-events-none absolute left-0 right-0 top-0 z-30 flex h-12 items-center justify-center">
              <div className="h-1.5 w-12 rounded-full bg-gray-300 dark:bg-gray-700" />
            </div>
          ) : null}

          {/* Scrollable content — touchAction restored so inner scroll works */}
          <div
            ref={scrollContainerRef}
            className={
              isDesktop
                ? 'flex min-h-0 flex-1 flex-col overflow-y-auto'
                : 'h-full overflow-y-auto'
            }
            style={{
              // Re-enable vertical scroll within the scroll container.
              // Our onTouchMove only kicks in when at scrollTop==0 AND
              // direction is downward, so this doesn't conflict.
              touchAction: 'pan-y pinch-zoom',
            }}
          >
            <div {...profileActionHandlers}>
              {/* Hero image */}
              <div
                className={`relative w-full shrink-0 overflow-hidden ${isDesktop ? 'h-[400px]' : 'h-[45vh]'}`}
                style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
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
                        onClick={(e) => { e.stopPropagation(); setImageIndex(idx); }}
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
                      onClick={(e) => { e.stopPropagation(); setImageIndex((prev) => (prev > 0 ? prev - 1 : allImages.length - 1)); }}
                      className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/20 hover:bg-white/30 backdrop-blur-md rounded-full flex items-center justify-center text-white transition-colors z-20"
                      whileTap={{ scale: 0.95 }}
                      transition={{ duration: 0.1, ease: 'easeOut' }}
                    >
                      ←
                    </motion.button>
                    <motion.button
                      onClick={(e) => { e.stopPropagation(); setImageIndex((prev) => (prev < allImages.length - 1 ? prev + 1 : 0)); }}
                      className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 bg-white/20 hover:bg-white/30 backdrop-blur-md rounded-full flex items-center justify-center text-white transition-colors z-20"
                      whileTap={{ scale: 0.95 }}
                      transition={{ duration: 0.1, ease: 'easeOut' }}
                    >
                      →
                    </motion.button>
                  </>
                )}
              </div>

              {/* Profile info */}
              <div
                className={`space-y-5 p-5 ${isDesktop ? 'pb-6' : ''}`}
                style={{ paddingBottom: isDesktop ? undefined : 120 }}
              >
                <div>
                  <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">{user.name}</h1>
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

  // Portal to document.body so the sheet lives outside the NavigationStack's
  // DOM subtree.  This means:
  // • NavigationStack's { capture: true } touch listeners never fire for
  //   touches on the sheet.
  // • The shell's touchAction:'pan-y' cannot intercept the touch stream.
  // • framer-motion enter/exit animations still work normally.
  if (typeof document === 'undefined') return content;
  return createPortal(content, document.body);
}
