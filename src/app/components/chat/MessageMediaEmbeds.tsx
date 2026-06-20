import { useState } from 'react';
import { FileText, ExternalLink } from 'lucide-react';
import { openExternalLink } from '../../lib/openExternalLink';
import { VoiceMessagePlayer } from './VoiceMessagePlayer';
import { MediaLightbox } from './MediaLightbox';

export function MessageVideoEmbed({
  src,
  openUrl,
  inBubble = false,
  onLoad,
}: {
  src: string;
  openUrl: string;
  inBubble?: boolean;
  onLoad?: () => void;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  if (inBubble) {
    return (
      <>
        <video
          src={src}
          controls
          playsInline
          preload="metadata"
          className="max-h-48 w-full min-w-[12rem] max-w-[min(100%,16rem)] cursor-zoom-in rounded-xl"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setLightboxOpen(true)}
          onLoadedData={onLoad}
          onCanPlay={onLoad}
        />
        {lightboxOpen && (
          <MediaLightbox
            media={{ type: 'video', src, openUrl }}
            onClose={() => setLightboxOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div
        className="mt-1.5 w-full max-w-full overflow-hidden rounded-xl border border-black/10 dark:border-white/10 sm:max-w-[min(100%,24rem)]"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <video
          src={src}
          controls
          playsInline
          preload="metadata"
          className="max-h-80 w-full cursor-zoom-in bg-black/5 dark:bg-white/5"
          onClick={() => setLightboxOpen(true)}
          onLoadedData={onLoad}
          onCanPlay={onLoad}
        />
      </div>
      {lightboxOpen && (
        <MediaLightbox
          media={{ type: 'video', src, openUrl }}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}

export function MessageAudioEmbed({
  src,
  inBubble = false,
  isMe = false,
}: {
  src: string;
  inBubble?: boolean;
  isMe?: boolean;
}) {
  if (inBubble) {
    return <VoiceMessagePlayer src={src} isMe={isMe} />;
  }

  return (
    <div
      className="mt-1.5 w-full min-w-[12rem] max-w-full sm:max-w-[min(100%,20rem)]"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <VoiceMessagePlayer src={src} isMe={isMe} />
    </div>
  );
}

export function MessageFileEmbed({
  url,
  filename,
  inBubble = false,
}: {
  url: string;
  filename?: string;
  inBubble?: boolean;
}) {
  let label = filename || url;
  try {
    if (!filename) {
      label = decodeURIComponent(new URL(url).pathname.split('/').pop() || url);
    }
  } catch {
    // keep label
  }

  return (
    <button
      type="button"
      className={`flex w-full max-w-full items-center gap-3 rounded-xl bg-[#f2f3f5] p-3 text-left transition-colors hover:bg-[#ebedef] dark:bg-[#2b2d31] dark:hover:bg-[#313338] ${
        inBubble ? 'sm:max-w-[min(100%,20rem)]' : 'mt-1.5 border border-black/10 dark:border-white/10 sm:max-w-[min(100%,24rem)]'
      }`}
      onClick={(e) => openExternalLink(e, url)}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <FileText className="h-8 w-8 shrink-0 text-blyve" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{label}</p>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{url}</p>
      </div>
      <ExternalLink className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
    </button>
  );
}

export function MessageImageEmbed({
  src,
  openUrl,
  alt,
  inBubble = false,
  onFailed,
  onLoad,
}: {
  src: string;
  openUrl: string;
  alt: string;
  inBubble?: boolean;
  onFailed?: () => void;
  onLoad?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  if (failed) return null;

  return (
    <>
      <button
        type="button"
        className={
          inBubble
            ? 'block w-full max-w-full cursor-zoom-in overflow-hidden rounded-xl p-0 sm:max-w-[min(100%,20rem)]'
            : 'mt-1.5 block w-full max-w-full cursor-zoom-in overflow-hidden rounded-xl border border-black/10 p-0 dark:border-white/10 sm:max-w-[min(100%,24rem)]'
        }
        onClick={() => setLightboxOpen(true)}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={alt}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          className={`pointer-events-none w-full object-contain ${
            inBubble ? 'max-h-80 rounded-xl' : 'max-h-80 bg-black/5 dark:bg-white/5'
          }`}
          loading="lazy"
          onLoad={onLoad}
          onError={() => {
            setFailed(true);
            onFailed?.();
          }}
        />
      </button>
      {lightboxOpen && (
        <MediaLightbox
          media={{ type: 'image', src, alt, openUrl }}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}
