import type { TouchEvent as ReactTouchEvent } from 'react';
import {
  FORWARD_EDGE_INSET_RATIO,
  NAV_SWIPE_DISTANCE_RATIO,
  NAV_SWIPE_MIN_DISTANCE_PX,
  NAV_SWIPE_VELOCITY_THRESHOLD,
} from './navigationShellStyle';

export function getPanelWidth(): number {
  if (typeof window === 'undefined') return 0;
  const w = window.visualViewport?.width ?? window.innerWidth ?? 0;
  return w;
}

export function isForwardSwipeStart(startX: number, width?: number) {
  const w = width ?? getPanelWidth();
  if (w < 100) return false;
  return startX >= w * (1 - FORWARD_EDGE_INSET_RATIO);
}

export type PanelSwipeMode = 'back' | 'forward';

export interface PanelSwipeReleaseResult {
  shouldComplete: boolean;
  distance: number;
  width: number;
  startX?: number;
}

interface PanelSwipeGestureOptions {
  mode: PanelSwipeMode;
  getWidth: () => number;
  isEnabled?: () => boolean;
  onOffsetChange: (offset: number) => void;
  onRelease: (result: PanelSwipeReleaseResult) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function createPanelSwipeGesture(options: PanelSwipeGestureOptions) {
  const startXRef = { current: 0 };
  const startYRef = { current: 0 };
  const currentXRef = { current: 0 };
  const lastTouchXRef = { current: 0 };
  const lastTouchTimeRef = { current: 0 };
  const directionLockedRef = { current: false };
  const isVerticalScrollRef = { current: false };
  const isDraggingRef = { current: false };
  const touchActiveRef = { current: false };
  const offsetRef = { current: 0 };

  const resetTouchState = () => {
    touchActiveRef.current = false;
    directionLockedRef.current = false;
    isVerticalScrollRef.current = false;
    isDraggingRef.current = false;
    offsetRef.current = 0;
  };

  const handleTouchStart = (startX: number, startY: number) => {
    if (options.isEnabled && !options.isEnabled()) {
      return;
    }

    const width = options.getWidth();

    if (options.mode === 'forward' && !isForwardSwipeStart(startX, width)) {
      return;
    }

    touchActiveRef.current = true;
    const now = performance.now();
    startXRef.current = startX;
    startYRef.current = startY;
    currentXRef.current = startX;
    lastTouchXRef.current = startX;
    lastTouchTimeRef.current = now;
    directionLockedRef.current = false;
    isVerticalScrollRef.current = false;
    isDraggingRef.current = false;
  };

  const handleTouchMove = (currentX: number, currentY: number, preventDefault: () => void) => {
    if (!touchActiveRef.current) return;
    if (options.isEnabled && !options.isEnabled()) {
      resetTouchState();
      return;
    }

    const deltaX = currentX - startXRef.current;
    const deltaY = currentY - startYRef.current;
    const width = options.getWidth();

    if (!directionLockedRef.current) {
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);

      if (absDeltaX > 10 || absDeltaY > 10) {
        directionLockedRef.current = true;

        if (options.mode === 'forward') {
          const isRightEdgeSwipe =
            isForwardSwipeStart(startXRef.current, width) && deltaX < 0;
          if (absDeltaY > absDeltaX * 1.65 || !isRightEdgeSwipe) {
            isVerticalScrollRef.current = true;
            return;
          }
        } else if (absDeltaY > absDeltaX * 1.65 || deltaX <= 0) {
          isVerticalScrollRef.current = true;
          return;
        }

        isVerticalScrollRef.current = false;
        isDraggingRef.current = true;
        options.onDragStart?.();
      } else {
        return;
      }
    }

    if (isVerticalScrollRef.current || !isDraggingRef.current) return;

    const pullDistance =
      options.mode === 'forward'
        ? Math.min(Math.max(0, startXRef.current - currentX), width)
        : Math.min(Math.max(0, deltaX), width);

    if (pullDistance > 0) {
      preventDefault();
      currentXRef.current = currentX;
      lastTouchXRef.current = currentX;
      lastTouchTimeRef.current = performance.now();
      offsetRef.current = pullDistance;
      options.onOffsetChange(pullDistance);
    }
  };

  const handleTouchEnd = () => {
    if (!touchActiveRef.current) return;
    touchActiveRef.current = false;

    if (!isDraggingRef.current) {
      resetTouchState();
      return;
    }

    if (options.isEnabled && !options.isEnabled()) {
      resetTouchState();
      return;
    }

    const width = options.getWidth();
    const timeDelta = performance.now() - lastTouchTimeRef.current;
    const velocity = timeDelta > 0 ? (currentXRef.current - lastTouchXRef.current) / timeDelta : 0;
    const distance = offsetRef.current;
    const distanceThreshold = Math.max(NAV_SWIPE_MIN_DISTANCE_PX, width * NAV_SWIPE_DISTANCE_RATIO);

    const shouldComplete =
      options.mode === 'forward'
        ? velocity < -NAV_SWIPE_VELOCITY_THRESHOLD || distance >= distanceThreshold
        : velocity > NAV_SWIPE_VELOCITY_THRESHOLD || distance >= distanceThreshold;

    isDraggingRef.current = false;
    options.onDragEnd?.();
    options.onRelease({ shouldComplete, distance, width, startX: startXRef.current });
    resetTouchState();
  };

  const bindToElement = (element: HTMLElement) => {
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      handleTouchStart(touch.clientX, touch.clientY);
    };

    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      handleTouchMove(touch.clientX, touch.clientY, () => {
        if (event.cancelable) event.preventDefault();
      });
    };

    const onTouchEnd = () => handleTouchEnd();

    element.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    element.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    element.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    element.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true });

    return () => {
      element.removeEventListener('touchstart', onTouchStart, { capture: true });
      element.removeEventListener('touchmove', onTouchMove, { capture: true });
      element.removeEventListener('touchend', onTouchEnd, { capture: true });
      element.removeEventListener('touchcancel', onTouchEnd, { capture: true });
    };
  };

  const bindReactHandlers = () => ({
    onTouchStart: (e: ReactTouchEvent) => handleTouchStart(e.touches[0].clientX, e.touches[0].clientY),
    onTouchMove: (e: ReactTouchEvent) =>
      handleTouchMove(e.touches[0].clientX, e.touches[0].clientY, () => {
        if (e.cancelable) e.preventDefault();
      }),
    onTouchEnd: () => handleTouchEnd(),
    onTouchCancel: () => handleTouchEnd(),
  });

  return {
    bindToElement,
    bindReactHandlers,
    resetTouchState,
    getOffset: () => offsetRef.current,
    setOffset: (value: number) => {
      offsetRef.current = value;
    },
  };
}
