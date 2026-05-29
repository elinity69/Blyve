import type { MediaUploadKind } from './mediaUpload';

export const MEDIA_MAX_BYTES: Record<MediaUploadKind, number> = {
  image: 10 * 1024 * 1024,
  gif: 15 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  file: 50 * 1024 * 1024,
};

const MIME_TO_KIND: Array<{ mime: string; kind: MediaUploadKind }> = [
  { mime: 'image/gif', kind: 'gif' },
  { mime: 'image/jpeg', kind: 'image' },
  { mime: 'image/png', kind: 'image' },
  { mime: 'image/webp', kind: 'image' },
  { mime: 'image/heic', kind: 'image' },
  { mime: 'image/heif', kind: 'image' },
  { mime: 'video/mp4', kind: 'video' },
  { mime: 'video/webm', kind: 'video' },
  { mime: 'video/quicktime', kind: 'video' },
  { mime: 'audio/webm', kind: 'audio' },
  { mime: 'audio/ogg', kind: 'audio' },
  { mime: 'audio/mpeg', kind: 'audio' },
  { mime: 'audio/mp4', kind: 'audio' },
  { mime: 'audio/wav', kind: 'audio' },
  { mime: 'audio/x-m4a', kind: 'audio' },
  { mime: 'application/pdf', kind: 'file' },
  { mime: 'text/plain', kind: 'file' },
  { mime: 'application/zip', kind: 'file' },
];

export function inferMediaKindFromFile(file: File): MediaUploadKind | null {
  const mime = (file.type || '').toLowerCase().split(';')[0].trim();
  if (mime) {
    const hit = MIME_TO_KIND.find((e) => e.mime === mime);
    if (hit) return hit.kind;
    if (mime.startsWith('image/')) return mime === 'image/gif' ? 'gif' : 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
  }
  const name = file.name.toLowerCase();
  if (name.endsWith('.gif')) return 'gif';
  if (/\.(jpe?g|png|webp|heic|heif)$/.test(name)) return 'image';
  if (/\.(mp4|webm|mov)$/.test(name)) return 'video';
  if (/\.(webm|ogg|mp3|m4a|wav)$/.test(name)) return 'audio';
  if (/\.(pdf|txt|zip)$/.test(name)) return 'file';
  return null;
}

export function validateChatMediaFile(
  file: File,
): { ok: true; kind: MediaUploadKind } | { ok: false; errorKey: string } {
  const kind = inferMediaKindFromFile(file);
  if (!kind) {
    return { ok: false, errorKey: 'chat.mediaUnsupportedType' };
  }
  if (file.size <= 0) {
    return { ok: false, errorKey: 'chat.mediaEmptyFile' };
  }
  if (file.size > MEDIA_MAX_BYTES[kind]) {
    return { ok: false, errorKey: 'chat.mediaTooLarge' };
  }
  return { ok: true, kind };
}

export function buildMessageContentForMedia(
  uploads: Array<{ publicUrl: string | null; kind: MediaUploadKind }>,
  caption?: string,
): string {
  const trimmedCaption = caption?.trim() ?? '';
  const primaryUrl = uploads.find((u) => u.publicUrl)?.publicUrl;
  if (trimmedCaption && primaryUrl) {
    return `${trimmedCaption}\n${primaryUrl}`;
  }
  if (trimmedCaption) return trimmedCaption;
  if (primaryUrl) return primaryUrl;
  return uploads[0]?.publicUrl || '📎';
}
