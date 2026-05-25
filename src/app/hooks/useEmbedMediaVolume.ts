import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_EMBED_MEDIA_VOLUME,
  dispatchEmbedMediaVolumeChange,
  EMBED_MEDIA_VOLUME_EVENT,
  readEmbedMediaVolume,
  writeEmbedMediaVolume,
  clampEmbedMediaVolume,
} from '../lib/embedMediaVolume';

export function useEmbedMediaVolume() {
  const [volume, setVolume] = useState(() => readEmbedMediaVolume());
  const volumeRef = useRef(volume);
  const lastAudibleVolume = useRef(
    Math.max(readEmbedMediaVolume(), DEFAULT_EMBED_MEDIA_VOLUME)
  );

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    const handleVolumeChange = (event: Event) => {
      const next = (event as CustomEvent<number>).detail;
      if (typeof next !== 'number') return;
      const clamped = clampEmbedMediaVolume(next);
      setVolume((prev) => (prev === clamped ? prev : clamped));
    };

    window.addEventListener(EMBED_MEDIA_VOLUME_EVENT, handleVolumeChange);
    return () => window.removeEventListener(EMBED_MEDIA_VOLUME_EVENT, handleVolumeChange);
  }, []);

  const applyVolume = useCallback((nextVolume: number) => {
    const clamped = clampEmbedMediaVolume(nextVolume);
    if (clamped === volumeRef.current) return;

    if (clamped > 0) {
      lastAudibleVolume.current = clamped;
    }
    const stored = clamped > 0 ? clamped : lastAudibleVolume.current;
    writeEmbedMediaVolume(stored);
    volumeRef.current = clamped;
    setVolume(clamped);
    dispatchEmbedMediaVolumeChange(clamped);
  }, []);

  const toggleMute = useCallback(() => {
    applyVolume(volumeRef.current <= 0 ? lastAudibleVolume.current : 0);
  }, [applyVolume]);

  return {
    volume,
    muted: volume <= 0,
    lastAudibleVolume,
    applyVolume,
    toggleMute,
  };
}
