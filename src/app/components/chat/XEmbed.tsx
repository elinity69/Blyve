import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { openExternalLink } from '../../lib/openExternalLink';
import { api } from '../../lib/api';

// ─── oEmbed probe ──────────────────────────────────────────────────────────────

interface OEmbedResult {
  author_name?: string;
  html?: string;
}

const oEmbedCache = new Map<string, OEmbedResult | null>();
const oEmbedInflight = new Map<string, Promise<OEmbedResult | null>>();

async function fetchXOEmbed(tweetUrl: string): Promise<OEmbedResult | null> {
  if (oEmbedCache.has(tweetUrl)) return oEmbedCache.get(tweetUrl) ?? null;
  const pending = oEmbedInflight.get(tweetUrl);
  if (pending) return pending;

  const promise = (async (): Promise<OEmbedResult | null> => {
    try {
      const data = await api.getSocialOEmbed('x', tweetUrl);
      if (!data || typeof data !== 'object') return null;
      return data as OEmbedResult;
    } catch {
      return null;
    }
  })();

  oEmbedInflight.set(tweetUrl, promise);
  const result = await promise;
  oEmbedCache.set(tweetUrl, result);
  oEmbedInflight.delete(tweetUrl);
  return result;
}

function xEmbedUrl(statusId: string, author: string): string {
  const postUrl = encodeURIComponent(`https://x.com/${author}/status/${statusId}`);
  return `https://platform.twitter.com/embed/Tweet.html?id=${statusId}&theme=dark&dnt=true&referrer=${encodeURIComponent('https://blyve.app')}&url=${postUrl}`;
}

// ─── X brand icon ──────────────────────────────────────────────────────────────

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L2.25 2.25h6.951l4.258 5.629L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  );
}

// ─── Fallback card ─────────────────────────────────────────────────────────────

function XFallbackCard({ url, inBubble }: { url: string; inBubble: boolean }) {
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
          <XIcon className="h-[18px] w-[18px] text-white dark:text-black" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-blyve">
            X (Twitter)
          </p>
          <p className="mt-0.5 line-clamp-1 text-sm font-medium text-gray-900 dark:text-white">
            View post on X
          </p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-gray-500 dark:text-gray-400">
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            x.com
          </p>
        </div>
      </div>
    </button>
  );
}

// ─── Skeleton ──────────────────────────────────────────────────────────────────

function XSkeleton({ inBubble }: { inBubble: boolean }) {
  return (
    <div
      className={`overflow-hidden rounded-xl ${
        inBubble ? '' : 'border border-black/10 dark:border-white/10'
      }`}
    >
      <div className="animate-pulse bg-[#15202b] p-4">
        <div className="flex items-center gap-2.5">
          <div className="h-10 w-10 rounded-full bg-white/10" />
          <div className="flex flex-col gap-1.5">
            <div className="h-3 w-28 rounded bg-white/10" />
            <div className="h-2.5 w-20 rounded bg-white/5" />
          </div>
          <div className="ml-auto h-5 w-5 rounded bg-white/10" />
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <div className="h-3 w-full rounded bg-white/10" />
          <div className="h-3 w-4/5 rounded bg-white/10" />
          <div className="h-3 w-3/5 rounded bg-white/5" />
        </div>
        <div className="mt-3 h-2.5 w-32 rounded bg-white/5" />
        <div className="mt-3 flex gap-5 border-t border-white/10 pt-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-3.5 w-12 rounded bg-white/10" />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

type EmbedState = 'loading' | 'ready' | 'fallback';

interface XEmbedProps {
  statusId: string;
  author: string;
  url: string;
  inBubble?: boolean;
}

/**
 * XEmbed — renders X's official tweet embed iframe.
 *
 * Flow:
 *  1. oEmbed probe via /social-oembed edge function.
 *     Returns null for protected accounts / deleted tweets → fallback card.
 *  2. On success → render platform.twitter.com/embed/Tweet.html?id=<id>.
 *  3. iframe onError → fallback card.
 *
 * Dark theme is baked into the iframe URL to match Blyve's dark UI.
 */
export function XEmbed({ statusId, author, url, inBubble = false }: XEmbedProps) {
  const [state, setState] = useState<EmbedState>(() => {
    const cached = oEmbedCache.get(url);
    if (cached === null) return 'fallback';
    if (cached !== undefined) return 'ready';
    return 'loading';
  });

  useEffect(() => {
    if (state !== 'loading') return;
    let cancelled = false;
    void fetchXOEmbed(url).then((result) => {
      if (!cancelled) setState(result ? 'ready' : 'fallback');
    });
    return () => { cancelled = true; };
  }, [url, state]);

  if (state === 'loading') return <XSkeleton inBubble={inBubble} />;
  if (state === 'fallback') return <XFallbackCard url={url} inBubble={inBubble} />;

  return (
    <div
      className={`overflow-hidden rounded-2xl bg-[#15202b] ${
        inBubble ? '' : 'border border-black/10 dark:border-white/10'
      }`}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="relative w-full" style={{ minHeight: 200 }}>
        <iframe
          src={xEmbedUrl(statusId, author)}
          title="X post"
          className="block w-full border-0"
          style={{ minHeight: 200, height: 550 }}
          scrolling="no"
          frameBorder={0}
          allow="fullscreen"
          onError={() => setState('fallback')}
        />
      </div>
      <button
        type="button"
        className="flex w-full items-center justify-center gap-1.5 border-t border-white/10 bg-[#15202b] px-3 py-2 text-[11px] font-medium text-gray-400 transition-colors hover:bg-[#1a2733] hover:text-white"
        onClick={(e) => openExternalLink(e, url)}
      >
        <XIcon className="h-3 w-3" />
        View on X
        <ExternalLink className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
}
