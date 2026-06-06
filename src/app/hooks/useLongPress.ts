import { useCallback, useRef } from 'react';

/** How far (px) the pointer may drift before we treat it as a gesture, not a hold. */
const MOVE_SLOP = 10;

export type LongPressBind = {
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
  onPointerLeave: (event: React.PointerEvent) => void;
  onPointerCancel: (event: React.PointerEvent) => void;
  onClickCapture: (event: React.MouseEvent) => void;
};

export function useLongPress(
  onLongPress: (event: React.PointerEvent) => void,
  delay = 500
): { bind: LongPressBind; wasTriggered: () => boolean } {
  const timeoutRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);

  const clear = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const isNavigationSwipeLocked = useCallback(() => {
    if (typeof document === 'undefined') return false;
    const root = document.documentElement.dataset;
    return root.swipeBackLock === '1' || root.forwardSwipeLock === '1';
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (isNavigationSwipeLocked()) return;
      longPressTriggeredRef.current = false;
      startXRef.current = event.clientX;
      startYRef.current = event.clientY;
      clear();
      timeoutRef.current = window.setTimeout(() => {
        if (isNavigationSwipeLocked()) return;
        longPressTriggeredRef.current = true;
        onLongPress(event);
      }, delay);
    },
    [clear, delay, isNavigationSwipeLocked, onLongPress]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (timeoutRef.current === null) return;
      const dx = event.clientX - startXRef.current;
      const dy = event.clientY - startYRef.current;
      if (Math.sqrt(dx * dx + dy * dy) > MOVE_SLOP) {
        clear();
      }
    },
    [clear]
  );

  const onPointerLeave = useCallback(
    (event: React.PointerEvent) => {
      // On touch, pointerleave can fire on minor movements outside the element.
      // Only cancel for mouse; touch cancellation is handled by onPointerMove / onPointerCancel.
      if (event.pointerType !== 'touch') {
        clear();
      }
    },
    [clear]
  );

  const onPointerCancel = useCallback(
    (event: React.PointerEvent) => {
      // pointercancel fires when the browser takes over (e.g. scroll).
      // By this point onPointerMove has already cleared the timer if there was
      // significant movement, so this is just a safety net.
      clear();
    },
    [clear]
  );

  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (longPressTriggeredRef.current) {
      event.preventDefault();
      event.stopPropagation();
      longPressTriggeredRef.current = false;
    }
  }, []);

  const wasTriggered = useCallback(() => longPressTriggeredRef.current, []);

  const bind: LongPressBind = {
    onPointerDown,
    onPointerMove,
    onPointerUp: clear,
    onPointerLeave,
    onPointerCancel,
    onClickCapture,
  };

  return { bind, wasTriggered };
}
