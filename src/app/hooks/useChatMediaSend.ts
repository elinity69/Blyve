import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from '../lib/toast';
import {
  uploadChatMedia,
  uploadChatMediaBatch,
  type ConfirmedUpload,
  type MediaUploadContext,
} from '../lib/mediaUpload';
import { buildMessageContentForMedia, validateChatMediaFile } from '../lib/mediaTypes';

export function useChatMediaSend(
  context: MediaUploadContext | null,
  sendWithAttachments: (
    content: string,
    attachmentIds: string[],
    replyToMessageId: string | null,
  ) => Promise<boolean>,
) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const [uploadLabel, setUploadLabel] = useState<string | null>(null);
  const abortRef = useRef(false);

  const sendFiles = useCallback(
    async (
      files: File[],
      options?: { caption?: string; replyToMessageId?: string | null },
    ): Promise<boolean> => {
      if (!context || files.length === 0 || uploading) return false;

      const caption = options?.caption?.trim() ?? '';
      const replyToMessageId = options?.replyToMessageId ?? null;

      for (const file of files) {
        const v = validateChatMediaFile(file);
        if (!v.ok) {
          toast.error(t('chat.mediaUploadFailedTitle'), t(v.errorKey));
          return false;
        }
      }

      setUploading(true);
      abortRef.current = false;

      try {
        let uploads: ConfirmedUpload[];
        if (files.length === 1) {
          setUploadLabel(t('chat.mediaUploadingOne'));
          uploads = [await uploadChatMedia(files[0], context)];
        } else {
          setUploadLabel(t('chat.mediaUploadingMany', { count: files.length }));
          uploads = await uploadChatMediaBatch(files, context);
        }

        if (abortRef.current) return false;

        const withoutUrl = uploads.filter((u) => !u.publicUrl);
        if (withoutUrl.length > 0) {
          toast.error(
            t('chat.mediaUploadFailedTitle'),
            t('chat.mediaMissingPublicUrl'),
          );
          return false;
        }

        const content = buildMessageContentForMedia(uploads, caption);
        const attachmentIds = uploads.map((u) => u.attachmentId);
        const ok = await sendWithAttachments(content, attachmentIds, replyToMessageId);
        if (!ok) {
          toast.error(t('chat.mediaSendFailedTitle'), t('chat.mediaSendFailedBody'));
        }
        return ok;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(t('chat.mediaUploadFailedTitle'), msg);
        return false;
      } finally {
        setUploading(false);
        setUploadLabel(null);
      }
    },
    [context, uploading, sendWithAttachments, t],
  );

  const sendVoiceMemo = useCallback(
    async (blob: Blob, replyToMessageId?: string | null): Promise<boolean> => {
      const file = new File([blob], `voice-${Date.now()}.webm`, {
        type: blob.type || 'audio/webm',
      });
      return sendFiles([file], { replyToMessageId: replyToMessageId ?? null });
    },
    [sendFiles],
  );

  const cancelUpload = useCallback(() => {
    abortRef.current = true;
  }, []);

  return {
    sendFiles,
    sendVoiceMemo,
    uploading,
    uploadLabel,
    cancelUpload,
  };
}
