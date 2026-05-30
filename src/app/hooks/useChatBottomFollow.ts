import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type RefObject,
} from 'react';
import { CHAT_NEAR_BOTTOM_PX, isNearBottom, scrollContainerToBottomStable } from '../lib/chatScroll';

/**
 * Keeps the message list pinned to the bottom when the user is already there.
 * Reacts to new messages, typing clearance, read receipts, and late-loading embeds.
 */
export function useChatBottomFollow(
  containerRef: RefObject<HTMLElement | null>,
  options: {
    enabled?: boolean;
    /** Extra layout-effect triggers (e.g. messages, typingClearance). */
    deps?: readonly unknown[];
  } = {}
) {
  const { enabled = true, deps = [] } = options;
  const pinnedRef = useRef(true);

  const followIfPinned = useCallback(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    const shouldFollow =
      pinnedRef.current || isNearBottom(container, CHAT_NEAR_BOTTOM_PX);
    if (!shouldFollow) return;

    pinnedRef.current = true;
    scrollContainerToBottomStable(container);
  }, [containerRef, enabled]);

  const forceFollow = useCallback(() => {
    pinnedRef.current = true;
    const container = containerRef.current;
    if (!container || !enabled) return;
    scrollContainerToBottomStable(container);
  }, [containerRef, enabled]);

  useLayoutEffect(() => {
    followIfPinned();
  }, [followIfPinned, ...deps]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    const syncPinnedFromScroll = () => {
      pinnedRef.current = isNearBottom(container, CHAT_NEAR_BOTTOM_PX);
    };

    const onScroll = () => syncPinnedFromScroll();
    container.addEventListener('scroll', onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      if (pinnedRef.current || isNearBottom(container, CHAT_NEAR_BOTTOM_PX)) {
        pinnedRef.current = true;
        scrollContainerToBottomStable(container);
      } else {
        syncPinnedFromScroll();
      }
    });
    resizeObserver.observe(container);

    const onMediaLoad = (event: Event) => {
      const target = event.target;
      if (
        target instanceof HTMLImageElement ||
        target instanceof HTMLVideoElement ||
        target instanceof HTMLIFrameElement
      ) {
        if (container.contains(target)) {
          followIfPinned();
        }
      }
    };
    container.addEventListener('load', onMediaLoad, true);

    return () => {
      container.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
      container.removeEventListener('load', onMediaLoad, true);
    };
  }, [containerRef, enabled, followIfPinned]);

  return { followIfPinned, forceFollow, pinnedRef };
}
