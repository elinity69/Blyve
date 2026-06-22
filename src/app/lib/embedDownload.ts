import type { EmbedKind, ParsedEmbed } from './linkEmbeds';
import { resolveEmbedMediaUrl } from './embedMediaResolver';

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

export async function resolveEmbedDownloadUrl(embed: ParsedEmbed): Promise<string | null> {
  return resolveEmbedMediaUrl(embed);
}

export async function downloadMediaFile(mediaUrl: string, filename?: string): Promise<boolean> {
  const name = filename || filenameFromUrl(mediaUrl);

  // Convert Supabase storage URLs to the download endpoint to force-download via Content-Disposition attachment.
  let targetUrl = mediaUrl;
  if (targetUrl.includes('/storage/v1/object/public/')) {
    targetUrl = targetUrl.replace('/storage/v1/object/public/', '/storage/v1/object/download/public/');
  } else if (targetUrl.includes('/storage/v1/object/sign/')) {
    targetUrl = targetUrl.replace('/storage/v1/object/sign/', '/storage/v1/object/download/sign/');
  } else if (targetUrl.includes('/storage/v1/object/authenticated/')) {
    targetUrl = targetUrl.replace('/storage/v1/object/authenticated/', '/storage/v1/object/download/authenticated/');
  }

  // If it is a Supabase download URL, we can just trigger a direct click/download without fetching!
  if (targetUrl !== mediaUrl) {
    try {
      const anchor = document.createElement('a');
      anchor.href = targetUrl;
      anchor.download = name;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      return true;
    } catch {
      return false;
    }
  }

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
