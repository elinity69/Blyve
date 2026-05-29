import { api } from './api';

export type MediaUploadKind = 'image' | 'gif' | 'video' | 'audio' | 'file';

/** For `<input accept={CHAT_MEDIA_ACCEPT}>` — validation also runs server-side. */
export const CHAT_MEDIA_ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,' +
  'video/mp4,video/webm,video/quicktime,' +
  'audio/webm,audio/ogg,audio/mpeg,audio/mp4,audio/wav,' +
  'application/pdf,text/plain,application/zip';

export type DmUploadContext = {
  type: 'dm';
  conversationId: string;
};

export type GroupUploadContext = {
  type: 'group';
  groupId: string;
  channelId: string;
};

export type MediaUploadContext = DmUploadContext | GroupUploadContext;

export interface ConfirmedUpload {
  attachmentId: string;
  publicUrl: string | null;
  kind: MediaUploadKind;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
}

function contextPayload(ctx: MediaUploadContext): Record<string, string> {
  if (ctx.type === 'dm') {
    return { conversation_id: ctx.conversationId };
  }
  return { group_id: ctx.groupId, channel_id: ctx.channelId };
}

/**
 * Presign → PUT to R2 (no secrets in browser) → confirm → metadata in Supabase.
 */
export async function uploadChatMedia(
  file: File,
  ctx: MediaUploadContext,
): Promise<ConfirmedUpload> {
  const presign = await api.requestUploadPresign({
    mimeType: file.type,
    sizeBytes: file.size,
    filename: file.name,
    ...contextPayload(ctx),
  });

  await api.putFileToPresignedUrl(presign.uploadUrl, file, presign.headers);

  const confirmed = await api.confirmUpload(presign.attachmentId);
  return {
    attachmentId: confirmed.attachmentId,
    publicUrl: confirmed.publicUrl,
    kind: confirmed.kind as MediaUploadKind,
    mimeType: confirmed.mimeType,
    sizeBytes: confirmed.sizeBytes,
    storageKey: confirmed.storageKey,
  };
}

export async function uploadChatMediaBatch(
  files: File[],
  ctx: MediaUploadContext,
): Promise<ConfirmedUpload[]> {
  const results: ConfirmedUpload[] = [];
  for (const file of files) {
    results.push(await uploadChatMedia(file, ctx));
  }
  return results;
}
