import { useEffect, useState, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import type { LinkPreviewData, ParsedEmbed } from '../../lib/linkEmbeds';
import { api } from '../../lib/api';
import { openExternalLink } from '../../lib/openExternalLink';
import { EmbedContextMenuWrapper } from './EmbedContextMenu';
import { EmbedFavoriteButton } from './EmbedFavoriteButton';
import { YouTubeEmbed } from './YouTubeEmbed';
import { SpotifyEmbed } from './SpotifyEmbed';
import { embedSupportsFavorite } from '../../lib/favoriteEmbeds';

const previewCache = new Map<string, LinkPreviewData | null>();
const inflight = new Map<string, Promise<LinkPreviewData | null>>();

async function fetchLinkPreview(url: string): Promise<LinkPreviewData | null> {
  if (previewCache.has(url)) {
    return previewCache.get(url) ?? null;
  }

  const pending = inflight.get(url);
  if (pending) return pending;

  const promise = api
    .getLinkPreview(url)
    .then((data) => {
      previewCache.set(url, data);
      return data;
    })
    .catch(() => {
      previewCache.set(url, null);
      return null;
    })
    .finally(() => {
      inflight.delete(url);
    });

  inflight.set(url, promise);
  return promise;
}

function ImageEmbed({ src, openUrl, alt }: { src: string; openUrl: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    <button
      type="button"
      className="block w-full cursor-pointer overflow-hidden rounded-xl border border-black/10 p-0 dark:border-white/10"
      onClick={(event) => openExternalLink(event, openUrl)}
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

function TenorEmbed({ id }: { id: string }) {
  return (
    <div
      className="aspect-video w-full max-h-80 overflow-hidden rounded-xl border border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <iframe
        src={`https://tenor.com/embed/${id}`}
        title="Tenor GIF"
        className="h-full w-full"
        loading="lazy"
        allowFullScreen
      />
    </div>
  );
}

function LinkPreviewCard({ preview }: { preview: LinkPreviewData }) {
  const hostname = (() => {
    try {
      return new URL(preview.url).hostname.replace(/^www\./, '');
    } catch {
      return preview.siteName || 'Link';
    }
  })();

  return (
    <button
      type="button"
      className="flex w-full cursor-pointer overflow-hidden rounded-xl border border-black/10 bg-[#f2f3f5] p-0 text-left transition-colors hover:bg-[#ebedef] dark:border-white/10 dark:bg-[#2b2d31] dark:hover:bg-[#313338]"
      onClick={(event) => openExternalLink(event, preview.url)}
    >
      <div className="w-1 shrink-0 bg-orange-500" aria-hidden />
      <div className="flex min-w-0 flex-1 gap-3 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-orange-600 dark:text-orange-400">
            {preview.siteName || hostname}
          </p>
          {preview.title ? (
            <p className="mt-0.5 line-clamp-2 text-sm font-semibold text-gray-900 dark:text-white">
              {preview.title}
            </p>
          ) : null}
          {preview.description ? (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
              {preview.description}
            </p>
          ) : null}
          <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-gray-500 dark:text-gray-400">
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            {hostname}
          </p>
        </div>
        {preview.image ? (
          <img
            src={preview.image}
            alt=""
            className="pointer-events-none h-16 w-16 shrink-0 rounded-lg object-cover"
            loading="lazy"
          />
        ) : null}
      </div>
    </button>
  );
}

function LinkPreviewEmbed({ url }: { url: string }) {
  const [preview, setPreview] = useState<LinkPreviewData | null | undefined>(
    previewCache.get(url)
  );

  useEffect(() => {
    let cancelled = false;
    void fetchLinkPreview(url).then((data) => {
      if (!cancelled) setPreview(data);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (preview === undefined) {
    return (
      <div className="h-16 animate-pulse rounded-xl border border-black/10 bg-black/5 dark:border-white/10 dark:bg-white/5" />
    );
  }

  if (preview) return <LinkPreviewCard preview={preview} />;

  let hostname = url;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // keep raw url
  }

  return (
    <button
      type="button"
      className="flex w-full cursor-pointer overflow-hidden rounded-xl border border-black/10 bg-[#f2f3f5] p-3 text-left transition-colors hover:bg-[#ebedef] dark:border-white/10 dark:bg-[#2b2d31] dark:hover:bg-[#313338]"
      onClick={(event) => openExternalLink(event, url)}
    >
      <div className="w-1 shrink-0 rounded-full bg-orange-500" aria-hidden />
      <div className="min-w-0 pl-3">
        <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">{hostname}</p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-gray-500 dark:text-gray-400">
          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
          {url}
        </p>
      </div>
    </button>
  );
}

function MessageEmbedItem({ embed }: { embed: ParsedEmbed }) {
  let content: ReactNode = null;

  switch (embed.kind) {
    case 'image':
    case 'giphy':
      content = (
        <ImageEmbed
          src={embed.imageUrl || embed.url}
          openUrl={embed.url}
          alt="Shared image"
        />
      );
      break;
    case 'youtube':
      content = embed.youtubeId ? <YouTubeEmbed videoId={embed.youtubeId} /> : null;
      break;
    case 'spotify':
      content =
        embed.spotifyType && embed.spotifyId ? (
          <SpotifyEmbed type={embed.spotifyType} id={embed.spotifyId} />
        ) : null;
      break;
    case 'tenor':
      content = embed.tenorId ? <TenorEmbed id={embed.tenorId} /> : null;
      break;
    case 'link':
      content = <LinkPreviewEmbed url={embed.url} />;
      break;
    default:
      content = null;
  }

  if (!content) return null;

  return (
    <div className="relative w-full">
      {embedSupportsFavorite(embed.kind) ? <EmbedFavoriteButton embed={embed} /> : null}
      <EmbedContextMenuWrapper embed={embed}>{content}</EmbedContextMenuWrapper>
    </div>
  );
}

interface MessageEmbedListProps {
  embeds: ParsedEmbed[];
}

export function MessageEmbedList({ embeds }: MessageEmbedListProps) {
  if (embeds.length === 0) return null;

  return (
    <div
      className="mt-1.5 flex w-full max-w-[min(100%,24rem)] flex-col gap-2"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {embeds.map((embed) => (
        <MessageEmbedItem key={`${embed.kind}-${embed.url}`} embed={embed} />
      ))}
    </div>
  );
}
