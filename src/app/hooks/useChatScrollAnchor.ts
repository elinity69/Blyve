import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react';

const NEAR_BOTTOM_PX = 96;

const getScrollMetrics = (containerEl: HTMLElement) => {
  const scrollTop = containerEl.scrollTop;
  const scrollHeight = containerEl.scrollHeight;
  const clientHeight = containerEl.clientHeight;
  const bottomGap = scrollHeight - scrollTop - clientHeight;
  return {
    scrollTop,
    scrollHeight,
    clientHeight,
    bottomGap,
    windowInnerHeight: window.innerHeight,
    windowOuterHeight: window.outerHeight,
    vvHeight: window.visualViewport?.height ?? null,
    vvOffsetTop: window.visualViewport?.offsetTop ?? null,
    vvPageTop: window.visualViewport?.pageTop ?? null,
  };
};

const logScrollAnchorDebug = (event: string, containerEl: HTMLElement, additionalMetrics: Record<string, any> = {}) => {
  const metrics = getScrollMetrics(containerEl);
  console.log('[BLYVE_CHAT_SCROLL_DEBUG]', {
    event,
    ts: Date.now(),
    ...metrics,
    ...additionalMetrics,
  });
};

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

    logScrollAnchorDebug('mount', containerEl, {
      enabled,
      endMarkerRef: !!endMarkerRef?.current,
    });

    let rafId = 0;

    const distanceFromBottom = () =>
      containerEl.scrollHeight - containerEl.scrollTop - containerEl.clientHeight;

    const syncScrollPosition = () => {
      // Skip sync entirely when the container has no size — this prevents the
      // hidden forward-pull ChatScreen (0×0 container) from running and logging.
      if (containerEl.clientHeight === 0) return;

      const distance = distanceFromBottom();
      const nearBottom = distance < NEAR_BOTTOM_PX;

      logScrollAnchorDebug('syncScrollPosition', containerEl, {
        pinned: pinnedRef.current,
        distance,
        nearBottom,
      });

      if (pinnedRef.current || nearBottom) {
        pinnedRef.current = true;
        const before = containerEl.scrollTop;
        containerEl.scrollTop = Math.max(0, containerEl.scrollHeight - containerEl.clientHeight);
        logScrollAnchorDebug('syncScrollPosition_snapped', containerEl, { before, after: containerEl.scrollTop });
      } else {
        const heightDelta = containerEl.clientHeight - prevClientHeightRef.current;
        if (heightDelta !== 0) {
          const before = containerEl.scrollTop;
          containerEl.scrollTop = Math.max(0, containerEl.scrollTop + heightDelta);
          logScrollAnchorDebug('syncScrollPosition_adjust_by_delta', containerEl, { heightDelta, before, after: containerEl.scrollTop });
        } else {
          logScrollAnchorDebug('syncScrollPosition_no_op', containerEl);
        }
      }

      prevClientHeightRef.current = containerEl.clientHeight;
    };

    // scheduleSync via RAF is used only for the composer-focus event, where we
    // intentionally defer to after the keyboard has begun animating.
    const scheduleSync = (reason: string) => {
      logScrollAnchorDebug('scheduleSync', containerEl, { reason, pinned: pinnedRef.current });
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(syncScrollPosition);
    };

    const onScroll = () => {
      const wasPinned = pinnedRef.current;
      pinnedRef.current = distanceFromBottom() < NEAR_BOTTOM_PX;
      if (wasPinned !== pinnedRef.current) {
        logScrollAnchorDebug('onScroll_pinnedRef_change', containerEl, {
          wasPinned,
          pinned: pinnedRef.current,
          dist: distanceFromBottom(),
        });
      }
    };

    prevClientHeightRef.current = containerEl.clientHeight;
    containerEl.addEventListener('scroll', onScroll, { passive: true });

    // ResizeObserver callbacks fire AFTER layout but BEFORE paint, in the same
    // rendering frame. Calling syncScrollPosition() directly here (not via RAF)
    // means the scroll adjustment lands in the SAME frame as the container resize.
    // This eliminates the 1-frame gap that caused the visible "jump" when the iOS
    // keyboard opens and shrinks the chat container height.
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = 0;
      if (containerEl.clientHeight === 0) return;

      // iOS can fire onScroll during the keyboard-open transition (before this
      // ResizeObserver callback) which resets pinnedRef to false. Re-check using
      // the PREVIOUS clientHeight to detect if the user was at the bottom before
      // the resize. If so, force pinnedRef=true so we always snap on keyboard open.
      if (!pinnedRef.current && prevClientHeightRef.current > 0) {
        const oldDistance =
          containerEl.scrollHeight - containerEl.scrollTop - prevClientHeightRef.current;
        if (oldDistance < NEAR_BOTTOM_PX) {
          pinnedRef.current = true;
        }
      }

      syncScrollPosition();
    });
    resizeObserver.observe(containerEl);
    logScrollAnchorDebug('ResizeObserver_observing_containerEl', containerEl);

    const composerEl = containerEl.parentElement?.querySelector('[data-chat-composer]');
    if (composerEl instanceof HTMLElement) {
      resizeObserver.observe(composerEl);
      logScrollAnchorDebug('ResizeObserver_observing_composer', containerEl, { composerExists: true });
    } else {
      logScrollAnchorDebug('ResizeObserver_composer_not_found', containerEl, { composerExists: false });
    }

    // Do NOT observe contentWrapper — it fires ResizeObserver on every DOM
    // mutation (reactions, read ticks, re-renders) and snaps the user back
    // to bottom mid-scroll. New messages are handled via containerEl resize.
    logScrollAnchorDebug('ResizeObserver_not_observing_contentWrapper', containerEl);

    const onComposerFocus = () => {
      const dist = distanceFromBottom();
      logScrollAnchorDebug('chat-composer-focus_event', containerEl, { dist, pinned: pinnedRef.current });
      if (dist < NEAR_BOTTOM_PX) {
        pinnedRef.current = true;
        logScrollAnchorDebug('chat-composer-focus_setting_pinnedRef_true', containerEl);
      } else {
        logScrollAnchorDebug('chat-composer-focus_user_scrolled_up_not_pinning', containerEl);
      }
      scheduleSync('composerFocus');
    };

    window.addEventListener('chat-composer-focus', onComposerFocus);

    return () => {
      logScrollAnchorDebug('unmount', containerEl);
      containerEl.removeEventListener('scroll', onScroll);
      resizeObserver.disconnect();
      window.removeEventListener('chat-composer-focus', onComposerFocus);
      cancelAnimationFrame(rafId);
    };
  }, [enabled, containerEl, endMarkerRef]);

  return assignContainerRef;
}
