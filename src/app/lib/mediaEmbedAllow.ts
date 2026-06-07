/** Permissions for embedded media iframes. fullscreen is merged into allow to avoid the
 * "Allow attribute will take precedence over allowfullscreen" browser warning. */
export const MEDIA_EMBED_IFRAME_ALLOW =
  'accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; gyroscope; picture-in-picture';

export const SPOTIFY_EMBED_IFRAME_ALLOW =
  'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
