import { useCallback, useEffect, useRef, useState } from 'react';
import type { ParsedEmbed } from '../lib/linkEmbeds';
import {
  dispatchFavoriteEmbedsSyncStatus,
  endFavoriteEmbedsSync,
  FAVORITE_EMBEDS_EVENT,
  FAVORITE_EMBEDS_SYNC_EVENT,
  isEmbedFavorited,
  readFavoriteEmbeds,
  removeFavoriteEmbed,
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

      if (merged !== local) {
        writeFavoriteEmbeds(merged);
      } else {
        setFavorites(local);
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
    (embed: ParsedEmbed) => {
      const added = toggleFavoriteEmbed(embed);
      const next = readFavoriteEmbeds();
      setFavorites(next);

      if (userId) {
        const favorite = next.find((item) => item.url === embed.url);
        if (added && favorite) {
          void upsertCloudFavoriteEmbed(userId, favorite);
        } else {
          void deleteCloudFavoriteEmbed(userId, embed.url);
        }
      }

      return added;
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
