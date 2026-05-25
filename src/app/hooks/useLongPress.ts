import { useCallback, useRef } from 'react';

export function useLongPress(
  onLongPress: (event: React.PointerEvent) => void,
  delay = 500
) {
  const timeoutRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);

  const clear = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      longPressTriggeredRef.current = false;
      clear();
      timeoutRef.current = window.setTimeout(() => {
        longPressTriggeredRef.current = true;
        onLongPress(event);
      }, delay);
    },
    [clear, delay, onLongPress]
  );

  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (longPressTriggeredRef.current) {
      event.preventDefault();
      event.stopPropagation();
      longPressTriggeredRef.current = false;
    }
  }, []);

  return {
    onPointerDown,
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onClickCapture,
  };
}
