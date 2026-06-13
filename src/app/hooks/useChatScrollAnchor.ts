import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react';

const NEAR_BOTTOM_PX = 96;

const sd = (..._args: unknown[]) => {};

export type ChatScrollAnchorRef = (node: HTMLElement | null) => void;

export function useChatScrollAnchor(
  containerRef: RefObject<HTMLElement | null>,
  enabled = true,
  endMarkerRef?: RefObject<HTMLElement | null>
): ChatScrollAnchorRef {
  const [containerEl, setContainerEl] = useState<HTMLElement | null>(null);

  const assignContainerRef = useCallback(
    (node: HTMLElement | null) => {
      setContainerEl(node);
      (containerRef as MutableRefObject<HTMLElement | null>).current = node;
    },
    [containerRef]
  );

  const pinnedRef = useRef(true);
  const prevClientHeightRef = useRef(0);

  useLayoutEffect(() => {
    if (!enabled || !containerEl) return;

    sd('MOUNT enabled=true', {
      scrollHeight: containerEl.scrollHeight,
      clientHeight: containerEl.clientHeight,
      scrollTop: containerEl.scrollTop,
    });

    let rafId = 0;

    const distanceFromBottom = () =>
      containerEl.scrollHeight - containerEl.scrollTop - containerEl.clientHeight;

    const syncScrollPosition = () => {
      const distance = distanceFromBottom();
      const nearBottom = distance < NEAR_BOTTOM_PX;

      sd('syncScrollPosition', {
        pinned: pinnedRef.current,
        distance,
        nearBottom,
        scrollTop: containerEl.scrollTop,
        scrollHeight: containerEl.scrollHeight,
        clientHeight: containerEl.clientHeight,
      });

      if (pinnedRef.current || nearBottom) {
        pinnedRef.current = true;
        const before = containerEl.scrollTop;
        containerEl.scrollTop = Math.max(0, containerEl.scrollHeight - containerEl.clientHeight);
        sd('syncScrollPosition → SNAPPED', before, '→', containerEl.scrollTop);
      } else {
        const heightDelta = containerEl.clientHeight - prevClientHeightRef.current;
        if (heightDelta !== 0) {
          const before = containerEl.scrollTop;
          containerEl.scrollTop = Math.max(0, containerEl.scrollTop + heightDelta);
          sd('syncScrollPosition → adjust by delta', heightDelta, before, '→', containerEl.scrollTop);
        } else {
          sd('syncScrollPosition → no-op (not pinned, no delta)');
        }
      }

      prevClientHeightRef.current = containerEl.clientHeight;
    };

    const scheduleSync = (reason: string) => {
      sd('scheduleSync', reason, { pinned: pinnedRef.current });
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(syncScrollPosition);
    };

    const onScroll = () => {
      const wasPinned = pinnedRef.current;
      pinnedRef.current = distanceFromBottom() < NEAR_BOTTOM_PX;
      if (wasPinned !== pinnedRef.current) {
        sd('onScroll pinnedRef', wasPinned, '→', pinnedRef.current, {
          scrollTop: containerEl.scrollTop,
          dist: distanceFromBottom(),
        });
      }
    };

    prevClientHeightRef.current = containerEl.clientHeight;
    containerEl.addEventListener('scroll', onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => scheduleSync('ResizeObserver'));
    resizeObserver.observe(containerEl);
    sd('ResizeObserver: observing containerEl');

    const composerEl = containerEl.parentElement?.querySelector('[data-chat-composer]');
    if (composerEl instanceof HTMLElement) {
      resizeObserver.observe(composerEl);
      sd('ResizeObserver: also observing composer');
    } else {
      sd('ResizeObserver: composer NOT found via [data-chat-composer]');
    }

    // Do NOT observe contentWrapper — it fires ResizeObserver on every DOM
    // mutation (reactions, read ticks, re-renders) and snaps the user back
    // to bottom mid-scroll. New messages are handled via containerEl resize.
    sd('ResizeObserver: NOT observing contentWrapper (prevents mid-scroll snap)');

    const onComposerFocus = () => {
      const dist = distanceFromBottom();
      sd('chat-composer-focus event', { dist, pinned: pinnedRef.current, scrollTop: containerEl.scrollTop });
      if (dist < NEAR_BOTTOM_PX) {
        pinnedRef.current = true;
        sd('chat-composer-focus → setting pinnedRef=true');
      } else {
        sd('chat-composer-focus → user scrolled up, NOT pinning');
      }
      scheduleSync('composerFocus');
    };

    window.addEventListener('chat-composer-focus', onComposerFocus);

    return () => {
      sd('UNMOUNT');
      containerEl.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
      window.removeEventListener('chat-composer-focus', onComposerFocus);
      cancelAnimationFrame(rafId);
    };
  }, [enabled, containerEl, endMarkerRef]);

  return assignContainerRef;
}
