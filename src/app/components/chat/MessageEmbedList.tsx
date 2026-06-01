import { useEffect, useState, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import type { LinkPreviewData, ParsedEmbed } from '../../lib/linkEmbeds';
import { api } from '../../lib/api';
import { openExternalLink } from '../../lib/openExternalLink';
import { EmbedContextMenuWrapper } from './EmbedContextMenu';
import { EmbedFavoriteButton } from './EmbedFavoriteButton';
import { YouTubeEmbed } from './YouTubeEmbed';
import { SpotifyEmbed } from './SpotifyEmbed';
import {
  MessageAudioEmbed,
  MessageFileEmbed,
  MessageImageEmbed,
  MessageVideoEmbed,
} from './MessageMediaEmbeds';
import { GifMediaEmbed } from './GifMediaEmbed';
import { embedSupportsFavorite } from '../../lib/favoriteEmbeds';
import { parseEmbed } from '../../lib/linkEmbeds';

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

function LinkPreviewCard({
  preview,
  inBubble = false,
}: {
  preview: LinkPreviewData;
  inBubble?: boolean;
}) {
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
      className={`flex w-full cursor-pointer overflow-hidden rounded-xl bg-[#f2f3f5] p-0 text-left transition-colors hover:bg-[#ebedef] dark:bg-[#2b2d31] dark:hover:bg-[#313338] ${
        inBubble ? '' : 'border border-black/10 dark:border-white/10'
      }`}
      onClick={(event) => openExternalLink(event, preview.url)}
    >
      {!inBubble ? <div className="w-1 shrink-0 bg-blyve" aria-hidden /> : null}
      <div className="flex min-w-0 flex-1 gap-3 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-blyve">
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

function LinkPreviewEmbed({ url, inBubble = false }: { url: string; inBubble?: boolean }) {
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
      <div
        className={`h-16 animate-pulse rounded-xl bg-black/5 dark:bg-white/5 ${
          inBubble ? '' : 'border border-black/10 dark:border-white/10'
        }`}
      />
    );
  }

  if (preview) return <LinkPreviewCard preview={preview} inBubble={inBubble} />;

  let hostname = url;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // keep raw url
  }

  return (
    <button
      type="button"
      className={`flex w-full cursor-pointer overflow-hidden rounded-xl bg-[#f2f3f5] p-3 text-left transition-colors hover:bg-[#ebedef] dark:bg-[#2b2d31] dark:hover:bg-[#313338] ${
        inBubble ? '' : 'border border-black/10 dark:border-white/10'
      }`}
      onClick={(event) => openExternalLink(event, url)}
    >
      {!inBubble ? <div className="w-1 shrink-0 rounded-full bg-blyve" aria-hidden /> : null}
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

function MessageEmbedItem({
  embed,
  inBubble,
  isMe,
}: {
  embed: ParsedEmbed;
  inBubble?: boolean;
  isMe?: boolean;
}) {
  let content: ReactNode = null;

  switch (embed.kind) {
    case 'giphy':
    case 'tenor':
      content = <GifMediaEmbed embed={embed} inBubble={inBubble} />;
      break;
    case 'image': {
      const reparsed = parseEmbed(embed.url);
      if (reparsed?.kind === 'tenor' || reparsed?.kind === 'giphy') {
        content = <GifMediaEmbed embed={{ ...reparsed, url: embed.url }} inBubble={inBubble} />;
      } else {
        content = (
          <MessageImageEmbed
            src={embed.imageUrl || embed.url}
            openUrl={embed.url}
            alt="Shared image"
            inBubble={inBubble}
          />
        );
      }
      break;
    }
    case 'video':
      content = (
        <MessageVideoEmbed src={embed.url} openUrl={embed.url} inBubble={inBubble} />
      );
      break;
    case 'audio':
      content = <MessageAudioEmbed src={embed.url} inBubble={inBubble} isMe={isMe} />;
      break;
    case 'file':
      content = <MessageFileEmbed url={embed.url} inBubble={inBubble} />;
      break;
    case 'youtube':
      content = embed.youtubeId ? (
        <YouTubeEmbed videoId={embed.youtubeId} inBubble={inBubble} />
      ) : null;
      break;
    case 'spotify':
      content =
        embed.spotifyType && embed.spotifyId ? (
          <SpotifyEmbed type={embed.spotifyType} id={embed.spotifyId} inBubble={inBubble} />
        ) : null;
      break;
    case 'link':
      content = <LinkPreviewEmbed url={embed.url} inBubble={inBubble} />;
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
  /** Inside a chat bubble — no extra chrome, no URL footers. */
  inBubble?: boolean;
  isMe?: boolean;
}

export function MessageEmbedList({ embeds, inBubble = false, isMe = false }: MessageEmbedListProps) {
  if (embeds.length === 0) return null;

  return (
    <div
      className={
        inBubble
          ? 'flex w-full min-w-0 flex-col gap-1'
          : 'mt-1.5 flex w-full max-w-full flex-col gap-2 sm:max-w-[min(100%,24rem)]'
      }
      onPointerDown={(event) => event.stopPropagation()}
    >
      {embeds.map((embed) => (
        <MessageEmbedItem
          key={`${embed.kind}-${embed.url}`}
          embed={embed}
          inBubble={inBubble}
          isMe={isMe}
        />
      ))}
    </div>
  );
}
