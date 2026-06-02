import { useCallback, useRef } from 'react';

export type LongPressBind = {
  onPointerDown: (event: React.PointerEvent) => void;
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
      clear();
      timeoutRef.current = window.setTimeout(() => {
        if (isNavigationSwipeLocked()) return;
        longPressTriggeredRef.current = true;
        onLongPress(event);
      }, delay);
    },
    [clear, delay, isNavigationSwipeLocked, onLongPress]
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
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onClickCapture,
  };

  return { bind, wasTriggered };
}
