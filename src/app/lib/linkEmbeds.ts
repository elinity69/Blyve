export type EmbedKind =
  | 'image'
  | 'youtube'
  | 'spotify'
  | 'tenor'
  | 'giphy'
  | 'instagram'
  | 'tiktok'
  | 'x'
  | 'video'
  | 'audio'
  | 'file'
  | 'link';

export interface ParsedEmbed {
  url: string;
  kind: EmbedKind;
  imageUrl?: string;
  youtubeId?: string;
  spotifyType?: 'track' | 'album' | 'playlist' | 'episode' | 'show';
  spotifyId?: string;
  giphyId?: string;
  tenorId?: string;
  instagramPostId?: string;
  tiktokVideoId?: string;
  tiktokAuthor?: string;
  xStatusId?: string;
  xAuthor?: string;
}

export interface LinkPreviewData {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

const URL_REGEX =
  /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?.*)?$/i;
// webm is only in AUDIO_EXT — voice memos use .webm and must not match as video first
const VIDEO_EXT = /\.(mp4|mov)(\?.*)?$/i;
const AUDIO_EXT = /\.(webm|ogg|mp3|m4a|wav)(\?.*)?$/i;
const FILE_EXT = /\.(pdf|txt|zip)(\?.*)?$/i;

const IMAGE_HOST_SUFFIXES = [
  'media.discordapp.net',
  'cdn.discordapp.com',
  'media.giphy.com',
  'media.tenor.com',
  'i.imgur.com',
  'imgur.com',
];

export function extractUrls(content: string): string[] {
  const matches = content.match(URL_REGEX);
  if (!matches) return [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of matches) {
    const cleaned = raw.replace(/[)\]}>,.!?;:]+$/, '');
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      urls.push(cleaned);
    }
  }
  return urls;
}

function parseYouTubeId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return id || null;
  }
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (url.pathname.startsWith('/watch')) {
      return url.searchParams.get('v');
    }
    if (url.pathname.startsWith('/shorts/')) {
      return url.pathname.split('/')[2] || null;
    }
    if (url.pathname.startsWith('/embed/')) {
      return url.pathname.split('/')[2] || null;
    }
  }
  return null;
}

function parseSpotify(url: URL): { type: ParsedEmbed['spotifyType']; id: string } | null {
  const host = url.hostname.replace(/^www\./, '');
  if (host !== 'open.spotify.com') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const type = parts[0] as ParsedEmbed['spotifyType'];
  const id = parts[1]?.split('?')[0];
  if (!id) return null;
  if (type === 'track' || type === 'album' || type === 'playlist' || type === 'episode' || type === 'show') {
    return { type, id };
  }
  return null;
}

function parseGiphyId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'giphy.com' || host === 'media.giphy.com' || host === 'i.giphy.com') {
    if (url.pathname.startsWith('/embed/')) {
      return url.pathname.split('/')[2] || null;
    }
    const mediaMatch = url.pathname.match(/\/media\/([A-Za-z0-9]+)\//);
    if (mediaMatch?.[1]) return mediaMatch[1];
    const directMatch = url.pathname.match(/^\/([A-Za-z0-9]+)\.gif$/);
    if (directMatch?.[1]) return directMatch[1];
    const pageMatch = url.pathname.match(/\/gifs\/(?:.+-)?([A-Za-z0-9]+)$/);
    return pageMatch?.[1] || null;
  }
  if (host === 'gph.is') {
    return null;
  }
  return null;
}

function parseTenorId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'tenor.com' || host === 'tenor.googleapis.com') {
    if (url.pathname.startsWith('/embed/')) {
      const id = url.pathname.split('/')[2]?.split('-')[0];
      return id || null;
    }
    if (url.pathname.startsWith('/view/')) {
      const match = url.pathname.match(/-(\d{5,})(?:\/)?$/);
      if (match?.[1]) return match[1];
    }
    const generic = url.pathname.match(/(\d{8,})/);
    if (generic?.[1]) return generic[1];
  }
  return null;
}

function isDirectImageUrl(url: URL): boolean {
  if (IMAGE_EXT.test(url.pathname)) return true;
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'media.giphy.com' || host === 'media.tenor.com') return true;
  if (host === 'i.imgur.com') return true;
  if (host === 'imgur.com' && url.pathname.length > 1 && !url.pathname.startsWith('/a/')) {
    return true;
  }
  return IMAGE_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`)
  );
}

function resolveImageUrl(url: URL): string {
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'imgur.com' && !IMAGE_EXT.test(url.pathname)) {
    const id = url.pathname.slice(1).split('/')[0];
    if (id) return `https://i.imgur.com/${id}.jpg`;
  }
  return url.toString();
}

/** Parse a TikTok video URL into author + video ID.
 *
 * Accepted shapes:
 *   tiktok.com/@<user>/video/<id>
 *   tiktok.com/@<user>/video/<id>?...
 *   vm.tiktok.com/<shortcode>            — short-links: no video ID, return null
 *     (vm.tiktok.com redirects to the full URL; short-links cannot be embedded
 *     directly because the video ID is only known after the redirect resolves,
 *     which requires a server-side follow. We treat them as generic link previews.)
 */
export function parseTikTokVideo(url: URL): { author: string; videoId: string } | null {
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host !== 'tiktok.com') return null;

  // /@<author>/video/<id>
  const match = url.pathname.match(/^\/@([^/]+)\/video\/(\d+)/);
  if (match?.[1] && match[2]) {
    return { author: match[1], videoId: match[2] };
  }
  return null;
}

/** Parse an X (formerly Twitter) status URL.
 *
 * Accepted shapes:
 *   x.com/<user>/status/<id>
 *   twitter.com/<user>/status/<id>
 *   mobile.twitter.com/<user>/status/<id>
 *   t.co/<shortcode>   — redirects; we cannot resolve them client-side, treat as link
 */
export function parseXStatus(url: URL): { author: string; statusId: string } | null {
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const isX = host === 'x.com';
  const isTwitter = host === 'twitter.com' || host === 'mobile.twitter.com';
  if (!isX && !isTwitter) return null;

  // /<user>/status/<id>
  const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
  if (match?.[1] && match[2]) {
    return { author: match[1], statusId: match[2] };
  }
  return null;
}


 *
 * Accepted shapes:
 *   instagram.com/p/<shortcode>
 *   instagram.com/reel/<shortcode>
 *   instagram.com/reels/<shortcode>
 *   instagram.com/tv/<shortcode>       (IGTV legacy)
 *   instagr.am/p/<shortcode>           (short-link redirect)
 *   instagram.com/stories/<user>/<id>  (stories — not embeddable, return null)
 */
export function parseInstagramPostId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host !== 'instagram.com' && host !== 'instagr.am') return null;

  const EMBEDDABLE = /^\/(p|reel|reels|tv)\//;
  const match = url.pathname.match(/^\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  if (match?.[2]) {
    // Validate shortcode: at least 8 chars, only base64url characters
    const shortcode = match[2];
    if (/^[A-Za-z0-9_-]{8,}$/.test(shortcode)) return shortcode;
  }
  // Stories are intentionally not embeddable
  if (/^\/stories\//.test(url.pathname)) return null;
  // Profile pages, explore, etc.
  if (!EMBEDDABLE.test(url.pathname)) return null;
  return null;
}

export function isInstagramUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    return host === 'instagram.com' || host === 'instagr.am';
  } catch {
    return false;
  }
}

export function parseEmbed(url: string): ParsedEmbed | null {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;

    const youtubeId = parseYouTubeId(parsed);
    if (youtubeId) {
      return { url, kind: 'youtube', youtubeId };
    }

    const spotify = parseSpotify(parsed);
    if (spotify) {
      return {
        url,
        kind: 'spotify',
        spotifyType: spotify.type,
        spotifyId: spotify.id,
      };
    }

    const tenorId = parseTenorId(parsed);
    if (tenorId) {
      return { url, kind: 'tenor', tenorId };
    }

    const giphyId = parseGiphyId(parsed);
    if (giphyId) {
      return {
        url,
        kind: 'giphy',
        giphyId,
        imageUrl: `https://i.giphy.com/${giphyId}.gif`,
      };
    }

    const instagramPostId = parseInstagramPostId(parsed);
    if (instagramPostId) {
      return { url, kind: 'instagram', instagramPostId };
    }

    const tiktok = parseTikTokVideo(parsed);
    if (tiktok) {
      return { url, kind: 'tiktok', tiktokVideoId: tiktok.videoId, tiktokAuthor: tiktok.author };
    }

    const xStatus = parseXStatus(parsed);
    if (xStatus) {
      return { url, kind: 'x', xStatusId: xStatus.statusId, xAuthor: xStatus.author };
    }

    if (isDirectImageUrl(parsed)) {
      return { url, kind: 'image', imageUrl: resolveImageUrl(parsed) };
    }

    if (AUDIO_EXT.test(parsed.pathname)) {
      return { url, kind: 'audio' };
    }

    if (VIDEO_EXT.test(parsed.pathname)) {
      return { url, kind: 'video' };
    }

    if (FILE_EXT.test(parsed.pathname)) {
      return { url, kind: 'file' };
    }

    return { url, kind: 'link' };
  } catch {
    return null;
  }
}

const EMBED_KIND_PRIORITY: Record<EmbedKind, number> = {
  youtube: 8,
  spotify: 7,
  giphy: 6,
  tenor: 5,
  instagram: 5,
  tiktok: 5,
  x: 5,
  video: 4,
  audio: 3,
  image: 2,
  file: 2,
  link: 1,
};

export function parseMessageEmbeds(content: string): ParsedEmbed[] {
  const urls = extractUrls(content);
  const byKey = new Map<string, ParsedEmbed>();

  for (const url of urls) {
    const embed = parseEmbed(url);
    if (!embed) continue;

    const key = normalizeUrlForMatch(embed.url);
    const existing = byKey.get(key);
    if (!existing || EMBED_KIND_PRIORITY[embed.kind] > EMBED_KIND_PRIORITY[existing.kind]) {
      byKey.set(key, embed);
    }
  }

  return Array.from(byKey.values());
}

export function normalizeUrlForMatch(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return url.trim().replace(/\/$/, '');
  }
}

export function shouldSuppressUrlInBubble(content: string, embed: ParsedEmbed): boolean {
  const trimmed = content.trim();
  const urls = extractUrls(content);
  if (urls.length !== 1) return false;
  const onlyUrl = urls[0];
  return trimmed === onlyUrl || trimmed === `${onlyUrl}/`;
}

export function getSuppressedUrls(content: string, embeds: ParsedEmbed[]): Set<string> {
  const suppressed = new Set<string>();
  if (embeds.length === 0) return suppressed;

  const embeddedKeys = new Set<string>();
  for (const embed of embeds) {
    embeddedKeys.add(normalizeUrlForMatch(embed.url));
    if (embed.imageUrl) {
      embeddedKeys.add(normalizeUrlForMatch(embed.imageUrl));
    }
  }

  for (const raw of extractUrls(content)) {
    if (embeddedKeys.has(normalizeUrlForMatch(raw))) {
      suppressed.add(raw);
    }
  }

  for (const embed of embeds) {
    if (shouldSuppressUrlInBubble(content, embed)) {
      suppressed.add(embed.url);
    }
  }

  return suppressed;
}

export function isUrlHiddenByEmbeds(
  url: string,
  suppressUrls: Set<string>,
  embeds: ParsedEmbed[]
): boolean {
  if (suppressUrls.has(url)) return true;
  const key = normalizeUrlForMatch(url);
  return embeds.some((embed) => {
    if (normalizeUrlForMatch(embed.url) === key) return true;
    if (embed.imageUrl && normalizeUrlForMatch(embed.imageUrl) === key) return true;
    return false;
  });
}

export function splitTextByUrls(content: string): Array<{ type: 'text' | 'url'; value: string }> {
  const parts: Array<{ type: 'text' | 'url'; value: string }> = [];
  let lastIndex = 0;
  const regex = new RegExp(URL_REGEX.source, 'gi');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: content.slice(lastIndex, match.index) });
    }
    const raw = match[0].replace(/[)\]}>,.!?;:]+$/, '');
    parts.push({ type: 'url', value: raw });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push({ type: 'text', value: content.slice(lastIndex) });
  }

  return parts.length > 0 ? parts : [{ type: 'text', value: content }];
}
