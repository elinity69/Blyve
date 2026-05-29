export type EmbedKind =
  | 'image'
  | 'youtube'
  | 'spotify'
  | 'tenor'
  | 'giphy'
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
const VIDEO_EXT = /\.(mp4|webm|mov)(\?.*)?$/i;
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
  if (host === 'giphy.com' || host === 'media.giphy.com') {
    if (url.pathname.startsWith('/embed/')) {
      return url.pathname.split('/')[2] || null;
    }
    const match = url.pathname.match(/\/gifs\/(?:.+-)?([A-Za-z0-9]+)$/);
    return match?.[1] || null;
  }
  if (host === 'gph.is') {
    return null;
  }
  return null;
}

function parseTenorId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, '');
  if (host !== 'tenor.com') return null;
  if (url.pathname.startsWith('/embed/')) {
    return url.pathname.split('/')[2] || null;
  }
  const match = url.pathname.match(/\/view\/.+-(\d+)$/);
  return match?.[1] || null;
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

    const giphyId = parseGiphyId(parsed);
    if (giphyId) {
      return {
        url,
        kind: 'giphy',
        giphyId,
        imageUrl: `https://media.giphy.com/media/${giphyId}/giphy.gif`,
      };
    }

    const tenorId = parseTenorId(parsed);
    if (tenorId) {
      return { url, kind: 'tenor', tenorId };
    }

    if (isDirectImageUrl(parsed)) {
      return { url, kind: 'image', imageUrl: resolveImageUrl(parsed) };
    }

    if (VIDEO_EXT.test(parsed.pathname)) {
      return { url, kind: 'video' };
    }

    if (AUDIO_EXT.test(parsed.pathname)) {
      return { url, kind: 'audio' };
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
