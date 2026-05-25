export const EMBED_MEDIA_VOLUME_KEY = 'embed_media_volume';
export const LEGACY_YOUTUBE_VOLUME_KEY = 'youtube_embed_volume';
export const DEFAULT_EMBED_MEDIA_VOLUME = 50;

export function clampEmbedMediaVolume(volume: number): number {
  if (!Number.isFinite(volume)) return DEFAULT_EMBED_MEDIA_VOLUME;
  return Math.max(0, Math.min(100, Math.round(volume)));
}

export function readEmbedMediaVolume(): number {
  try {
    let raw = localStorage.getItem(EMBED_MEDIA_VOLUME_KEY);
    if (raw == null) {
      const legacy = localStorage.getItem(LEGACY_YOUTUBE_VOLUME_KEY);
      if (legacy != null) {
        raw = legacy;
        localStorage.setItem(EMBED_MEDIA_VOLUME_KEY, legacy);
      }
    }
    if (raw == null) return DEFAULT_EMBED_MEDIA_VOLUME;
    return clampEmbedMediaVolume(Number(raw));
  } catch {
    return DEFAULT_EMBED_MEDIA_VOLUME;
  }
}

export function writeEmbedMediaVolume(volume: number): void {
  try {
    localStorage.setItem(EMBED_MEDIA_VOLUME_KEY, String(clampEmbedMediaVolume(volume)));
  } catch {
    // ignore storage errors
  }
}

export const EMBED_MEDIA_VOLUME_EVENT = 'embed-media-volume-change';

export function dispatchEmbedMediaVolumeChange(volume: number): void {
  window.dispatchEvent(
    new CustomEvent<number>(EMBED_MEDIA_VOLUME_EVENT, { detail: clampEmbedMediaVolume(volume) })
  );
}
