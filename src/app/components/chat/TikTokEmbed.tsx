import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { openExternalLink } from '../../lib/openExternalLink';
import { api } from '../../lib/api';

// ─── oEmbed probe ──────────────────────────────────────────────────────────────

interface OEmbedResult {
  author_name?: string;
  thumbnail_url?: string;
  title?: string;
}

const oEmbedCache = new Map<string, OEmbedResult | null>();
const oEmbedInflight = new Map<string, Promise<OEmbedResult | null>>();

async function fetchTikTokOEmbed(videoUrl: string): Promise<OEmbedResult | null> {
  if (oEmbedCache.has(videoUrl)) return oEmbedCache.get(videoUrl) ?? null;
  const pending = oEmbedInflight.get(videoUrl);
  if (pending) return pending;

  const promise = (async (): Promise<OEmbedResult | null> => {
    try {
      const data = await api.getSocialOEmbed('tiktok', videoUrl);
      if (!data || typeof data !== 'object') return null;
      return data as OEmbedResult;
    } catch {
      return null;
    }
  })();

  oEmbedInflight.set(videoUrl, promise);
  const result = await promise;
  oEmbedCache.set(videoUrl, result);
  oEmbedInflight.delete(videoUrl);
  return result;
}

function tiktokEmbedUrl(videoId: string): string {
  return `https://www.tiktok.com/embed/v2/${videoId}?lang=en-US&referrer=https%3A%2F%2Fblyve.app`;
}

// ─── TikTok brand icon ─────────────────────────────────────────────────────────

function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.27 8.27 0 0 0 4.83 1.54V6.78a4.85 4.85 0 0 1-1.06-.09z" />
    </svg>
  );
}

// ─── Fallback card ─────────────────────────────────────────────────────────────

function TikTokFallbackCard({ url, inBubble }: { url: string; inBubble: boolean }) {
  return (
    <button
      type="button"
      className={`flex w-full cursor-pointer overflow-hidden rounded-xl bg-[#f2f3f5] p-0 text-left transition-colors hover:bg-[#ebedef] dark:bg-[#2b2d31] dark:hover:bg-[#313338] ${
        inBubble ? '' : 'border border-black/10 dark:border-white/10'
      }`}
      onClick={(e) => openExternalLink(e, url)}
    >
      {!inBubble && <div className="w-1 shrink-0 bg-blyve" aria-hidden />}
      <div className="flex min-w-0 flex-1 items-center gap-3 p-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-black dark:bg-white">
          <TikTokIcon className="h-5 w-5 text-white dark:text-black" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-blyve">
            TikTok
          </p>
          <p className="mt-0.5 line-clamp-1 text-sm font-medium text-gray-900 dark:text-white">
            Watch on TikTok
          </p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-gray-500 dark:text-gray-400">
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            tiktok.com
          </p>
        </div>
      </div>
    </button>
  );
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function TikTokSkeleton({ inBubble }: { inBubble: boolean }) {
  return (
    <div
      className={`overflow-hidden rounded-xl ${
        inBubble ? '' : 'border border-black/10 dark:border-white/10'
      }`}
    >
      <div
        className="relative mx-auto animate-pulse bg-[#161823]"
        style={{ maxWidth: 325, aspectRatio: '9/16', minHeight: 580 }}
      >
        <div className="absolute bottom-24 right-3 flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-8 w-8 rounded-full bg-white/10" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

type EmbedState = 'loading' | 'ready' | 'fallback';

interface TikTokEmbedProps {
  videoId: string;
  url: string;
  inBubble?: boolean;
}

/**
 * TikTokEmbed — renders TikTok's official v2 embed iframe.
 *
 * Flow:
 *  1. oEmbed probe via /social-oembed edge function.
 *     Returns null for private/deleted → fallback card.
 *  2. On success → render tiktok.com/embed/v2/<videoId>.
 *  3. iframe onError → fallback card.
 */
export function TikTokEmbed({ videoId, url, inBubble = false }: TikTokEmbedProps) {
  const [state, setState] = useState<EmbedState>(() => {
    const cached = oEmbedCache.get(url);
    if (cached === null) return 'fallback';
    if (cached !== undefined) return 'ready';
    return 'loading';
  });

  useEffect(() => {
    if (state !== 'loading') return;
    let cancelled = false;
    void fetchTikTokOEmbed(url).then((result) => {
      if (!cancelled) setState(result ? 'ready' : 'fallback');
    });
    return () => { cancelled = true; };
  }, [url, state]);

  if (state === 'loading') return <TikTokSkeleton inBubble={inBubble} />;
  if (state === 'fallback') return <TikTokFallbackCard url={url} inBubble={inBubble} />;

  return (
    <div
      className={`overflow-hidden rounded-xl bg-black ${
        inBubble ? '' : 'border border-black/10 dark:border-white/10'
      }`}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="relative mx-auto w-full"
        style={{ maxWidth: 325, aspectRatio: '9/16', minHeight: 580 }}
      >
        <iframe
          src={tiktokEmbedUrl(videoId)}
          title="TikTok video"
          className="absolute inset-0 h-full w-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          onError={() => setState('fallback')}
        />
      </div>
      <button
        type="button"
        className="flex w-full items-center justify-center gap-1.5 border-t border-white/10 bg-black px-3 py-2 text-[11px] font-medium text-gray-400 transition-colors hover:bg-[#111] hover:text-white"
        onClick={(e) => openExternalLink(e, url)}
      >
        <TikTokIcon className="h-3.5 w-3.5" />
        Watch on TikTok
        <ExternalLink className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
}
