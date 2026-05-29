import type { EmbedKind, ParsedEmbed } from './linkEmbeds';
import { normalizeUrlForMatch, parseEmbed } from './linkEmbeds';
import {
  canonicalGifPageUrl,
  resolveEmbedMediaUrl,
} from './embedMediaResolver';

export interface FavoriteEmbed {
  url: string;
  kind: EmbedKind;
  imageUrl?: string;
  giphyId?: string;
  tenorId?: string;
  savedAt: number;
}

export const FAVORITE_EMBEDS_KEY = 'blyve_favorite_embeds_v1';
export const FAVORITE_EMBEDS_EVENT = 'blyve-favorite-embeds-change';
export const FAVORITE_EMBEDS_SYNC_EVENT = 'blyve-favorite-embeds-sync';
const MAX_FAVORITES = 120;

export type FavoriteEmbedsSyncStatus = 'idle' | 'syncing' | 'synced' | 'error';

let favoriteEmbedsSyncInFlight = false;

export function tryBeginFavoriteEmbedsSync(): boolean {
  if (favoriteEmbedsSyncInFlight) return false;
  favoriteEmbedsSyncInFlight = true;
  return true;
}

export function endFavoriteEmbedsSync(): void {
  favoriteEmbedsSyncInFlight = false;
}

export function dispatchFavoriteEmbedsSyncStatus(status: FavoriteEmbedsSyncStatus): void {
  window.dispatchEvent(
    new CustomEvent<FavoriteEmbedsSyncStatus>(FAVORITE_EMBEDS_SYNC_EVENT, { detail: status })
  );
}

const FAVORITE_KINDS = new Set<EmbedKind>(['image', 'giphy', 'tenor', 'link']);

export function embedSupportsFavorite(kind: EmbedKind): boolean {
  return FAVORITE_KINDS.has(kind);
}

export function favoriteFromParsedEmbed(embed: ParsedEmbed): FavoriteEmbed {
  return {
    url:
      embed.kind === 'tenor' || embed.kind === 'giphy'
        ? canonicalGifPageUrl(embed)
        : embed.url,
    kind: embed.kind,
    imageUrl: embed.imageUrl,
    giphyId: embed.giphyId,
    tenorId: embed.tenorId,
    savedAt: Date.now(),
  };
}

export async function enrichFavoriteEmbed(embed: ParsedEmbed): Promise<FavoriteEmbed> {
  let source = embed;
  if (embed.kind === 'image') {
    const reparsed = parseEmbed(embed.url);
    if (reparsed?.kind === 'tenor' || reparsed?.kind === 'giphy') {
      source = reparsed;
    }
  }

  const base = favoriteFromParsedEmbed(source);
  if (base.kind === 'tenor' || base.kind === 'giphy' || base.kind === 'image') {
    const mediaUrl = await resolveEmbedMediaUrl(source);
    if (mediaUrl) base.imageUrl = mediaUrl;
  }
  return base;
}

export function readFavoriteEmbeds(): FavoriteEmbed[] {
  try {
    const raw = localStorage.getItem(FAVORITE_EMBEDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FavoriteEmbed[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.url === 'string')
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  } catch {
    return [];
  }
}

export function writeFavoriteEmbeds(favorites: FavoriteEmbed[]): void {
  try {
    localStorage.setItem(FAVORITE_EMBEDS_KEY, JSON.stringify(favorites.slice(0, MAX_FAVORITES)));
    dispatchFavoriteEmbedsChange();
  } catch {
    // ignore storage errors
  }
}

export function dispatchFavoriteEmbedsChange(): void {
  window.dispatchEvent(new CustomEvent(FAVORITE_EMBEDS_EVENT));
}

export function isEmbedFavorited(url: string, favorites = readFavoriteEmbeds()): boolean {
  const key = normalizeUrlForMatch(url);
  return favorites.some((favorite) => normalizeUrlForMatch(favorite.url) === key);
}

export function toggleFavoriteEmbed(favorite: FavoriteEmbed): boolean {
  const list = readFavoriteEmbeds();
  const key = normalizeUrlForMatch(favorite.url);
  const existingIndex = list.findIndex((item) => normalizeUrlForMatch(item.url) === key);

  if (existingIndex >= 0) {
    list.splice(existingIndex, 1);
    writeFavoriteEmbeds(list);
    return false;
  }

  writeFavoriteEmbeds([favorite, ...list]);
  return true;
}

export function removeFavoriteEmbed(url: string): void {
  const key = normalizeUrlForMatch(url);
  writeFavoriteEmbeds(readFavoriteEmbeds().filter((favorite) => normalizeUrlForMatch(favorite.url) !== key));
}

export function previewUrlForFavorite(favorite: FavoriteEmbed): string | undefined {
  if (favorite.imageUrl) return favorite.imageUrl;
  if (favorite.giphyId) return `https://i.giphy.com/${favorite.giphyId}.gif`;
  if (favorite.tenorId) return undefined;
  const parsed = parseEmbed(favorite.url);
  if (parsed?.imageUrl) return parsed.imageUrl;
  return undefined;
}

export function mergeFavoriteEmbeds(
  local: FavoriteEmbed[],
  remote: FavoriteEmbed[]
): FavoriteEmbed[] {
  const byKey = new Map<string, FavoriteEmbed>();

  for (const favorite of [...local, ...remote]) {
    const key = normalizeUrlForMatch(favorite.url);
    const existing = byKey.get(key);
    if (!existing || (favorite.savedAt || 0) > (existing.savedAt || 0)) {
      byKey.set(key, favorite);
    }
  }

  return Array.from(byKey.values())
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
    .slice(0, MAX_FAVORITES);
}
