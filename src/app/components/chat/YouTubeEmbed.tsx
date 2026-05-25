import { MEDIA_EMBED_IFRAME_ALLOW } from '../../lib/mediaEmbedAllow';

interface YouTubeEmbedProps {
  videoId: string;
}

/** Plain iframe embed — no YouTube IFrame API (avoids postMessage noise on localhost). */
export function YouTubeEmbed({ videoId }: YouTubeEmbedProps) {
  const origin = encodeURIComponent(
    typeof window !== 'undefined' ? window.location.origin : ''
  );
  const src = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1&origin=${origin}`;

  return (
    <div
      className="overflow-hidden rounded-xl border border-black/10 dark:border-white/10 bg-black"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="aspect-video w-full">
        <iframe
          src={src}
          title="YouTube video"
          className="h-full w-full border-0"
          loading="lazy"
          allow={MEDIA_EMBED_IFRAME_ALLOW}
          allowFullScreen
        />
      </div>
    </div>
  );
}
