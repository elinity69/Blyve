import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Film, ImagePlus, Loader2, Mic, Send, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FavoriteEmbedsPicker } from './FavoriteEmbedsPicker';
import { useFavoriteEmbeds } from '../../hooks/useFavoriteEmbeds';
import { MOBILE_VV_CSS } from '../../lib/mobileViewport';
import { useMobileViewportDriver } from '../../hooks/useMobileViewportInsets';
import { useIsMobile } from '../ui/use-mobile';
import { CHAT_MEDIA_ACCEPT } from '../../lib/mediaUpload';
import { validateChatMediaFile } from '../../lib/mediaTypes';
import { toast } from '../../lib/toast';
import { acquireVoiceMemoStream, releaseVoiceMemoStream } from '../../lib/voiceMemoMedia';

interface ChatMessageComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  onSendUrl: (url: string) => void | Promise<void>;
  onSendFiles: (files: File[], caption?: string) => void | Promise<void>;
  onSendVoiceMemo: (blob: Blob) => void | Promise<void>;
  placeholder: string;
  sending: boolean;
  mediaUploading?: boolean;
  mediaUploadLabel?: string | null;
  inputRef?: RefObject<HTMLInputElement | null>;
  replyBar?: ReactNode;
  typingIndicator?: ReactNode;
  dropActive?: boolean;
  onDropActiveChange?: (active: boolean) => void;
}

export function ChatMessageComposer({
  value,
  onChange,
  onSend,
  onSendUrl,
  onSendFiles,
  onSendVoiceMemo,
  placeholder,
  sending,
  mediaUploading = false,
  mediaUploadLabel,
  inputRef,
  replyBar,
  typingIndicator,
  dropActive = false,
  onDropActiveChange,
}: ChatMessageComposerProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const isMobile = useIsMobile();
  useMobileViewportDriver(isMobile);
  const [inVisualViewportShell, setInVisualViewportShell] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [stagedPreviews, setStagedPreviews] = useState<string[]>([]);
  const { syncStatus, isCloudEnabled } = useFavoriteEmbeds();
  const showSyncDot = isCloudEnabled && syncStatus === 'syncing';

  const hasText = value.trim().length > 0;
  const busy = sending || mediaUploading;
  const showSendButton = hasText && !recording;
  const showMicButton = !hasText && !recording && !mediaUploading;

  useLayoutEffect(() => {
    setInVisualViewportShell(
      !!rootRef.current?.closest('[data-visual-viewport-shell]'),
    );
  }, []);

  useEffect(() => {
    if (!recording) {
      setRecordingSeconds(0);
      return undefined;
    }
    const id = window.setInterval(() => {
      setRecordingSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [recording]);

  useEffect(() => {
    return () => {
      stagedPreviews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [stagedPreviews]);

  const composerPaddingBottom = isMobile
    ? inVisualViewportShell
      ? 'max(0.5rem, env(safe-area-inset-bottom, 0px))'
      : `max(0.5rem, var(${MOBILE_VV_CSS.bottomInset}, env(safe-area-inset-bottom, 0px)))`
    : 'max(0.5rem, env(safe-area-inset-bottom, 0px))';

  const clearStaged = useCallback(() => {
    stagedPreviews.forEach((url) => URL.revokeObjectURL(url));
    setStagedFiles([]);
    setStagedPreviews([]);
  }, [stagedPreviews]);

  const processFileList = useCallback(
    async (list: FileList | File[]) => {
      const files = Array.from(list);
      if (files.length === 0) return;

      const valid: File[] = [];
      for (const file of files) {
        const v = validateChatMediaFile(file);
        if (!v.ok) {
          toast.error(t('chat.mediaUploadFailedTitle'), t(v.errorKey));
          continue;
        }
        valid.push(file);
      }
      if (valid.length === 0) return;

      const previews = valid.map((f) =>
        f.type.startsWith('image/') || f.type.startsWith('video/')
          ? URL.createObjectURL(f)
          : '',
      );
      setStagedFiles(valid);
      setStagedPreviews(previews);
    },
    [t],
  );

  const confirmStagedSend = useCallback(async () => {
    if (stagedFiles.length === 0) return;
    const files = stagedFiles;
    const caption = value.trim();
    clearStaged();
    await onSendFiles(files, caption || undefined);
    if (caption) onChange('');
  }, [stagedFiles, value, clearStaged, onSendFiles, onChange]);

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onDropActiveChange?.(true);
  };

  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget === event.target) {
      onDropActiveChange?.(false);
    }
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    onDropActiveChange?.(false);
    if (event.dataTransfer.files?.length) {
      const files = Array.from(event.dataTransfer.files);
      const valid: File[] = [];
      for (const file of files) {
        const v = validateChatMediaFile(file);
        if (!v.ok) {
          toast.error(t('chat.mediaUploadFailedTitle'), t(v.errorKey));
          continue;
        }
        valid.push(file);
      }
      if (valid.length > 0) {
        void onSendFiles(valid, value.trim() || undefined);
        if (value.trim()) onChange('');
      }
    }
  };

  const stopRecording = useCallback(
    async (send: boolean) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        setRecording(false);
        releaseVoiceMemoStream();
        voiceStreamRef.current = null;
        return;
      }
      const done = new Promise<Blob>((resolve) => {
        recorder.addEventListener(
          'stop',
          () => {
            const blob = new Blob(voiceChunksRef.current, {
              type: recorder.mimeType || 'audio/webm',
            });
            voiceChunksRef.current = [];
            resolve(blob);
          },
          { once: true },
        );
      });
      recorder.stop();
      mediaRecorderRef.current = null;
      setRecording(false);
      releaseVoiceMemoStream();
      voiceStreamRef.current = null;

      const blob = await done;
      if (send && blob.size > 0) {
        await onSendVoiceMemo(blob);
      }
    },
    [onSendVoiceMemo],
  );

  useEffect(() => {
    return () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
      mediaRecorderRef.current = null;
      releaseVoiceMemoStream();
      voiceStreamRef.current = null;
    };
  }, []);

  const startRecording = useCallback(async () => {
    if (busy || recording) return;
    const stream = await acquireVoiceMemoStream();
    if (!stream) {
      toast.error(t('chat.voiceMemoFailedTitle'), t('chat.voiceMemoMicDenied'));
      return;
    }
    voiceStreamRef.current = stream;
    try {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      voiceChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) voiceChunksRef.current.push(e.data);
      };
      recorder.onerror = () => {
        mediaRecorderRef.current = null;
        setRecording(false);
        releaseVoiceMemoStream();
        voiceStreamRef.current = null;
        toast.error(t('chat.voiceMemoFailedTitle'), t('chat.voiceMemoFailedBody'));
      };
      mediaRecorderRef.current = recorder;
      recorder.start(200);
      setRecording(true);
    } catch {
      releaseVoiceMemoStream();
      voiceStreamRef.current = null;
      toast.error(t('chat.voiceMemoFailedTitle'), t('chat.voiceMemoFailedBody'));
    }
  }, [busy, recording, t]);

  return (
    <div
      ref={rootRef}
      className={`relative z-20 shrink-0 border-t border-gray-200 blyve-border-subtle blyve-screen-bg px-4 pt-2 ${
        dropActive ? 'ring-2 ring-inset ring-orange-400/60' : ''
      }`}
      style={{ paddingBottom: composerPaddingBottom }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dropActive ? (
        <div
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-orange-500/10 backdrop-blur-[1px]"
          aria-hidden
        >
          <p className="rounded-full bg-white/90 px-4 py-2 text-sm font-medium text-orange-600 shadow dark:bg-black/80 dark:text-orange-400">
            {t('chat.dropToSend')}
          </p>
        </div>
      ) : null}

      {typingIndicator}
      {replyBar}

      {stagedFiles.length > 0 ? (
        <div className="mb-2 flex items-end gap-2 overflow-x-auto pb-1">
          {stagedFiles.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-100 dark:border-white/10 dark:bg-[#1a1a1a]"
            >
              {stagedPreviews[index] ? (
                file.type.startsWith('video/') ? (
                  <video
                    src={stagedPreviews[index]}
                    className="h-full w-full object-cover"
                    muted
                  />
                ) : (
                  <img
                    src={stagedPreviews[index]}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-500">
                  {file.name.slice(0, 8)}
                </div>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={clearStaged}
            className="shrink-0 rounded-full p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10"
            aria-label={t('chat.cancelStagedMedia')}
          >
            <X className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirmStagedSend()}
            className="shrink-0 rounded-full bg-gradient-to-br from-orange-500 to-pink-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {t('chat.sendStagedMedia')}
          </button>
        </div>
      ) : null}

      {recording ? (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-red-50 px-3 py-2 dark:bg-red-500/10">
          <span className="text-sm font-medium text-red-600 dark:text-red-400">
            {t('chat.voiceMemoRecording', { seconds: recordingSeconds })}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void stopRecording(false)}
              className="rounded-full p-2 text-gray-600 hover:bg-black/5 dark:text-gray-300"
              aria-label={t('chat.voiceMemoCancel')}
            >
              <X className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => void stopRecording(true)}
              className="rounded-full bg-red-500 p-2 text-white"
              aria-label={t('chat.voiceMemoSend')}
            >
              <Send className="h-5 w-5" />
            </button>
          </div>
        </div>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={CHAT_MEDIA_ACCEPT}
        multiple
        onChange={(e) => {
          if (e.target.files?.length) {
            void processFileList(e.target.files);
          }
          e.target.value = '';
        }}
      />

      <div className="relative flex w-full items-center gap-1.5 sm:gap-2">
        <FavoriteEmbedsPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={(url) => void onSendUrl(url)}
        />

        <button
          type="button"
          aria-label={t('chat.openFavoriteEmbeds')}
          aria-expanded={pickerOpen}
          title={t('chat.gifButton')}
          className={`relative shrink-0 rounded-full px-2.5 py-2.5 text-xs font-bold tracking-wide transition-colors ${
            pickerOpen
              ? 'bg-orange-100 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400'
              : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10'
          }`}
          onClick={() => setPickerOpen((open) => !open)}
          style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
        >
          <span className="flex items-center gap-0.5">
            <Film className="h-4 w-4" aria-hidden />
            GIF
          </span>
          {showSyncDot ? (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-orange-500 ring-2 ring-white dark:ring-[#0d0d0d]" />
          ) : null}
        </button>

        <button
          type="button"
          aria-label={t('chat.openMediaPicker')}
          className="shrink-0 rounded-full p-2.5 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
        >
          <ImagePlus className="h-5 w-5" aria-hidden />
        </button>

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && hasText) {
              event.preventDefault();
              void onSend();
            }
          }}
          onFocus={() => {
            window.dispatchEvent(
              new CustomEvent('chat-composer-focus', { detail: { smooth: isMobile } }),
            );
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-full bg-gray-100 px-4 py-2 text-gray-900 focus:outline-none dark:bg-[#1a1a1a] dark:text-[#dce6ef]"
          style={{
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
            fontSize: '16px',
          }}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />

        {mediaUploading ? (
          <div
            className="flex shrink-0 flex-col items-center justify-center rounded-full p-2"
            title={mediaUploadLabel || undefined}
          >
            <Loader2 className="h-6 w-6 animate-spin text-orange-500" />
          </div>
        ) : showSendButton ? (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void onSend()}
            disabled={busy}
            className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 via-red-500 to-pink-500 p-3 disabled:opacity-50"
            style={{
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
            }}
            aria-label={t('chat.sendMessage')}
          >
            {sending ? (
              <Loader2 className="h-5 w-5 animate-spin text-white" />
            ) : (
              <Send className="h-5 w-5 text-white" />
            )}
          </button>
        ) : recording ? (
          <button
            type="button"
            onClick={() => void stopRecording(true)}
            className="flex shrink-0 items-center justify-center rounded-full bg-red-500 p-3"
            aria-label={t('chat.voiceMemoSend')}
          >
            <Square className="h-5 w-5 fill-white text-white" />
          </button>
        ) : showMicButton ? (
          <button
            type="button"
            onClick={() => void startRecording()}
            disabled={busy}
            className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 via-red-500 to-pink-500 p-3 disabled:opacity-50"
            aria-label={t('chat.voiceMemoStart')}
            style={{
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <Mic className="h-5 w-5 text-white" />
          </button>
        ) : (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void onSend()}
            disabled={!hasText || busy}
            className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 via-red-500 to-pink-500 p-3 disabled:opacity-50"
            aria-label={t('chat.sendMessage')}
          >
            <Send className="h-5 w-5 text-white" />
          </button>
        )}
      </div>
      {mediaUploadLabel ? (
        <p className="mt-1 truncate text-center text-[11px] text-gray-500 dark:text-gray-400">
          {mediaUploadLabel}
        </p>
      ) : null}
    </div>
  );
}
