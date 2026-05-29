import { useCallback, useEffect, useRef, useState } from 'react';
import type { ParsedEmbed } from '../lib/linkEmbeds';
import { normalizeUrlForMatch, parseEmbed } from '../lib/linkEmbeds';
import {
  dispatchFavoriteEmbedsSyncStatus,
  endFavoriteEmbedsSync,
  FAVORITE_EMBEDS_EVENT,
  FAVORITE_EMBEDS_SYNC_EVENT,
  isEmbedFavorited,
  readFavoriteEmbeds,
  removeFavoriteEmbed,
  enrichFavoriteEmbed,
  toggleFavoriteEmbed,
  tryBeginFavoriteEmbedsSync,
  writeFavoriteEmbeds,
  type FavoriteEmbed,
  type FavoriteEmbedsSyncStatus,
} from '../lib/favoriteEmbeds';
import {
  deleteCloudFavoriteEmbed,
  syncCloudFavoriteEmbeds,
  upsertCloudFavoriteEmbed,
} from '../lib/favoriteEmbedsCloud';
import { useAppData } from '../context/AppDataContext';

export type { FavoriteEmbedsSyncStatus };

export function useFavoriteEmbeds() {
  const { currentUserProfile } = useAppData();
  const userId = currentUserProfile?.id as string | undefined;
  const [favorites, setFavorites] = useState<FavoriteEmbed[]>(() => readFavoriteEmbeds());
  const [syncStatus, setSyncStatus] = useState<FavoriteEmbedsSyncStatus>('idle');
  const syncedTimeoutRef = useRef<number | null>(null);

  const clearSyncedTimeout = useCallback(() => {
    if (syncedTimeoutRef.current != null) {
      window.clearTimeout(syncedTimeoutRef.current);
      syncedTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    const syncFavorites = () => setFavorites(readFavoriteEmbeds());
    const syncStatusFromEvent = (event: Event) => {
      const next = (event as CustomEvent<FavoriteEmbedsSyncStatus>).detail;
      if (next) setSyncStatus(next);
    };

    window.addEventListener(FAVORITE_EMBEDS_EVENT, syncFavorites);
    window.addEventListener(FAVORITE_EMBEDS_SYNC_EVENT, syncStatusFromEvent);
    return () => {
      window.removeEventListener(FAVORITE_EMBEDS_EVENT, syncFavorites);
      window.removeEventListener(FAVORITE_EMBEDS_SYNC_EVENT, syncStatusFromEvent);
    };
  }, []);

  useEffect(() => () => clearSyncedTimeout(), [clearSyncedTimeout]);

  const refreshFavorites = useCallback(async (): Promise<boolean> => {
    if (!userId) {
      setFavorites(readFavoriteEmbeds());
      return true;
    }

    if (!tryBeginFavoriteEmbedsSync()) return false;

    clearSyncedTimeout();
    dispatchFavoriteEmbedsSyncStatus('syncing');

    try {
      const local = readFavoriteEmbeds();
      const { merged, error } = await syncCloudFavoriteEmbeds(userId, local);

      if (error) {
        dispatchFavoriteEmbedsSyncStatus('error');
        return false;
      }

      const needsEnrich = merged.some(
        (f) => (f.kind === 'tenor' || f.kind === 'giphy') && !f.imageUrl
      );
      const finalList = needsEnrich
        ? await Promise.all(
            merged.map(async (f) => {
              if (f.kind !== 'tenor' && f.kind !== 'giphy') return f;
              if (f.imageUrl) return f;
              const embed =
                parseEmbed(f.url) ?? {
                  url: f.url,
                  kind: f.kind,
                  giphyId: f.giphyId,
                  tenorId: f.tenorId,
                };
              return enrichFavoriteEmbed(embed);
            })
          )
        : merged;

      if (needsEnrich || merged !== local) {
        writeFavoriteEmbeds(finalList);
      } else {
        setFavorites(merged);
      }

      dispatchFavoriteEmbedsSyncStatus('synced');
      syncedTimeoutRef.current = window.setTimeout(() => {
        dispatchFavoriteEmbedsSyncStatus('idle');
        syncedTimeoutRef.current = null;
      }, 2000);
      return true;
    } catch {
      dispatchFavoriteEmbedsSyncStatus('error');
      return false;
    } finally {
      endFavoriteEmbedsSync();
    }
  }, [userId, clearSyncedTimeout]);

  useEffect(() => {
    if (!userId) {
      dispatchFavoriteEmbedsSyncStatus('idle');
      return;
    }

    void refreshFavorites();
  }, [userId, refreshFavorites]);

  const isFavorited = useCallback(
    (url: string) => isEmbedFavorited(url, favorites),
    [favorites]
  );

  const toggleFavorite = useCallback(
    async (embed: ParsedEmbed): Promise<boolean> => {
      const key = normalizeUrlForMatch(embed.url);
      const list = readFavoriteEmbeds();
      const existing = list.find(
        (item) =>
          normalizeUrlForMatch(item.url) === key ||
          (embed.tenorId && item.tenorId === embed.tenorId) ||
          (embed.giphyId && item.giphyId === embed.giphyId)
      );

      if (existing) {
        removeFavoriteEmbed(existing.url);
        setFavorites(readFavoriteEmbeds());
        if (userId) void deleteCloudFavoriteEmbed(userId, existing.url);
        return false;
      }

      const favorite = await enrichFavoriteEmbed(embed);
      toggleFavoriteEmbed(favorite);
      const next = readFavoriteEmbeds();
      setFavorites(next);
      if (userId) void upsertCloudFavoriteEmbed(userId, favorite);
      return true;
    },
    [userId]
  );

  const removeFavorite = useCallback(
    (url: string) => {
      removeFavoriteEmbed(url);
      setFavorites(readFavoriteEmbeds());
      if (userId) {
        void deleteCloudFavoriteEmbed(userId, url);
      }
    },
    [userId]
  );

  return {
    favorites,
    isFavorited,
    toggleFavorite,
    removeFavorite,
    syncStatus,
    isCloudEnabled: Boolean(userId),
    refreshFavorites,
  };
}
