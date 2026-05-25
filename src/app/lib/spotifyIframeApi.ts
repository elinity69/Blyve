export interface SpotifyEmbedController {
  play: () => void;
  pause: () => void;
  resume: () => void;
  togglePlay: () => void;
  destroy: () => void;
  addListener: (event: string, callback: (payload: unknown) => void) => void;
}

export interface SpotifyIframeApi {
  createController: (
    element: HTMLElement,
    options: { uri: string; width?: string; height?: string | number },
    callback: (controller: SpotifyEmbedController) => void
  ) => void;
}

declare global {
  interface Window {
    onSpotifyIframeApiReady?: (api: SpotifyIframeApi) => void;
  }
}

let resolvedApi: SpotifyIframeApi | null = null;
let apiReadyPromise: Promise<SpotifyIframeApi> | null = null;

export function loadSpotifyIframeApi(): Promise<SpotifyIframeApi> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Spotify iframe API requires a browser'));
  }

  if (resolvedApi) {
    return Promise.resolve(resolvedApi);
  }

  if (!apiReadyPromise) {
    apiReadyPromise = new Promise((resolve, reject) => {
      const finish = (api: SpotifyIframeApi) => {
        resolvedApi = api;
        resolve(api);
      };

      const previousReady = window.onSpotifyIframeApiReady;
      window.onSpotifyIframeApiReady = (api) => {
        previousReady?.(api);
        finish(api);
      };

      if (document.querySelector('script[data-spotify-iframe-api]')) {
        return;
      }

      const tag = document.createElement('script');
      tag.src = 'https://open.spotify.com/embed/iframe-api/v1';
      tag.async = true;
      tag.dataset.spotifyIframeApi = 'true';
      tag.onerror = () => reject(new Error('Failed to load Spotify iframe API'));
      document.head.appendChild(tag);
    });
  }

  return apiReadyPromise;
}

export function spotifyUriForType(
  type: 'track' | 'album' | 'playlist' | 'episode' | 'show',
  id: string
): string {
  return `spotify:${type}:${id}`;
}

export function spotifyPlayerHeight(
  type: 'track' | 'album' | 'playlist' | 'episode' | 'show'
): number {
  return type === 'track' || type === 'episode' ? 152 : 352;
}
