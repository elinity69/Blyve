import { useCallback, useEffect, useRef, useState } from 'react';

const SWIPE_THRESHOLD = 36;
const SWIPE_MAX = 52;
const VELOCITY_THRESHOLD = 0.3; // px/ms — fast flick triggers reply even under distance threshold

export function useSwipeToReply(onReply: () => void, enabled = true) {
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const draggingRef = useRef(false);
  const offsetRef = useRef(0);
  const lastMoveTimeRef = useRef(0);
  const lastMoveXRef = useRef(0);
  const hapticFiredRef = useRef(false);
  const [offsetX, setOffsetX] = useState(0);
  // Ref to the DOM node that swipeHandlers are spread onto (set via callbackRef).
  const nodeRef = useRef<HTMLElement | null>(null);

  const reset = useCallback(() => {
    draggingRef.current = false;
    offsetRef.current = 0;
    hapticFiredRef.current = false;
    setOffsetX((prev) => (prev === 0 ? prev : 0));
  }, []);

  // Non-passive native touchmove to block vertical scroll once horizontal lock is confirmed.
  const nativeBlockRef = useRef<((e: TouchEvent) => void) | null>(null);

  const attachScrollBlock = useCallback(() => {
    const node = nodeRef.current;
    if (!node || nativeBlockRef.current) return;
    const handler = (e: TouchEvent) => {
      if (draggingRef.current) e.preventDefault();
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

  // Detach on unmount.
  useEffect(() => detachScrollBlock, [detachScrollBlock]);

  const onTouchStart = useCallback(
    (event: React.TouchEvent) => {
      if (!enabled) return;
      startXRef.current = event.touches[0]?.clientX ?? 0;
      startYRef.current = event.touches[0]?.clientY ?? 0;
      lastMoveXRef.current = startXRef.current;
      lastMoveTimeRef.current = event.timeStamp;
      draggingRef.current = false; // locked once direction is confirmed
      hapticFiredRef.current = false;
    },
    [enabled]
  );

  const onTouchMove = useCallback(
    (event: React.TouchEvent) => {
      if (!enabled) return;
      const touch = event.touches[0];
      if (!touch) return;

      const dx = touch.clientX - startXRef.current;
      const dy = touch.clientY - startYRef.current;

      // Direction not yet locked — wait for enough movement to decide.
      if (!draggingRef.current) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          // Vertical — let native scroll handle it, never engage swipe.
          return;
        }
        // Confirmed horizontal swipe — lock direction and block native scroll.
        draggingRef.current = true;
        attachScrollBlock();
      }

      lastMoveXRef.current = touch.clientX;
      lastMoveTimeRef.current = event.timeStamp;

      if (dx < -8) {
        const next = Math.max(dx, -SWIPE_MAX);
        const abs = Math.abs(next);
        offsetRef.current = abs;
        setOffsetX(next);

        // Fire haptic once when crossing the success threshold.
        if (!hapticFiredRef.current && abs >= SWIPE_THRESHOLD) {
          hapticFiredRef.current = true;
          navigator.vibrate?.(10);
        }
      } else {
        offsetRef.current = 0;
        setOffsetX(0);
      }
    },
    [enabled, attachScrollBlock]
  );

  const onTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      if (!enabled) return;
      detachScrollBlock();
      if (!draggingRef.current) { reset(); return; }
      const elapsed = event.timeStamp - lastMoveTimeRef.current;
      const dx = lastMoveXRef.current - startXRef.current;
      const velocity = elapsed > 0 ? Math.abs(dx) / elapsed : 0;
      if (offsetRef.current >= SWIPE_THRESHOLD || velocity >= VELOCITY_THRESHOLD) {
        onReply();
      }
      reset();
    },
    [enabled, onReply, reset, detachScrollBlock]
  );

  const callbackRef = useCallback((node: HTMLElement | null) => {
    nodeRef.current = node;
  }, []);

  return {
    offsetX,
    swipeProgress: Math.min(Math.abs(offsetX) / SWIPE_THRESHOLD, 1),
    callbackRef,
    swipeHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: () => { detachScrollBlock(); reset(); },
    },
  };
}
