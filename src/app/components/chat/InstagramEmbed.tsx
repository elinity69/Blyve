import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Instagram } from 'lucide-react';
import { openExternalLink } from '../../lib/openExternalLink';
import { api } from '../../lib/api';

// ─── Background availability probe ────────────────────────────────────────────
//
// The probe runs in parallel with the iframe — it does NOT gate rendering.
// If the probe returns false before the iframe loads, we show the fallback card.
// If the iframe loads first (fires onLoad), we keep it regardless of probe result.
// This gives instant embed rendering for public posts with zero extra wait.

const probeCache = new Map<string, boolean | null>(); // null = inflight
const probeInflight = new Map<string, Promise<boolean>>();

async function probeInstagramUrl(postUrl: string): Promise<boolean> {
  if (probeCache.has(postUrl)) return probeCache.get(postUrl) ?? false;
  const pending = probeInflight.get(postUrl);
  if (pending) return pending;

  const promise = (async (): Promise<boolean> => {
    try {
      probeCache.set(postUrl, null);
      const data = await api.getSocialOEmbed('instagram', postUrl);
      const ok = data !== null && typeof data === 'object';
      probeCache.set(postUrl, ok);
      return ok;
    } catch {
      probeCache.set(postUrl, false);
      return false;
    }
  })();

  probeInflight.set(postUrl, promise);
  const result = await promise;
  probeInflight.delete(postUrl);
  return result;
}

// ─── Embed URL ─────────────────────────────────────────────────────────────────

function instagramEmbedUrl(postId: string): string {
  // Instagram accepts /p/<shortcode>/embed/ for both posts AND reels.
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

// ─── Skeleton overlay (sits on top of the iframe while it loads) ───────────────

function InstagramSkeletonOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 animate-pulse overflow-hidden rounded-xl">
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
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

interface InstagramEmbedProps {
  postId: string;
  url: string;
  inBubble?: boolean;
}

/**
 * InstagramEmbed — renders Instagram's official captioned embed iframe
 * for public posts and reels.
 *
 * Strategy (probe-parallel, never probe-gated):
 *  1. Render the embed iframe immediately — no waiting for any probe.
 *  2. Show a skeleton overlay until the iframe fires onLoad.
 *  3. In parallel, run a server-side probe via /social-oembed (HEAD request
 *     to the embed URL itself, no token required, no dead API calls).
 *  4. If probe returns false AND the iframe has not loaded yet → fallback card.
 *  5. If the iframe loads before the probe finishes → keep the embed always.
 *  6. If the iframe fires onError → fallback card.
 *
 * This means public posts show the real embed with only the iframe's own
 * network time as latency. Private/deleted posts fall back cleanly.
 */
export function InstagramEmbed({ postId, url, inBubble = false }: InstagramEmbedProps) {
  // iframeLoaded: true once onLoad fires (keep embed permanently)
  const [iframeLoaded, setIframeLoaded] = useState(false);
  // showFallback: true when we know we should not show the iframe
  const [showFallback, setShowFallback] = useState(() => probeCache.get(url) === false);
  const iframeLoadedRef = useRef(false);

  useEffect(() => {
    // If we already know from cache it's not embeddable, stop here
    if (probeCache.get(url) === false) {
      setShowFallback(true);
      return;
    }
    // If the cache says it IS embeddable (true), nothing to do — iframe is already rendering
    if (probeCache.get(url) === true) return;

    // Otherwise run the probe in parallel with the iframe
    let cancelled = false;
    void probeInstagramUrl(url).then((ok) => {
      if (cancelled) return;
      if (!ok && !iframeLoadedRef.current) {
        // Probe says not embeddable and iframe hasn't loaded yet → fallback
        setShowFallback(true);
      }
    });
    return () => { cancelled = true; };
  }, [url]);

  if (showFallback) {
    return <InstagramFallbackCard url={url} inBubble={inBubble} />;
  }

  return (
    <div
      className={`overflow-hidden rounded-xl bg-white dark:bg-[#1a1a1a] ${
        inBubble ? '' : 'border border-black/10 dark:border-white/10'
      }`}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/*
       * Container has a fixed minHeight so the skeleton has stable dimensions.
       * Instagram's embed iframe resizes itself via postMessage — we cannot read
       * that cross-origin, so we set height to a generous value and let the iframe
       * overflow-scroll internally.  max-width 540px is Instagram's own constraint.
       */}
      <div className="relative w-full" style={{ minHeight: 400 }}>
        {!iframeLoaded && <InstagramSkeletonOverlay />}
        <iframe
          key={postId}
          src={instagramEmbedUrl(postId)}
          title="Instagram post"
          className="block w-full border-0"
          style={{
            minHeight: 400,
            height: 540,
            maxWidth: 540,
            margin: '0 auto',
            display: 'block',
          }}
          scrolling="no"
          frameBorder={0}
          allow="encrypted-media"
          onLoad={() => {
            iframeLoadedRef.current = true;
            setIframeLoaded(true);
          }}
          onError={() => setShowFallback(true)}
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
