import { useEffect, type RefObject } from 'react';
import { subscribeMobileViewportFrame } from '../lib/mobileViewport';

const NEAR_BOTTOM_PX = 96;

/**
 * Keeps the message list visually stable while the composer / keyboard moves:
 * pins to bottom when the user was already at the bottom, otherwise preserves scroll position.
 */
export function useChatScrollAnchor(
  containerRef: RefObject<HTMLElement | null>,
  enabled = true
) {
  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    let pinnedToBottom = true;
    let prevClientHeight = container.clientHeight;

    const distanceFromBottom = () =>
      container.scrollHeight - container.scrollTop - container.clientHeight;

    const syncScrollPosition = () => {
      const distance = distanceFromBottom();
      const nearBottom = distance < NEAR_BOTTOM_PX;

      if (pinnedToBottom || nearBottom) {
        pinnedToBottom = true;
        container.scrollTop = container.scrollHeight;
      } else {
        const heightDelta = container.clientHeight - prevClientHeight;
        if (heightDelta !== 0) {
          container.scrollTop = Math.max(0, container.scrollTop + heightDelta);
        }
      }

      prevClientHeight = container.clientHeight;
    };

    const onScroll = () => {
      pinnedToBottom = distanceFromBottom() < NEAR_BOTTOM_PX;
    };

    container.addEventListener('scroll', onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(syncScrollPosition);
    });
    resizeObserver.observe(container);

    const unsubscribeViewport = subscribeMobileViewportFrame(() => {
      requestAnimationFrame(syncScrollPosition);
    });

    const onComposerFocus = () => {
      pinnedToBottom = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(syncScrollPosition);
      });
    };
    window.addEventListener('chat-composer-focus', onComposerFocus);

    return () => {
      container.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
      unsubscribeViewport();
      window.removeEventListener('chat-composer-focus', onComposerFocus);
    };
  }, [containerRef, enabled]);
}
