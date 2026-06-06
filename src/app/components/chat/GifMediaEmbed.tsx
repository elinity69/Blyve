import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { ParsedEmbed } from '../../lib/linkEmbeds';
import {
  isAnimatedGifMediaUrl,
  resolveEmbedMediaUrl,
} from '../../lib/embedMediaResolver';
import { openExternalLink } from '../../lib/openExternalLink';
import { MessageImageEmbed } from './MessageMediaEmbeds';
import { MediaLightbox } from './MediaLightbox';

function GifLoadFailedFallback({
  url,
  inBubble,
}: {
  url: string;
  inBubble?: boolean;
}) {
  let hostname = url;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // keep raw
  }

  return (
    <button
      type="button"
      className={`flex w-full cursor-pointer items-center gap-2 rounded-xl bg-black/5 p-3 text-left dark:bg-white/5 ${
        inBubble ? '' : 'border border-black/10 dark:border-white/10'
      }`}
      onClick={(event) => openExternalLink(event, url)}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <ExternalLink className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-700 dark:text-gray-200">GIF</p>
        <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">{hostname}</p>
      </div>
    </button>
  );
}

function GifVideoEmbed({
  src,
  openUrl,
  inBubble,
  onFailed,
}: {
  src: string;
  openUrl: string;
  inBubble?: boolean;
  onFailed: () => void;
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);

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
        onPointerDown={(event) => event.stopPropagation()}
      >
        <video
          src={src}
          className={`pointer-events-none w-full object-contain ${
            inBubble ? 'max-h-80 rounded-xl' : 'max-h-80 bg-black/5 dark:bg-white/5'
          }`}
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          onError={onFailed}
        />
      </button>
      {lightboxOpen && (
        <MediaLightbox
          media={{ type: 'gif-video', src, openUrl }}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </>
  );
}

export function GifMediaEmbed({
  embed,
  inBubble = false,
}: {
  embed: ParsedEmbed;
  inBubble?: boolean;
}) {
  const [src, setSrc] = useState<string | undefined>(() => embed.imageUrl);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(!embed.imageUrl);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setLoading(true);

    void resolveEmbedMediaUrl(embed).then((resolved) => {
      if (cancelled) return;
      if (resolved) setSrc(resolved);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [embed.url, embed.kind, embed.tenorId, embed.giphyId, embed.imageUrl]);

  if (failed) {
    return <GifLoadFailedFallback url={embed.url} inBubble={inBubble} />;
  }

  if (loading && !src) {
    return (
      <div
        className={`h-32 w-full max-w-full animate-pulse rounded-xl bg-black/5 dark:bg-white/5 ${
          inBubble ? '' : 'border border-black/10 dark:border-white/10'
        }`}
      />
    );
  }

  if (!src) {
    return <GifLoadFailedFallback url={embed.url} inBubble={inBubble} />;
  }

  if (isAnimatedGifMediaUrl(src) && /\.mp4|\.webm/i.test(src)) {
    return (
      <GifVideoEmbed
        src={src}
        openUrl={embed.url}
        inBubble={inBubble}
        onFailed={() => setFailed(true)}
      />
    );
  }

  return (
    <MessageImageEmbed
      src={src}
      openUrl={embed.url}
      alt="GIF"
      inBubble={inBubble}
      onFailed={() => setFailed(true)}
    />
  );
}
