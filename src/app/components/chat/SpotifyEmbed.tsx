import { useEffect, useRef, useState } from 'react';
import { useEmbedMediaVolume } from '../../hooks/useEmbedMediaVolume';
import { readEmbedMediaVolume } from '../../lib/embedMediaVolume';
import { SPOTIFY_EMBED_IFRAME_ALLOW } from '../../lib/mediaEmbedAllow';
import {
  loadSpotifyIframeApi,
  spotifyPlayerHeight,
  spotifyUriForType,
  type SpotifyEmbedController,
} from '../../lib/spotifyIframeApi';
import { EmbedVolumeBar } from './EmbedVolumeBar';

interface SpotifyEmbedProps {
  type: 'track' | 'album' | 'playlist' | 'episode' | 'show';
  id: string;
}

export function SpotifyEmbed({ type, id }: SpotifyEmbedProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SpotifyEmbedController | null>(null);
  const pausedByMuteRef = useRef(false);
  const [apiFailed, setApiFailed] = useState(false);
  const { volume, applyVolume, toggleMute } = useEmbedMediaVolume();
  const playerHeight = spotifyPlayerHeight(type);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    void loadSpotifyIframeApi()
      .then((api) => {
        if (cancelled) return;

        api.createController(
          host,
          {
            uri: spotifyUriForType(type, id),
            width: '100%',
            height: playerHeight,
          },
          (controller) => {
            if (cancelled) {
              controller.destroy();
              return;
            }
            controllerRef.current = controller;
            if (readEmbedMediaVolume() <= 0) {
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
      controllerRef.current?.destroy();
      controllerRef.current = null;
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

  if (apiFailed) {
    return (
      <div className="overflow-hidden rounded-xl border border-black/10 dark:border-white/10">
        <iframe
          src={`https://open.spotify.com/embed/${type}/${id}?utm_source=generator`}
          title="Spotify embed"
          className="w-full"
          style={{ height: playerHeight }}
          loading="lazy"
          allow={SPOTIFY_EMBED_IFRAME_ALLOW}
        />
        <EmbedVolumeBar volume={volume} onVolumeChange={applyVolume} onToggleMute={toggleMute} />
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-xl border border-black/10 dark:border-white/10 bg-[#121212]"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div ref={hostRef} className="w-full" style={{ height: playerHeight }} />
      <EmbedVolumeBar volume={volume} onVolumeChange={applyVolume} onToggleMute={toggleMute} />
    </div>
  );
}
