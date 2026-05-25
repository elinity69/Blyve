import type { EmbedKind, ParsedEmbed } from './linkEmbeds';

const DOWNLOADABLE_KINDS = new Set<EmbedKind>(['image', 'giphy', 'tenor']);

export function embedSupportsDownload(kind: EmbedKind): boolean {
  return DOWNLOADABLE_KINDS.has(kind);
}

function filenameFromUrl(url: string, fallbackExt = 'gif'): string {
  try {
    const pathname = new URL(url).pathname;
    const base = pathname.split('/').pop() || `media.${fallbackExt}`;
    return base.includes('.') ? base : `${base}.${fallbackExt}`;
  } catch {
    return `media.${fallbackExt}`;
  }
}

async function resolveTenorDownloadUrl(embed: ParsedEmbed): Promise<string | null> {
  const candidates = [
    embed.url,
    embed.tenorId ? `https://tenor.com/embed/${embed.tenorId}` : null,
  ].filter(Boolean) as string[];

  for (const pageUrl of candidates) {
    try {
      const response = await fetch(
        `https://tenor.com/oembed?url=${encodeURIComponent(pageUrl)}`
      );
      if (!response.ok) continue;

      const data = (await response.json()) as { thumbnail_url?: string; html?: string };
      if (data.thumbnail_url) return data.thumbnail_url;

      const mediaMatch = data.html?.match(/https:\/\/media\.tenor\.com\/[^"'\s]+/i);
      if (mediaMatch?.[0]) return mediaMatch[0];
    } catch {
      // try next candidate
    }
  }

  return null;
}

export async function resolveEmbedDownloadUrl(embed: ParsedEmbed): Promise<string | null> {
  if (embed.kind === 'image' || embed.kind === 'giphy') {
    return embed.imageUrl || embed.url;
  }

  if (embed.kind === 'tenor') {
    return resolveTenorDownloadUrl(embed);
  }

  return null;
}

export async function downloadMediaFile(mediaUrl: string, filename?: string): Promise<boolean> {
  const name = filename || filenameFromUrl(mediaUrl);

  try {
    const response = await fetch(mediaUrl);
    if (!response.ok) throw new Error('fetch failed');

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(objectUrl);
    return true;
  } catch {
    try {
      const anchor = document.createElement('a');
      anchor.href = mediaUrl;
      anchor.download = name;
      anchor.rel = 'noopener noreferrer';
      anchor.target = '_blank';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      return true;
    } catch {
      return false;
    }
  }
}

export async function downloadEmbedMedia(embed: ParsedEmbed): Promise<boolean> {
  const mediaUrl = await resolveEmbedDownloadUrl(embed);
  if (!mediaUrl) return false;
  return downloadMediaFile(mediaUrl);
}
