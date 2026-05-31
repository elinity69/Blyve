import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react';
import { subscribeMobileViewportFrame } from '../lib/mobileViewport';

const NEAR_BOTTOM_PX = 96;
/** One follow-up after the mobile keyboard finishes its resize animation (iOS Safari). */
const KEYBOARD_SETTLE_MS = 320;

export type ChatScrollAnchorRef = (node: HTMLElement | null) => void;

/**
 * Keeps the message list pinned to the bottom while the composer / keyboard moves:
 * instant sync on resize, smooth scroll when the composer receives focus.
 */
export function useChatScrollAnchor(
  containerRef: RefObject<HTMLElement | null>,
  enabled = true,
  _endMarkerRef?: RefObject<HTMLElement | null>
): ChatScrollAnchorRef {
  const [containerEl, setContainerEl] = useState<HTMLElement | null>(null);
  const pinnedRef = useRef(true);
  const adjustingRef = useRef(false);
  const prevClientHeightRef = useRef(0);
  const keyboardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeRafRef = useRef<number | null>(null);

  const assignContainerRef = useCallback(
    (node: HTMLElement | null) => {
      setContainerEl(node);
      (containerRef as MutableRefObject<HTMLElement | null>).current = node;
    },
    [containerRef]
  );

  useLayoutEffect(() => {
    if (!enabled || !containerEl) return;

    const getContainer = () => containerEl;

    const distanceFromBottom = (container: HTMLElement) =>
      container.scrollHeight - container.scrollTop - container.clientHeight;

    const scrollToEnd = (smooth = false) => {
      const container = getContainer();
      if (!container) return;

      adjustingRef.current = true;
      pinnedRef.current = true;

      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);

      if (smooth && typeof container.scrollTo === 'function') {
        container.scrollTo({ top: maxScroll, behavior: 'smooth' });
      } else {
        container.scrollTop = maxScroll;
      }

      requestAnimationFrame(() => {
        adjustingRef.current = false;
      });
    };

    const syncScrollPosition = (opts?: { smooth?: boolean }) => {
      const container = getContainer();
      if (!container) return;

      const distance = distanceFromBottom(container);
      const nearBottom = distance < NEAR_BOTTOM_PX;

      if (pinnedRef.current || nearBottom) {
        pinnedRef.current = true;
        scrollToEnd(opts?.smooth ?? false);
      } else {
        const prevHeight = prevClientHeightRef.current;
        const heightDelta = container.clientHeight - prevHeight;
        if (heightDelta !== 0) {
          container.scrollTop = Math.max(0, container.scrollTop + heightDelta);
        }
      }

      prevClientHeightRef.current = container.clientHeight;
    };

    const scheduleResizeSync = (opts?: { smooth?: boolean }) => {
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
      }
      resizeRafRef.current = requestAnimationFrame(() => {
        resizeRafRef.current = null;
        syncScrollPosition(opts);
      });
    };

    const onScroll = () => {
      if (adjustingRef.current) return;
      const container = getContainer();
      if (!container) return;
      pinnedRef.current = distanceFromBottom(container) < NEAR_BOTTOM_PX;
    };

    prevClientHeightRef.current = containerEl.clientHeight;
    containerEl.addEventListener('scroll', onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      scheduleResizeSync();
    });
    resizeObserver.observe(containerEl);

    const composerEl = containerEl.parentElement?.querySelector('[data-chat-composer]');
    if (composerEl instanceof HTMLElement) {
      resizeObserver.observe(composerEl);
    }

    const unsubscribeViewport = subscribeMobileViewportFrame(() => {
      scheduleResizeSync();
    });

    const vv = window.visualViewport;
    const onVisualViewportChange = () => scheduleResizeSync();
    vv?.addEventListener('resize', onVisualViewportChange);
    vv?.addEventListener('scroll', onVisualViewportChange);

    const onComposerFocus = (event: Event) => {
      const detail = (event as CustomEvent<{ smooth?: boolean }>).detail;
      const smooth = detail?.smooth !== false;

      pinnedRef.current = true;

      syncScrollPosition({ smooth: false });
      scheduleResizeSync({ smooth: false });

      if (keyboardTimerRef.current) {
        clearTimeout(keyboardTimerRef.current);
      }
      keyboardTimerRef.current = setTimeout(() => {
        keyboardTimerRef.current = null;
        syncScrollPosition({ smooth });
      }, KEYBOARD_SETTLE_MS);
    };

    window.addEventListener('chat-composer-focus', onComposerFocus);

    return () => {
      containerEl.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
      unsubscribeViewport();
      vv?.removeEventListener('resize', onVisualViewportChange);
      vv?.removeEventListener('scroll', onVisualViewportChange);
      window.removeEventListener('chat-composer-focus', onComposerFocus);
      if (keyboardTimerRef.current) {
        clearTimeout(keyboardTimerRef.current);
        keyboardTimerRef.current = null;
      }
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
    };
  }, [enabled, containerEl]);

  return assignContainerRef;
}
