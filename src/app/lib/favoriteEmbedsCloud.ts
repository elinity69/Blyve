import { supabase } from './supabase';
import type { FavoriteEmbed } from './favoriteEmbeds';
import { mergeFavoriteEmbeds } from './favoriteEmbeds';
import { normalizeUrlForMatch } from './linkEmbeds';

type FavoriteEmbedRow = {
  id: string;
  user_id: string;
  url: string;
  kind: FavoriteEmbed['kind'];
  image_url: string | null;
  giphy_id: string | null;
  tenor_id: string | null;
  saved_at: string;
};

function rowToFavorite(row: FavoriteEmbedRow): FavoriteEmbed {
  return {
    url: row.url,
    kind: row.kind,
    imageUrl: row.image_url ?? undefined,
    giphyId: row.giphy_id ?? undefined,
    tenorId: row.tenor_id ?? undefined,
    savedAt: new Date(row.saved_at).getTime(),
  };
}

function favoriteToRow(userId: string, favorite: FavoriteEmbed) {
  return {
    user_id: userId,
    url: favorite.url,
    kind: favorite.kind,
    image_url: favorite.imageUrl ?? null,
    giphy_id: favorite.giphyId ?? null,
    tenor_id: favorite.tenorId ?? null,
    saved_at: new Date(favorite.savedAt || Date.now()).toISOString(),
  };
}

export async function fetchCloudFavoriteEmbeds(userId: string): Promise<FavoriteEmbed[]> {
  const { data, error } = await supabase
    .from('favorite_embeds')
    .select('id, user_id, url, kind, image_url, giphy_id, tenor_id, saved_at')
    .eq('user_id', userId)
    .order('saved_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data as FavoriteEmbedRow[] | null)?.map(rowToFavorite) ?? [];
}

export async function upsertCloudFavoriteEmbed(
  userId: string,
  favorite: FavoriteEmbed
): Promise<void> {
  const { error } = await supabase
    .from('favorite_embeds')
    .upsert(favoriteToRow(userId, favorite), { onConflict: 'user_id,url' });

  if (error) {
    console.warn('favorite_embeds upsert failed:', error.message);
  }
}

export async function deleteCloudFavoriteEmbed(userId: string, url: string): Promise<void> {
  const { data, error } = await supabase
    .from('favorite_embeds')
    .select('id, url')
    .eq('user_id', userId);

  if (error) {
    console.warn('favorite_embeds delete lookup failed:', error.message);
    return;
  }

  const key = normalizeUrlForMatch(url);
  const ids =
    (data as { id: string; url: string }[] | null)
      ?.filter((row) => normalizeUrlForMatch(row.url) === key)
      .map((row) => row.id) ?? [];

  if (ids.length === 0) return;

  const { error: deleteError } = await supabase.from('favorite_embeds').delete().in('id', ids);
  if (deleteError) {
    console.warn('favorite_embeds delete failed:', deleteError.message);
  }
}

export async function syncCloudFavoriteEmbeds(
  userId: string,
  localFavorites: FavoriteEmbed[]
): Promise<{ merged: FavoriteEmbed[]; error?: string }> {
  let remoteFavorites: FavoriteEmbed[];
  try {
    remoteFavorites = await fetchCloudFavoriteEmbeds(userId);
  } catch (error) {
    console.warn('favorite_embeds fetch failed:', error);
    return { merged: localFavorites, error: 'fetch_failed' };
  }

  const merged = mergeFavoriteEmbeds(localFavorites, remoteFavorites);

  const mergedKeys = new Set(merged.map((favorite) => normalizeUrlForMatch(favorite.url)));
  const remoteKeys = new Set(remoteFavorites.map((favorite) => normalizeUrlForMatch(favorite.url)));
  const localKeys = new Set(localFavorites.map((favorite) => normalizeUrlForMatch(favorite.url)));

  const needsCloudUpsert = merged.some((favorite) => {
    const key = normalizeUrlForMatch(favorite.url);
    if (!remoteKeys.has(key)) return true;
    const remote = remoteFavorites.find((item) => normalizeUrlForMatch(item.url) === key);
    return remote != null && (favorite.savedAt || 0) > (remote.savedAt || 0);
  });

  const needsCloudDelete = remoteFavorites.some(
    (favorite) => !mergedKeys.has(normalizeUrlForMatch(favorite.url))
  );

  const needsLocalWrite =
    merged.length !== localFavorites.length ||
    merged.some((favorite) => {
      const key = normalizeUrlForMatch(favorite.url);
      const local = localFavorites.find((item) => normalizeUrlForMatch(item.url) === key);
      return !local || local.savedAt !== favorite.savedAt;
    });

  if (needsCloudUpsert) {
    const rows = merged
      .filter((favorite) => {
        const key = normalizeUrlForMatch(favorite.url);
        if (!remoteKeys.has(key)) return true;
        if (!localKeys.has(key)) return false;
        const remote = remoteFavorites.find((item) => normalizeUrlForMatch(item.url) === key);
        return remote != null && (favorite.savedAt || 0) > (remote.savedAt || 0);
      })
      .map((favorite) => favoriteToRow(userId, favorite));

    if (rows.length > 0) {
      const { error } = await supabase.from('favorite_embeds').upsert(rows, { onConflict: 'user_id,url' });
      if (error) console.warn('favorite_embeds batch upsert failed:', error.message);
    }
  }

  if (needsCloudDelete) {
    for (const favorite of remoteFavorites) {
      if (!mergedKeys.has(normalizeUrlForMatch(favorite.url))) {
        await deleteCloudFavoriteEmbed(userId, favorite.url);
      }
    }
  }

  if (needsLocalWrite) {
    return { merged };
  }

  return { merged: localFavorites };
}
