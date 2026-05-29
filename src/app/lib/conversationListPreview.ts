import {
  getSuppressedUrls,
  isUrlHiddenByEmbeds,
  parseEmbed,
  parseMessageEmbeds,
  splitTextByUrls,
  type EmbedKind,
  type ParsedEmbed,
} from './linkEmbeds';

export type ConversationPreviewIcon =
  | 'gif'
  | 'image'
  | 'video'
  | 'audio'
  | 'file'
  | 'youtube'
  | 'spotify'
  | 'link';

export interface ConversationListPreviewLabels {
  gif: string;
  image: string;
  video: string;
  audio: string;
  file: string;
  youtube: string;
  spotify: string;
  link: string;
}

export interface ConversationListPreview {
  text: string;
  icon?: ConversationPreviewIcon;
}

function hasVisibleTextBesidesEmbeds(content: string, embeds: ParsedEmbed[]): boolean {
  const suppressUrls = getSuppressedUrls(content, embeds);
  const parts = splitTextByUrls(content);
  return parts.some(
    (part) =>
      (part.type === 'text' && part.value.trim().length > 0) ||
      (part.type === 'url' && !isUrlHiddenByEmbeds(part.value, suppressUrls, embeds)),
  );
}

function iconForEmbedKind(kind: EmbedKind): ConversationPreviewIcon | undefined {
  switch (kind) {
    case 'giphy':
    case 'tenor':
      return 'gif';
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'file':
      return 'file';
    case 'youtube':
      return 'youtube';
    case 'spotify':
      return 'spotify';
    case 'link':
      return 'link';
    default:
      return undefined;
  }
}

function labelForEmbedKind(kind: EmbedKind, labels: ConversationListPreviewLabels): string {
  switch (kind) {
    case 'giphy':
    case 'tenor':
      return labels.gif;
    case 'image':
      return labels.image;
    case 'video':
      return labels.video;
    case 'audio':
      return labels.audio;
    case 'file':
      return labels.file;
    case 'youtube':
      return labels.youtube;
    case 'spotify':
      return labels.spotify;
    case 'link':
      return labels.link;
    default:
      return labels.link;
  }
}

const EMBED_KIND_PRIORITY: Record<EmbedKind, number> = {
  youtube: 8,
  spotify: 7,
  giphy: 6,
  tenor: 6,
  video: 5,
  audio: 4,
  image: 3,
  file: 2,
  link: 1,
};

function previewFromEmbeds(
  embeds: ParsedEmbed[],
  labels: ConversationListPreviewLabels,
): ConversationListPreview | null {
  if (embeds.length === 0) return null;

  const primary = embeds.reduce((best, embed) =>
    EMBED_KIND_PRIORITY[embed.kind] > EMBED_KIND_PRIORITY[best.kind] ? embed : best,
  );
  return {
    text: labelForEmbedKind(primary.kind, labels),
    icon: iconForEmbedKind(primary.kind),
  };
}

/** Human-readable preview for the conversation list (no raw media URLs). */
export function getConversationListPreview(
  content: string | null | undefined,
  labels: ConversationListPreviewLabels,
): ConversationListPreview {
  const raw = (content || '').trim();
  if (!raw) return { text: '' };

  const embeds = parseMessageEmbeds(raw);
  if (!hasVisibleTextBesidesEmbeds(raw, embeds)) {
    const fromEmbeds = previewFromEmbeds(embeds, labels);
    if (fromEmbeds) return fromEmbeds;

    const lone = parseEmbed(raw);
    if (lone) {
      return {
        text: labelForEmbedKind(lone.kind, labels),
        icon: iconForEmbedKind(lone.kind),
      };
    }
  }

  return { text: raw };
}
