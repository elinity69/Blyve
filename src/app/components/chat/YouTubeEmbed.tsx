import { useState } from 'react';
import { Play } from 'lucide-react';
import { MEDIA_EMBED_IFRAME_ALLOW } from '../../lib/mediaEmbedAllow';

interface YouTubeEmbedProps {
  videoId: string;
  inBubble?: boolean;
}

function youtubeThumbnailUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/** Click-to-play iframe — defers YouTube's touch listeners until the user taps play. */
export function YouTubeEmbed({ videoId, inBubble = false }: YouTubeEmbedProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const origin = encodeURIComponent(
    typeof window !== 'undefined' ? window.location.origin : ''
  );
  const src = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1&autoplay=1&origin=${origin}`;

  return (
    <div
      className={`overflow-hidden rounded-xl bg-black ${
        inBubble ? '' : 'border border-black/10 dark:border-white/10'
      }`}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="relative aspect-video w-full">
        {isPlaying ? (
          <iframe
            src={src}
            title="YouTube video"
            className="h-full w-full border-0"
            allow={MEDIA_EMBED_IFRAME_ALLOW}
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            className="group relative block h-full w-full overflow-hidden"
            aria-label="Play YouTube video"
            onClick={() => setIsPlaying(true)}
          >
            <img
              src={youtubeThumbnailUrl(videoId)}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
              draggable={false}
            />
            <span className="absolute inset-0 bg-black/25 transition group-hover:bg-black/35 group-active:bg-black/45" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/70 text-white shadow-lg ring-1 ring-white/20 transition group-hover:scale-105 group-active:scale-95">
                <Play className="ml-0.5 h-7 w-7 fill-current" />
              </span>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
