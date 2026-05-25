import { useCallback, useRef, useState } from 'react';

const SWIPE_THRESHOLD = 52;
const SWIPE_MAX = 68;

export function useSwipeToReply(onReply: () => void, enabled = true) {
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const draggingRef = useRef(false);
  const offsetRef = useRef(0);
  const [offsetX, setOffsetX] = useState(0);

  const reset = useCallback(() => {
    draggingRef.current = false;
    offsetRef.current = 0;
    setOffsetX(0);
  }, []);

  const onTouchStart = useCallback(
    (event: React.TouchEvent) => {
      if (!enabled) return;
      startXRef.current = event.touches[0]?.clientX ?? 0;
      startYRef.current = event.touches[0]?.clientY ?? 0;
      draggingRef.current = true;
    },
    [enabled]
  );

  const onTouchMove = useCallback(
    (event: React.TouchEvent) => {
      if (!enabled || !draggingRef.current) return;
      const touch = event.touches[0];
      if (!touch) return;

      const dx = touch.clientX - startXRef.current;
      const dy = touch.clientY - startYRef.current;

      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) {
        reset();
        return;
      }

      // Discord-style: swipe left (finger moves left, message follows)
      if (dx < -8) {
        const next = Math.max(dx, -SWIPE_MAX);
        offsetRef.current = Math.abs(next);
        setOffsetX(next);
      } else {
        offsetRef.current = 0;
        setOffsetX(0);
      }
    },
    [enabled, reset]
  );

  const onTouchEnd = useCallback(() => {
    if (!enabled) return;
    if (offsetRef.current >= SWIPE_THRESHOLD) {
      onReply();
    }
    reset();
  }, [enabled, onReply, reset]);

  return {
    offsetX,
    swipeProgress: Math.min(Math.abs(offsetX) / SWIPE_THRESHOLD, 1),
    swipeHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: onTouchEnd,
    },
  };
}
