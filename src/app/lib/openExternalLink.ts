import type { MouseEvent, KeyboardEvent, SyntheticEvent } from 'react';

const OPEN_DEDUPE_MS = 600;
let lastOpen: { url: string; at: number } | null = null;
let lastAnyOpenAt = 0;

export function openExternalLink(
  event: MouseEvent | KeyboardEvent | SyntheticEvent,
  url: string
): void {
  event.preventDefault();
  event.stopPropagation();

  if (
    event.type === 'click' &&
    'detail' in event &&
    typeof event.detail === 'number' &&
    event.detail > 1
  ) {
    return;
  }

  const now = Date.now();
  if (now - lastAnyOpenAt < 300) {
    return;
  }
  if (lastOpen && lastOpen.url === url && now - lastOpen.at < OPEN_DEDUPE_MS) {
    return;
  }

  lastOpen = { url, at: now };
  lastAnyOpenAt = now;
  window.open(url, '_blank', 'noopener,noreferrer');
}
