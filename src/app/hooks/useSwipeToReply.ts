import { useCallback, useEffect, useRef, useState } from 'react';

const SWIPE_THRESHOLD = 40;
const SWIPE_MAX = 56;

/** Left-edge ratio that the NavigationStack reserves for swipe-back (mirrors BACK_EDGE_INSET_RATIO). */
const BACK_EDGE_INSET_RATIO = 0.18;

/** Returns true if the NavigationStack is currently handling a back-swipe gesture. */
function isNavSwipeActive(): boolean {
  return (
    document.documentElement.dataset.swipeBackLock === '1' ||
    document.documentElement.dataset.navEdgeTouch === '1'
  );
}

export interface SwipeToReplyState {
  /** Negative px while dragging left, 0 at rest. */
  offsetX: number;
  /** 0–1 progress toward threshold. */
  swipeProgress: number;
  /** True once progress hits 1 (threshold reached). Reverts if finger comes back. */
  armed: boolean;
  /** True for one render tick after a successful release — drives confirmation flash. */
  fired: boolean;
}

export function useSwipeToReply(onReply: () => void, enabled = true) {
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const draggingRef = useRef(false);
  const suppressedRef = useRef(false);
  const offsetRef = useRef(0);
  const hapticFiredRef = useRef(false);
  const replyFiredRef = useRef(false);
  const nodeRef = useRef<HTMLElement | null>(null);

  const [state, setState] = useState<SwipeToReplyState>({
    offsetX: 0,
    swipeProgress: 0,
    armed: false,
    fired: false,
  });

  const patchState = useCallback((patch: Partial<SwipeToReplyState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => {
    draggingRef.current = false;
    suppressedRef.current = false;
    offsetRef.current = 0;
    hapticFiredRef.current = false;
    replyFiredRef.current = false;
    setState({ offsetX: 0, swipeProgress: 0, armed: false, fired: false });
  }, []);

  // Non-passive native touchmove to block vertical scroll once horizontal is confirmed.
  const nativeBlockRef = useRef<((e: TouchEvent) => void) | null>(null);

  const attachScrollBlock = useCallback(() => {
    const node = nodeRef.current;
    if (!node || nativeBlockRef.current) return;
    const handler = (e: TouchEvent) => {
      if (draggingRef.current && e.cancelable) e.preventDefault();
    };
    nativeBlockRef.current = handler;
    node.addEventListener('touchmove', handler, { passive: false });
  }, []);

  const detachScrollBlock = useCallback(() => {
    const node = nodeRef.current;
    if (!node || !nativeBlockRef.current) return;
    node.removeEventListener('touchmove', nativeBlockRef.current);
    nativeBlockRef.current = null;
  }, []);

  useEffect(() => detachScrollBlock, [detachScrollBlock]);

  const onTouchMove = useCallback(
    (event: React.TouchEvent) => {
      if (!enabled || suppressedRef.current) return;
      const touch = event.touches[0];
      if (!touch) return;

      const dx = touch.clientX - startXRef.current;
      const dy = touch.clientY - startYRef.current;

      if (!draggingRef.current) {
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;

        if (Math.abs(dy) > Math.abs(dx) * 1.2) return;

        if (dx >= 0) return;

        draggingRef.current = true;
        attachScrollBlock();
      }

      if (dx < 0) {
        const clamped = Math.max(dx, -SWIPE_MAX);
        const abs = Math.abs(clamped);
        offsetRef.current = abs;
        const progress = Math.min(abs / SWIPE_THRESHOLD, 1);
        const nowArmed = progress >= 1;

        if (!hapticFiredRef.current && nowArmed) {
          hapticFiredRef.current = true;
          navigator.vibrate?.(10);
        }

        patchState({ offsetX: clamped, swipeProgress: progress, armed: nowArmed });
      } else {
        offsetRef.current = 0;
        patchState({ offsetX: 0, swipeProgress: 0, armed: false });
      }
    },
    [enabled, attachScrollBlock, patchState]
  );

  const onTouchStart = useCallback(
    (event: React.TouchEvent) => {
      reset();
      if (!enabled) return;
      const touch = event.touches[0];
      const x = touch?.clientX ?? 0;
      const screenW = window.innerWidth;
      const inBackEdge = x < screenW * BACK_EDGE_INSET_RATIO;
      const navActive = isNavSwipeActive();
      if (navActive || inBackEdge) {
        suppressedRef.current = true;
        return;
      }
      startXRef.current = x;
      startYRef.current = touch?.clientY ?? 0;
    },
    [enabled, reset]
  );

  const onTouchEnd = useCallback(
    (_event: React.TouchEvent) => {
      detachScrollBlock();
      if (!enabled || suppressedRef.current || !draggingRef.current) {
        reset();
        return;
      }
      if (offsetRef.current >= SWIPE_THRESHOLD && !replyFiredRef.current) {
        replyFiredRef.current = true;
        // Flash the fired state briefly, then reset.
        patchState({ fired: true, offsetX: 0, armed: false });
        setTimeout(() => reset(), 300);
        onReply();
      } else {
        reset();
      }
    },
    [enabled, onReply, reset, detachScrollBlock, patchState]
  );

  const callbackRef = useCallback((node: HTMLElement | null) => {
    nodeRef.current = node;
  }, []);

  return {
    ...state,
    callbackRef,
    swipeHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: () => { detachScrollBlock(); reset(); },
    },
  };
}
