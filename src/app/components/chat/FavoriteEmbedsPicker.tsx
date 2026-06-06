import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  Check,
  ExternalLink,
  ImageIcon,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import { getOptimizedImageUrl } from '../../lib/images';
import type { FavoriteEmbed } from '../../lib/favoriteEmbeds';
import { previewUrlForFavorite } from '../../lib/favoriteEmbeds';
import { parseEmbed } from '../../lib/linkEmbeds';
import { resolveEmbedMediaUrl } from '../../lib/embedMediaResolver';
import {
  useFavoriteEmbeds,
  type FavoriteEmbedsSyncStatus,
} from '../../hooks/useFavoriteEmbeds';
import { useIsMobile } from '../ui/use-mobile';
import { api } from '../../lib/api';

interface FavoriteEmbedThumbnailProps {
  favorite: FavoriteEmbed;
}

function FavoriteEmbedThumbnail({ favorite }: FavoriteEmbedThumbnailProps) {
  const [src, setSrc] = useState<string | undefined>(() => previewUrlForFavorite(favorite));
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setImgFailed(false);

    async function resolvePreview() {
      if (src) return;

      if (favorite.kind === 'tenor' || favorite.kind === 'giphy') {
        const embed =
          parseEmbed(favorite.url) ?? {
            url: favorite.url,
            kind: favorite.kind,
            giphyId: favorite.giphyId,
            tenorId: favorite.tenorId,
            imageUrl: favorite.imageUrl,
          };
        const mediaUrl = await resolveEmbedMediaUrl(embed);
        if (!cancelled && mediaUrl) setSrc(mediaUrl);
        return;
      }

      if (favorite.kind === 'link') {
        try {
          const preview = await api.getLinkPreview(favorite.url);
          if (!cancelled && preview?.image) setSrc(preview.image);
        } catch {
          // ignore preview errors
        }
      }
    }

    void resolvePreview();
    return () => {
      cancelled = true;
    };
  }, [favorite, src]);

  if (src && !imgFailed) {
    return (
      <img
        src={getOptimizedImageUrl(src, 240)}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
        onError={() => setImgFailed(true)}
      />
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-black/10 dark:bg-white/10">
      {favorite.kind === 'link' ? (
        <ExternalLink className="h-6 w-6 text-gray-500 dark:text-gray-400" aria-hidden />
      ) : (
        <ImageIcon className="h-6 w-6 text-gray-500 dark:text-gray-400" aria-hidden />
      )}
    </div>
  );
}

function FavoriteEmbedsSyncStatus({
  syncStatus,
  isCloudEnabled,
  onRefresh,
}: {
  syncStatus: FavoriteEmbedsSyncStatus;
  isCloudEnabled: boolean;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();

  if (!isCloudEnabled) return null;

  if (syncStatus === 'syncing') {
    return (
      <span className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        {t('chat.favoriteEmbedsSyncing')}
      </span>
    );
  }

  if (syncStatus === 'synced') {
    return (
      <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
        <Check className="h-3.5 w-3.5" aria-hidden />
        {t('chat.favoriteEmbedsSynced')}
      </span>
    );
  }

  if (syncStatus === 'error') {
    return (
      <button
        type="button"
        onClick={() => void onRefresh()}
        className="flex items-center gap-1 text-[11px] text-red-600 dark:text-red-400"
      >
        <AlertCircle className="h-3.5 w-3.5" aria-hidden />
        {t('chat.favoriteEmbedsSyncFailed')}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void onRefresh()}
      aria-label={t('chat.favoriteEmbedsRefresh')}
      className="rounded-full p-1 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10"
    >
      <RefreshCw className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

function FavoriteEmbedsPullRefresh({
  children,
  onRefresh,
  refreshing,
  enabled,
}: {
  children: ReactNode;
  onRefresh: () => void | Promise<void>;
  refreshing: boolean;
  enabled: boolean;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef(0);
  const pullingRef = useRef(false);
  const [pullDistance, setPullDistance] = useState(0);
  const pullThreshold = 56;

  const handleTouchStart = (event: React.TouchEvent) => {
    if (!enabled || refreshing) return;
    if ((scrollRef.current?.scrollTop ?? 0) > 0) return;
    startYRef.current = event.touches[0]?.clientY ?? 0;
    pullingRef.current = true;
  };

  const handleTouchMove = (event: React.TouchEvent) => {
    if (!pullingRef.current || refreshing) return;
    if ((scrollRef.current?.scrollTop ?? 0) > 0) {
      setPullDistance(0);
      return;
    }

    const currentY = event.touches[0]?.clientY ?? 0;
    const delta = Math.max(0, currentY - startYRef.current);
    if (delta > 0) {
      setPullDistance(Math.min(delta * 0.45, 72));
    }
  };

  const handleTouchEnd = () => {
    if (!pullingRef.current) return;
    pullingRef.current = false;
    if (pullDistance >= pullThreshold && !refreshing) {
      void onRefresh();
    }
    setPullDistance(0);
  };

  const indicatorHeight = refreshing ? 40 : pullDistance;

  return (
    <div
      ref={scrollRef}
      className="overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {enabled ? (
        <div
          className="flex items-center justify-center overflow-hidden text-[11px] text-gray-500 transition-[height] dark:text-gray-400"
          style={{ height: indicatorHeight }}
        >
          {refreshing || pullDistance >= pullThreshold ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
              {refreshing ? t('chat.favoriteEmbedsSyncing') : t('chat.favoriteEmbedsReleaseToRefresh')}
            </span>
          ) : pullDistance > 8 ? (
            <span>{t('chat.favoriteEmbedsPullToRefresh')}</span>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

function FavoriteEmbedsGrid({
  favorites,
  onSelect,
  onRemove,
}: {
  favorites: FavoriteEmbed[];
  onSelect: (url: string) => void;
  onRemove: (url: string) => void;
}) {
  const { t } = useTranslation();

  if (favorites.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
        {t('chat.favoriteEmbedsEmpty')}
      </p>
    );
  }

  return (
    <div className="grid max-h-[50vh] grid-cols-3 gap-2 p-2 md:max-h-56">
      {favorites.map((favorite) => (
        <div key={favorite.url} className="group relative aspect-square overflow-hidden rounded-xl">
          <button type="button" className="h-full w-full" onClick={() => onSelect(favorite.url)}>
            <FavoriteEmbedThumbnail favorite={favorite} />
          </button>
          <button
            type="button"
            aria-label={t('chat.removeFavoriteEmbed')}
            className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:group-focus-within:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              onRemove(favorite.url);
            }}
          >
            <X className="h-3 w-3" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

function FavoriteEmbedsHeader({
  onClose,
  syncStatus,
  isCloudEnabled,
  onRefresh,
  compact,
}: {
  onClose: () => void;
  syncStatus: FavoriteEmbedsSyncStatus;
  isCloudEnabled: boolean;
  onRefresh: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={`flex items-center justify-between border-b border-gray-100 dark:border-white/10 ${
        compact ? 'px-3 py-2' : 'px-4 py-2'
      }`}
    >
      <p
        className={`font-semibold text-gray-900 dark:text-white ${
          compact ? 'text-sm' : 'text-base'
        }`}
      >
        {t('chat.favoriteEmbedsTitle')}
      </p>
      <div className="flex items-center gap-2">
        <FavoriteEmbedsSyncStatus
          syncStatus={syncStatus}
          isCloudEnabled={isCloudEnabled}
          onRefresh={onRefresh}
        />
        <button
          type="button"
          onClick={onClose}
          className={`rounded-full text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10 ${
            compact ? 'p-1' : 'p-1.5'
          }`}
          aria-label={t('chat.closeFavoriteEmbeds')}
        >
          <X className={compact ? 'h-4 w-4' : 'h-5 w-5'} aria-hidden />
        </button>
      </div>
    </div>
  );
}

interface FavoriteEmbedsPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (url: string) => void;
}

export function FavoriteEmbedsPicker({ open, onClose, onSelect }: FavoriteEmbedsPickerProps) {
  const isMobile = useIsMobile();
  const { favorites, removeFavorite, syncStatus, isCloudEnabled, refreshFavorites } =
    useFavoriteEmbeds();
  const panelRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const isSyncing = syncStatus === 'syncing';

  useEffect(() => {
    if (!open || !isCloudEnabled) return;
    void refreshFavorites();
  }, [open, isCloudEnabled, refreshFavorites]);

  useEffect(() => {
    if (!open || isMobile) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose, isMobile]);

  useEffect(() => {
    if (!open || !isMobile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open, isMobile]);

  const handleSelect = (url: string) => {
    onSelect(url);
    onClose();
  };

  const handleRefresh = () => refreshFavorites();

  if (!open) return null;

  if (isMobile) {
    return createPortal(
      <AnimatePresence>
        <motion.div
          key="favorite-embeds-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />
        <motion.div
          key="favorite-embeds-sheet"
          ref={sheetRef}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.25 }}
          onDragEnd={(_event, info) => {
            if (info.offset.y > 80 || info.velocity.y > 500) onClose();
          }}
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 32, stiffness: 340 }}
          className="fixed inset-x-0 bottom-0 z-[201] flex max-h-[min(72vh,520px)] flex-col overflow-hidden rounded-t-3xl border border-gray-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#1e1f22]"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex justify-center pt-2 pb-1">
            <div className="h-1.5 w-12 rounded-full bg-gray-300 dark:bg-gray-600" aria-hidden />
          </div>
          <FavoriteEmbedsHeader
            onClose={onClose}
            syncStatus={syncStatus}
            isCloudEnabled={isCloudEnabled}
            onRefresh={handleRefresh}
          />
          <FavoriteEmbedsPullRefresh
            enabled={isCloudEnabled}
            refreshing={isSyncing}
            onRefresh={handleRefresh}
          >
            <FavoriteEmbedsGrid
              favorites={favorites}
              onSelect={handleSelect}
              onRemove={removeFavorite}
            />
          </FavoriteEmbedsPullRefresh>
        </motion.div>
      </AnimatePresence>,
      document.body
    );
  }

  return (
    <div
      ref={panelRef}
      className="absolute bottom-full left-0 z-40 mb-2 w-[min(100vw-2rem,22rem)] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-white/10 dark:bg-[#1e1f22]"
    >
      <FavoriteEmbedsHeader
        compact
        onClose={onClose}
        syncStatus={syncStatus}
        isCloudEnabled={isCloudEnabled}
        onRefresh={handleRefresh}
      />
      <FavoriteEmbedsGrid
        favorites={favorites}
        onSelect={handleSelect}
        onRemove={removeFavorite}
      />
    </div>
  );
}
