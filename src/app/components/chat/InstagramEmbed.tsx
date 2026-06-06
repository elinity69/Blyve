import { useEffect, useState } from 'react';
import { ExternalLink, Instagram } from 'lucide-react';
import { openExternalLink } from '../../lib/openExternalLink';
import { api } from '../../lib/api';

// ─── oEmbed probe (server-proxied, no CORS) ────────────────────────────────────

interface OEmbedResult {
  author_name?: string;
  thumbnail_url?: string;
  title?: string;
}

const oEmbedCache = new Map<string, OEmbedResult | null>();
const oEmbedInflight = new Map<string, Promise<OEmbedResult | null>>();

async function fetchInstagramOEmbed(postUrl: string): Promise<OEmbedResult | null> {
  if (oEmbedCache.has(postUrl)) return oEmbedCache.get(postUrl) ?? null;
  const pending = oEmbedInflight.get(postUrl);
  if (pending) return pending;

  const promise = (async (): Promise<OEmbedResult | null> => {
    try {
      const data = await api.getSocialOEmbed('instagram', postUrl);
      if (!data || typeof data !== 'object') return null;
      return data as OEmbedResult;
    } catch {
      return null;
    }
  })();

  oEmbedInflight.set(postUrl, promise);
  const result = await promise;
  oEmbedCache.set(postUrl, result);
  oEmbedInflight.delete(postUrl);
  return result;
}

function instagramEmbedUrl(postId: string): string {
  return `https://www.instagram.com/p/${postId}/embed/captioned/?cr=1&v=14&rd=${encodeURIComponent('https://blyve.app')}`;
}

// ─── Fallback card ─────────────────────────────────────────────────────────────

function InstagramFallbackCard({ url, inBubble }: { url: string; inBubble: boolean }) {
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
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-tr from-[#f09433] via-[#e6683c] to-[#bc1888]">
          <Instagram className="h-5 w-5 text-white" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-blyve">
            Instagram
          </p>
          <p className="mt-0.5 line-clamp-1 text-sm font-medium text-gray-900 dark:text-white">
            View on Instagram
          </p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-gray-500 dark:text-gray-400">
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            instagram.com
          </p>
        </div>
      </div>
    </button>
  );
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function InstagramSkeleton({ inBubble }: { inBubble: boolean }) {
  return (
    <div
      className={`overflow-hidden rounded-xl ${
        inBubble ? '' : 'border border-black/10 dark:border-white/10'
      }`}
    >
      <div className="animate-pulse">
        <div className="flex items-center gap-2.5 bg-white px-3 py-2.5 dark:bg-[#1a1a1a]">
          <div className="h-8 w-8 rounded-full bg-black/10 dark:bg-white/10" />
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="h-2.5 w-24 rounded bg-black/10 dark:bg-white/10" />
            <div className="h-2 w-16 rounded bg-black/5 dark:bg-white/5" />
          </div>
        </div>
        <div className="aspect-square w-full bg-black/5 dark:bg-white/5" />
        <div className="flex gap-3 bg-white px-3 py-2.5 dark:bg-[#1a1a1a]">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-5 w-5 rounded bg-black/10 dark:bg-white/10" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

type EmbedState = 'loading' | 'ready' | 'fallback';

interface InstagramEmbedProps {
  postId: string;
  url: string;
  inBubble?: boolean;
}

/**
 * InstagramEmbed — renders Instagram's official captioned embed iframe.
 *
 * Flow:
 *  1. oEmbed probe via /social-oembed edge function (no CORS issues).
 *     Returns null for private / disabled / deleted posts → fallback card.
 *  2. On success → render instagram.com/p/<id>/embed/captioned/ iframe.
 *  3. iframe onError → fallback card.
 */
export function InstagramEmbed({ postId, url, inBubble = false }: InstagramEmbedProps) {
  const [state, setState] = useState<EmbedState>(() => {
    const cached = oEmbedCache.get(url);
    if (cached === null) return 'fallback';
    if (cached !== undefined) return 'ready';
    return 'loading';
  });

  useEffect(() => {
    if (state !== 'loading') return;
    let cancelled = false;
    void fetchInstagramOEmbed(url).then((result) => {
      if (!cancelled) setState(result ? 'ready' : 'fallback');
    });
    return () => { cancelled = true; };
  }, [url, state]);

  if (state === 'loading') return <InstagramSkeleton inBubble={inBubble} />;
  if (state === 'fallback') return <InstagramFallbackCard url={url} inBubble={inBubble} />;

  return (
    <div
      className={`overflow-hidden rounded-xl bg-white dark:bg-[#1a1a1a] ${
        inBubble ? '' : 'border border-black/10 dark:border-white/10'
      }`}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="relative w-full" style={{ minHeight: 400 }}>
        <iframe
          src={instagramEmbedUrl(postId)}
          title="Instagram post"
          className="block w-full border-0"
          style={{ height: 'max(400px, 100%)', maxWidth: 540, margin: '0 auto' }}
          scrolling="no"
          frameBorder={0}
          allowTransparency
          onError={() => setState('fallback')}
        />
      </div>
      <button
        type="button"
        className="flex w-full items-center justify-center gap-1.5 border-t border-black/5 bg-white px-3 py-2 text-[11px] font-medium text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:border-white/5 dark:bg-[#1a1a1a] dark:text-gray-400 dark:hover:bg-[#222] dark:hover:text-gray-200"
        onClick={(e) => openExternalLink(e, url)}
      >
        <Instagram className="h-3.5 w-3.5" aria-hidden />
        View on Instagram
        <ExternalLink className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
}
