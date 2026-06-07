import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useEmbedMediaVolume } from '../../hooks/useEmbedMediaVolume';
import { readEmbedMediaVolume } from '../../lib/embedMediaVolume';
import { SPOTIFY_EMBED_IFRAME_ALLOW } from '../../lib/mediaEmbedAllow';
import {
  loadSpotifyIframeApi,
  spotifyPlayerHeight,
  spotifyUriForType,
  type SpotifyEmbedController,
} from '../../lib/spotifyIframeApi';
import { api } from '../../lib/api';

// ─── spotify.link short-link resolver ─────────────────────────────────────────

const shortLinkCache = new Map<string, { type: string; id: string } | null>();

async function resolveSpotifyShortLink(
  shortUrl: string,
): Promise<{ type: string; id: string } | null> {
  if (shortLinkCache.has(shortUrl)) return shortLinkCache.get(shortUrl) ?? null;
  try {
    const preview = await api.getLinkPreview(shortUrl);
    const canonical: string | undefined = (preview as { url?: string })?.url;
    if (!canonical) { shortLinkCache.set(shortUrl, null); return null; }
    const parts = new URL(canonical).pathname.split('/').filter(Boolean);
    const type = parts[0];
    const id = parts[1]?.split('?')[0];
    if (id && (type === 'track' || type === 'album' || type === 'playlist' || type === 'episode' || type === 'show')) {
      const result = { type, id };
      shortLinkCache.set(shortUrl, result);
      return result;
    }
    shortLinkCache.set(shortUrl, null);
    return null;
  } catch {
    shortLinkCache.set(shortUrl, null);
    return null;
  }
}

interface SpotifyEmbedProps {
  type: 'track' | 'album' | 'playlist' | 'episode' | 'show';
  id: string;
  inBubble?: boolean;
  isMe?: boolean;
}

export function SpotifyEmbed({ type, id, inBubble = false, isMe = false }: SpotifyEmbedProps) {
  const isShort = id.startsWith('short:');
  const shortUrl = isShort ? id.slice(6) : null;
  const [resolved, setResolved] = useState<{ type: string; id: string } | null>(
    isShort ? (shortLinkCache.get(shortUrl!) ?? null) : { type, id },
  );
  const [shortFailed, setShortFailed] = useState(
    isShort && shortLinkCache.get(shortUrl!) === null,
  );

  useEffect(() => {
    if (!isShort || !shortUrl) return;
    if (shortLinkCache.has(shortUrl)) {
      const cached = shortLinkCache.get(shortUrl);
      setResolved(cached ?? null);
      if (!cached) setShortFailed(true);
      return;
    }
    let cancelled = false;
    void resolveSpotifyShortLink(shortUrl).then((result) => {
      if (cancelled) return;
      setResolved(result);
      if (!result) setShortFailed(true);
    });
    return () => { cancelled = true; };
  }, [isShort, shortUrl]);

  if (isShort && !resolved && !shortFailed) {
    return (
      <div
        className={`overflow-hidden rounded-xl bg-[#121212] ${inBubble ? '' : 'border border-black/10 dark:border-white/10'}`}
        style={{ height: 152 }}
      >
        <div className="h-full w-full animate-pulse bg-white/5" />
      </div>
    );
  }

  const effectiveType = (resolved?.type ?? type) as SpotifyEmbedProps['type'];
  const effectiveId = resolved?.id ?? (isShort ? '' : id);

  if (shortFailed || !effectiveId) return null;

  return <SpotifyEmbedInner type={effectiveType} id={effectiveId} inBubble={inBubble} isMe={isMe} />;
}

function SpotifyEmbedInner({ type, id, inBubble, isMe }: SpotifyEmbedProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SpotifyEmbedController | null>(null);
  const pausedByMuteRef = useRef(false);
  const [apiFailed, setApiFailed] = useState(false);
  const { volume, toggleMute } = useEmbedMediaVolume();
  const muted = volume <= 0;
  const playerHeight = spotifyPlayerHeight(type);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    // Spotify's embed renders a thin white bar at the very bottom of the iframe
    // on mobile. We clip it by making the host div 6px shorter than the iframe
    // so overflow:hidden cuts off that bar. The wrapperRef stays at playerHeight
    // for layout so the surrounding UI is unaffected.
    const CLIP_BOTTOM = 6;

    const host = document.createElement('div');
    host.style.width = '100%';
    host.style.height = `${playerHeight - CLIP_BOTTOM}px`;
    host.style.overflow = 'hidden';
    wrapper.appendChild(host);

    const styleIframe = (iframe: HTMLIFrameElement) => {
      iframe.style.background = 'transparent';
      iframe.style.borderRadius = '12px';
      iframe.style.display = 'block';
      // Keep the iframe at its natural playerHeight so Spotify renders its full
      // UI; the host div is shorter and clips the white bar off the bottom.
      iframe.style.height = `${playerHeight}px`;
    };
    const observer = new MutationObserver(() => {
      host.querySelectorAll<HTMLIFrameElement>('iframe').forEach(styleIframe);
    });
    observer.observe(host, { childList: true, subtree: true });

    let cancelled = false;

    void loadSpotifyIframeApi()
      .then((spotifyApi) => {
        if (cancelled) return;

        spotifyApi.createController(
          host,
          { uri: spotifyUriForType(type, id), width: '100%', height: playerHeight },
          (controller) => {
            if (cancelled) {
              controller.destroy();
              return;
            }
            controllerRef.current = controller;
            const initialVol = readEmbedMediaVolume();
            if (initialVol <= 0) {
              pausedByMuteRef.current = true;
              controller.pause();
            }
          }
        );
      })
      .catch(() => {
        if (!cancelled) setApiFailed(true);
      });

    return () => {
      cancelled = true;
      observer.disconnect();
      controllerRef.current?.destroy();
      controllerRef.current = null;
      if (host.parentNode === wrapper) wrapper.removeChild(host);
    };
  }, [id, playerHeight, type]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;

    if (volume <= 0) {
      pausedByMuteRef.current = true;
      controller.pause();
      return;
    }

    if (pausedByMuteRef.current) {
      pausedByMuteRef.current = false;
      controller.resume();
    }
  }, [volume]);

  // Floating mute button — vertically centered on the embed, positioned on the
  // profile picture side (right for own messages, left for others').
  const MuteButton = (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); toggleMute(); }}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); toggleMute(); }}
      onTouchStart={(e) => e.stopPropagation()}
      className={`absolute top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-neutral-600/90 text-white shadow-lg backdrop-blur-sm transition-colors hover:bg-neutral-500/90 ${
        isMe ? '-right-4' : '-left-[41px]'
      }`}
      aria-label={muted ? 'Unmute' : 'Mute'}
    >
      {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
    </button>
  );

  if (apiFailed) {
    return (
      <div className="relative">
        {MuteButton}
        <div className={`overflow-hidden rounded-xl ${inBubble ? '' : 'border border-black/10 dark:border-white/10'}`}>
          <iframe
            src={`https://open.spotify.com/embed/${type}/${id}?utm_source=generator`}
            title="Spotify embed"
            className="w-full"
            style={{ height: playerHeight }}
            loading="lazy"
            allow={SPOTIFY_EMBED_IFRAME_ALLOW}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {MuteButton}
      <div
        className={`overflow-hidden rounded-xl bg-transparent ${
          inBubble ? '' : 'border border-black/10 dark:border-white/10'
        }`}
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div ref={wrapperRef} style={{ height: playerHeight }} />
      </div>
    </div>
  );
}
