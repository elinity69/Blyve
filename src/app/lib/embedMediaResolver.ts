import type { ParsedEmbed } from './linkEmbeds';
import { parseEmbed } from './linkEmbeds';
import { api } from './api';

const mediaCache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

interface TenorOembedPayload {
  thumbnail_url?: string;
  url?: string;
  html?: string;
}

function cacheKeyForEmbed(embed: ParsedEmbed): string {
  return [embed.kind, embed.url, embed.tenorId ?? '', embed.giphyId ?? '', embed.imageUrl ?? ''].join('|');
}

function extractTenorMediaFromHtml(html?: string): string | null {
  if (!html) return null;
  const gifMatch = html.match(/https:\/\/media\.tenor\.(?:com|co)\/[^"'\s]+\.gif[^"'\s]*/i);
  if (gifMatch?.[0]) return gifMatch[0];
  const mp4Match = html.match(/https:\/\/media\.tenor\.(?:com|co)\/[^"'\s]+\.mp4[^"'\s]*/i);
  if (mp4Match?.[0]) return mp4Match[0];
  const looseMatch = html.match(/https:\/\/media\.tenor\.(?:com|co)\/[^"'\s]+/i);
  return looseMatch?.[0] ?? null;
}

async function fetchTenorOembed(pageUrl: string): Promise<TenorOembedPayload | null> {
  try {
    const response = await fetch(
      `https://tenor.com/oembed?url=${encodeURIComponent(pageUrl)}`
    );
    if (!response.ok) return null;
    return (await response.json()) as TenorOembedPayload;
  } catch {
    return null;
  }
}

function tenorPageUrls(embed: ParsedEmbed): string[] {
  const urls = new Set<string>();
  if (embed.url) urls.add(embed.url);
  if (embed.tenorId) {
    urls.add(`https://tenor.com/embed/${embed.tenorId}`);
  }
  return Array.from(urls);
}

export async function resolveTenorMediaUrl(embed: ParsedEmbed): Promise<string | null> {
  for (const pageUrl of tenorPageUrls(embed)) {
    const data = await fetchTenorOembed(pageUrl);
    if (data) {
      const fromHtml = extractTenorMediaFromHtml(data.html);
      if (fromHtml) return fromHtml;
      if (data.thumbnail_url?.includes('.gif')) return data.thumbnail_url;
    }

    // Fallback: fetch link preview through our Edge function, which is CORS-free
    try {
      const preview = await api.getLinkPreview(pageUrl);
      if (preview?.image) {
        return preview.image;
      }
    } catch {
      // ignore and continue
    }
  }
  return null;
}

export function giphyDirectUrl(giphyId: string): string {
  return `https://i.giphy.com/${giphyId}.gif`;
}

export async function resolveGiphyMediaUrl(embed: ParsedEmbed): Promise<string | null> {
  if (embed.giphyId) return giphyDirectUrl(embed.giphyId);
  if (embed.imageUrl && !embed.imageUrl.includes('gph.is')) return embed.imageUrl;
  return embed.imageUrl ?? null;
}

/** Stable URL stored in messages / favorites (metadata only — no R2). */
export function canonicalGifPageUrl(embed: ParsedEmbed): string {
  if (embed.tenorId) return `https://tenor.com/embed/${embed.tenorId}`;
  if (embed.giphyId) return `https://giphy.com/gifs/${embed.giphyId}`;
  return embed.url;
}

export async function resolveEmbedMediaUrl(embed: ParsedEmbed): Promise<string | null> {
  const key = cacheKeyForEmbed(embed);
  if (mediaCache.has(key)) return mediaCache.get(key) ?? null;

  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    if (embed.imageUrl && embed.kind !== 'tenor') {
      if (embed.kind === 'giphy' && embed.giphyId) {
        return giphyDirectUrl(embed.giphyId);
      }
      return embed.imageUrl;
    }

    if (embed.kind === 'giphy') {
      return resolveGiphyMediaUrl(embed);
    }

    if (embed.kind === 'tenor') {
      const resolved = await resolveTenorMediaUrl(embed);
      if (resolved) return resolved;
      if (embed.imageUrl) return embed.imageUrl;
      return null;
    }

    if (embed.kind === 'image') {
      const reparsed = parseEmbed(embed.url);
      if (reparsed?.kind === 'tenor') {
        return resolveTenorMediaUrl(reparsed);
      }
      if (reparsed?.kind === 'giphy') {
        return resolveGiphyMediaUrl(reparsed);
      }

      try {
        const host = new URL(embed.url).hostname.replace(/^www\./, '');
        if (host === 'media.tenor.com' || host === 'media.tenor.co') {
          const data = await fetchTenorOembed(embed.url);
          const fromHtml = extractTenorMediaFromHtml(data?.html);
          if (fromHtml) return fromHtml;
        }
      } catch {
        // ignore
      }

      return embed.imageUrl ?? embed.url;
    }

    return embed.imageUrl ?? null;
  })()
    .then((url) => {
      mediaCache.set(key, url);
      return url;
    })
    .catch(() => {
      mediaCache.set(key, null);
      return null;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

export async function normalizeGifUrlForMessage(rawUrl: string): Promise<string> {
  const trimmed = rawUrl.trim();
  const embed = parseEmbed(trimmed);
  if (!embed) return trimmed;

  if (embed.kind === 'tenor' || embed.kind === 'giphy') {
    return canonicalGifPageUrl(embed);
  }

  if (embed.kind === 'image') {
    const host = (() => {
      try {
        return new URL(trimmed).hostname.replace(/^www\./, '');
      } catch {
        return '';
      }
    })();

    if (host === 'media.tenor.com' || host === 'media.tenor.co') {
      const reparsed = parseEmbed(trimmed);
      if (reparsed?.tenorId) return canonicalGifPageUrl(reparsed);
      return trimmed;
    }

    if (host === 'media.giphy.com' || host === 'i.giphy.com') {
      const reparsed = parseEmbed(trimmed);
      if (reparsed?.giphyId) return canonicalGifPageUrl(reparsed);
    }
  }

  return trimmed;
}

export function isAnimatedGifMediaUrl(url: string): boolean {
  return /\.(gif|mp4|webm)(\?|$)/i.test(url);
}
