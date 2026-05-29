import { useState } from 'react';
import { FileText, ExternalLink } from 'lucide-react';
import { openExternalLink } from '../../lib/openExternalLink';

export function MessageVideoEmbed({
  src,
  openUrl,
  inBubble = false,
}: {
  src: string;
  openUrl: string;
  inBubble?: boolean;
}) {
  if (inBubble) {
    return (
      <video
        src={src}
        controls
        playsInline
        preload="metadata"
        className="max-h-48 w-full min-w-[12rem] max-w-[min(100%,16rem)] rounded-lg"
        onPointerDown={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <div
      className="mt-1.5 w-full max-w-full overflow-hidden rounded-xl border border-black/10 dark:border-white/10 sm:max-w-[min(100%,24rem)]"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <video
        src={src}
        controls
        playsInline
        preload="metadata"
        className="max-h-80 w-full bg-black/5 dark:bg-white/5"
      />
      <button
        type="button"
        className="mt-1 flex items-center gap-1 px-1 text-[11px] text-gray-500 hover:underline dark:text-gray-400"
        onClick={(e) => openExternalLink(e, openUrl)}
      >
        <ExternalLink className="h-3 w-3" aria-hidden />
        {openUrl}
      </button>
    </div>
  );
}

export function MessageAudioEmbed({ src, inBubble = false }: { src: string; inBubble?: boolean }) {
  if (inBubble) {
    return (
      <audio
        src={src}
        controls
        preload="metadata"
        className="voice-message-audio h-9 w-[min(100%,15rem)] min-w-[11rem] max-w-full"
        onPointerDown={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <div
      className="mt-1.5 w-full min-w-[12rem] max-w-full sm:max-w-[min(100%,20rem)]"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <audio src={src} controls preload="metadata" className="w-full" />
    </div>
  );
}

export function MessageFileEmbed({
  url,
  filename,
}: {
  url: string;
  filename?: string;
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
      className="mt-1.5 flex w-full max-w-full items-center gap-3 rounded-xl border border-black/10 bg-[#f2f3f5] p-3 text-left transition-colors hover:bg-[#ebedef] dark:border-white/10 dark:bg-[#2b2d31] dark:hover:bg-[#313338] sm:max-w-[min(100%,24rem)]"
      onClick={(e) => openExternalLink(e, url)}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <FileText className="h-8 w-8 shrink-0 text-orange-500" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{label}</p>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{url}</p>
      </div>
      <ExternalLink className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
    </button>
  );
}

export function MessageImageEmbed({ src, openUrl, alt }: { src: string; openUrl: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <button
      type="button"
      className="mt-1.5 block w-full max-w-full cursor-pointer overflow-hidden rounded-xl border border-black/10 p-0 dark:border-white/10 sm:max-w-[min(100%,24rem)]"
      onClick={(event) => openExternalLink(event, openUrl)}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={alt}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        className="pointer-events-none max-h-80 w-full object-contain bg-black/5 dark:bg-white/5"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </button>
  );
}
