import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useMobileViewportDriver } from '../hooks/useMobileViewportInsets';
import {
  clearNavSwipeLocks,
  FORWARD_EDGE_RATIO,
  NAV_SWIPE_CANCEL_MS,
  NAV_SWIPE_COMPLETE_S,
  NAV_SWIPE_DISTANCE_RATIO,
  NAV_SWIPE_EASE,
  NAV_SWIPE_MIN_DISTANCE_PX,
  NAV_SWIPE_OFFSCREEN_EPSILON_PX,
  NAV_SWIPE_VELOCITY_THRESHOLD,
  navigationStackShellStyle,
  navigationStackShellStyleDesktop,
  setNavForwardSwipeLock,
  setNavSwipeBackLock,
} from '../lib/navigationShellStyle';

interface NavigationStackProps {
  children: React.ReactNode;
  onBack: () => void;
  skipEnterAnimation?: boolean;
  screenId?: string;
  onBeforeBack?: () => void;
  onSwipeBackStart?: () => void;
  onSwipeBackEnd?: () => void;
  /** Pull cached screen in from the right edge (Discord-style). */
  isForwardPull?: boolean;
  forwardShellRef?: React.RefObject<HTMLDivElement | null>;
  onForwardComplete?: () => void;
}

function getViewportWidth() {
  return typeof window !== 'undefined' ? window.innerWidth : 0;
}

export function NavigationStack({
  children,
  onBack,
  skipEnterAnimation = false,
  onBeforeBack,
  onSwipeBackStart,
  onSwipeBackEnd,
  isForwardPull = false,
  forwardShellRef,
  onForwardComplete,
}: NavigationStackProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => getViewportWidth());
  const [translateX, setTranslateX] = useState(0);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const viewportShellRef = useRef<HTMLDivElement | null>(null);
  const [swipeBackLocked, setSwipeBackLocked] = useState(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const currentXRef = useRef(0);
  const lastTouchXRef = useRef(0);
  const lastTouchTimeRef = useRef(0);
  const directionLockedRef = useRef(false);
  const isVerticalScrollRef = useRef(false);
  const isDraggingRef = useRef(false);
  const touchStartedOnEdgeRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const translateXRef = useRef(0);
  const pendingTranslateFrameRef = useRef<number | null>(null);
  const onBackRef = useRef(onBack);
  const onBeforeBackRef = useRef(onBeforeBack);
  const onSwipeBackStartRef = useRef(onSwipeBackStart);
  const onSwipeBackEndRef = useRef(onSwipeBackEnd);
  const onForwardCompleteRef = useRef(onForwardComplete);
  onBackRef.current = onBack;
  onBeforeBackRef.current = onBeforeBack;
  onSwipeBackStartRef.current = onSwipeBackStart;
  onSwipeBackEndRef.current = onSwipeBackEnd;
  onForwardCompleteRef.current = onForwardComplete;

  useMobileViewportDriver(isMobile);

  const setSwipeBackLock = (locked: boolean) => {
    isDraggingRef.current = locked;
    setSwipeBackLocked(locked);
    setNavSwipeBackLock(locked);
    if (locked) {
      onSwipeBackStartRef.current?.();
    } else {
      onSwipeBackEndRef.current?.();
    }
  };

  useLayoutEffect(() => {
    translateXRef.current = 0;
    setTranslateX(0);
  }, [isForwardPull]);

  useEffect(() => {
    const syncViewport = () => {
      setViewportWidth(getViewportWidth());
      setIsMobile(window.innerWidth < 768);
    };
    syncViewport();
    window.addEventListener('resize', syncViewport);
    window.visualViewport?.addEventListener('resize', syncViewport);
    return () => {
      window.removeEventListener('resize', syncViewport);
      window.visualViewport?.removeEventListener('resize', syncViewport);
      clearNavSwipeLocks(forwardShellRef?.current ?? undefined);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (pendingTranslateFrameRef.current !== null) {
        cancelAnimationFrame(pendingTranslateFrameRef.current);
      }
    };
  }, []);

  const applyTranslateX = (value: number) => {
    const clamped = Math.max(0, Math.min(value, viewportWidth));
    translateXRef.current = clamped;
    if (pendingTranslateFrameRef.current !== null) return;
    pendingTranslateFrameRef.current = requestAnimationFrame(() => {
      setTranslateX(translateXRef.current);
      pendingTranslateFrameRef.current = null;
    });
  };

  const animateToRest = (
    startValue: number,
    targetValue: number,
    onDone?: () => void,
    durationMs = NAV_SWIPE_CANCEL_MS
  ) => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const currentValue = startValue + (targetValue - startValue) * eased;

      setTranslateX(currentValue);
      translateXRef.current = currentValue;

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        animationFrameRef.current = null;
        setTranslateX(targetValue);
        translateXRef.current = targetValue;
        onDone?.();
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);
  };

  const resetTouchState = () => {
    touchStartedOnEdgeRef.current = false;
    directionLockedRef.current = false;
    isVerticalScrollRef.current = false;
    isDraggingRef.current = false;
    setSwipeBackLock(false);
    setNavForwardSwipeLock(false, forwardShellRef?.current);
  };

  const handleTouchStart = (startX: number, startY: number) => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (pendingTranslateFrameRef.current !== null) {
      cancelAnimationFrame(pendingTranslateFrameRef.current);
      pendingTranslateFrameRef.current = null;
    }
    touchStartedOnEdgeRef.current = false;

    if (isForwardPull) {
      const width = getViewportWidth();
      if (startX <= width * FORWARD_EDGE_RATIO) return;
    }

    touchStartedOnEdgeRef.current = true;

    const now = performance.now();
    startXRef.current = startX;
    startYRef.current = startY;
    currentXRef.current = startX;
    lastTouchXRef.current = startX;
    lastTouchTimeRef.current = now;
    directionLockedRef.current = false;
    isVerticalScrollRef.current = false;
    isDraggingRef.current = false;
    setSwipeBackLock(false);
    setNavForwardSwipeLock(false, forwardShellRef?.current);
  };

  const handleTouchMove = (currentX: number, currentY: number, preventDefault: () => void) => {
    if (!touchStartedOnEdgeRef.current) return;

    const deltaX = currentX - startXRef.current;
    const deltaY = currentY - startYRef.current;
    const width = getViewportWidth();

    if (!directionLockedRef.current) {
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);

      if (absDeltaX > 10 || absDeltaY > 10) {
        directionLockedRef.current = true;

        if (isForwardPull) {
          const isRightEdgeSwipe = startXRef.current > width * FORWARD_EDGE_RATIO && deltaX < 0;
          if (absDeltaY > absDeltaX * 1.65 || !isRightEdgeSwipe) {
            isVerticalScrollRef.current = true;
            setSwipeBackLock(false);
            return;
          }
        } else if (absDeltaY > absDeltaX * 1.65 || deltaX <= 0) {
          isVerticalScrollRef.current = true;
          setSwipeBackLock(false);
          return;
        }

        isVerticalScrollRef.current = false;
        isDraggingRef.current = true;
        if (isForwardPull) {
          setNavForwardSwipeLock(true, forwardShellRef?.current);
        } else {
          setSwipeBackLock(true);
        }
      } else {
        return;
      }
    }

    if (isVerticalScrollRef.current || !isDraggingRef.current) return;

    const pullDistance = isForwardPull
      ? Math.min(Math.max(0, startXRef.current - currentX), width)
      : Math.min(Math.max(0, deltaX), width);

    if (pullDistance > 0) {
      preventDefault();
      currentXRef.current = currentX;
      lastTouchXRef.current = currentX;
      lastTouchTimeRef.current = performance.now();
      applyTranslateX(pullDistance);
    }
  };

  const handleTouchEnd = () => {
    if (!touchStartedOnEdgeRef.current) return;
    touchStartedOnEdgeRef.current = false;

    if (pendingTranslateFrameRef.current !== null) {
      cancelAnimationFrame(pendingTranslateFrameRef.current);
      pendingTranslateFrameRef.current = null;
      setTranslateX(translateXRef.current);
    }

    if (!isDraggingRef.current) {
      resetTouchState();
      return;
    }

    const width = getViewportWidth();
    const timeDelta = performance.now() - lastTouchTimeRef.current;
    const velocity = timeDelta > 0 ? (currentXRef.current - lastTouchXRef.current) / timeDelta : 0;
    const distance = translateXRef.current;
    const distanceThreshold = Math.max(NAV_SWIPE_MIN_DISTANCE_PX, width * NAV_SWIPE_DISTANCE_RATIO);

    const shouldComplete = isForwardPull
      ? velocity < -NAV_SWIPE_VELOCITY_THRESHOLD || distance > distanceThreshold
      : velocity > NAV_SWIPE_VELOCITY_THRESHOLD || distance > distanceThreshold;

    isDraggingRef.current = false;
    setSwipeBackLock(false);
    setNavForwardSwipeLock(false, forwardShellRef?.current);

    if (shouldComplete) {
      const start = translateXRef.current;
      animateToRest(start, width, () => {
        translateXRef.current = 0;
        setTranslateX(0);
        if (isForwardPull) {
          onForwardCompleteRef.current?.();
        } else {
          onBeforeBackRef.current?.();
          onBackRef.current();
        }
        resetTouchState();
      }, NAV_SWIPE_COMPLETE_S * 1000);
      return;
    }

    if (distance > NAV_SWIPE_OFFSCREEN_EPSILON_PX) {
      animateToRest(distance, 0, resetTouchState);
    } else {
      translateXRef.current = 0;
      setTranslateX(0);
      resetTouchState();
    }
  };

  useEffect(() => {
    if (!isForwardPull || !isMobile) return;
    const shell = forwardShellRef?.current;
    if (!shell) return;

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

    const onTouchEnd = () => {
      handleTouchEnd();
    };

    shell.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    shell.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    shell.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    shell.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true });

    return () => {
      shell.removeEventListener('touchstart', onTouchStart, { capture: true });
      shell.removeEventListener('touchmove', onTouchMove, { capture: true });
      shell.removeEventListener('touchend', onTouchEnd, { capture: true });
      shell.removeEventListener('touchcancel', onTouchEnd, { capture: true });
      setNavForwardSwipeLock(false, shell);
    };
  }, [forwardShellRef, isForwardPull, isMobile]);

  const handleReactTouchStart = (e: React.TouchEvent) => {
    if (isForwardPull) return;
    handleTouchStart(e.touches[0].clientX, e.touches[0].clientY);
  };

  const handleReactTouchMove = (e: React.TouchEvent) => {
    if (isForwardPull) return;
    handleTouchMove(e.touches[0].clientX, e.touches[0].clientY, () => {
      if (e.cancelable) e.preventDefault();
    });
  };

  const handleReactTouchEnd = () => {
    if (isForwardPull) return;
    handleTouchEnd();
  };

  const width = viewportWidth;
  const offscreenX = width;
  const isSwipeDragging = translateX > NAV_SWIPE_OFFSCREEN_EPSILON_PX || swipeBackLocked;
  const isForwardHidden = isForwardPull && !isSwipeDragging;
  const motionX = isForwardPull ? offscreenX - translateX : translateX;

  useLayoutEffect(() => {
    const node = viewportShellRef.current;
    if (!node) return;

    if (isForwardHidden && isForwardPull) {
      node.setAttribute('inert', '');
      const active = document.activeElement;
      if (active instanceof HTMLElement && node.contains(active)) {
        active.blur();
      }
    } else {
      node.removeAttribute('inert');
    }
  }, [isForwardHidden, isForwardPull]);

  if (isMobile) {
    return (
      <motion.div
        ref={shellRef}
        initial={skipEnterAnimation ? false : { x: offscreenX }}
        animate={{ x: motionX }}
        exit={{ x: offscreenX }}
        transition={
          isSwipeDragging
            ? { duration: 0 }
            : { type: 'tween', duration: NAV_SWIPE_COMPLETE_S, ease: NAV_SWIPE_EASE }
        }
        onTouchStart={handleReactTouchStart}
        onTouchStartCapture={handleReactTouchStart}
        onTouchMove={handleReactTouchMove}
        onTouchMoveCapture={handleReactTouchMove}
        onTouchEnd={handleReactTouchEnd}
        onTouchEndCapture={handleReactTouchEnd}
        onTouchCancel={handleReactTouchEnd}
        onTouchCancelCapture={handleReactTouchEnd}
        style={{
          ...navigationStackShellStyle,
          zIndex: isForwardPull ? 5 : navigationStackShellStyle.zIndex,
          boxShadow: isForwardHidden ? 'none' : navigationStackShellStyle.boxShadow,
          touchAction: isForwardPull ? 'none' : swipeBackLocked ? 'none' : 'pan-y',
          pointerEvents: isForwardPull ? 'none' : 'auto',
          willChange: 'transform',
        }}
      >
        <div
          ref={viewportShellRef}
          data-visual-viewport-shell
          className="flex h-full min-h-0 w-full flex-col overflow-hidden"
          style={{ boxSizing: 'border-box' }}
          aria-hidden={isForwardHidden}
        >
          {children}
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{
        type: 'tween',
        duration: NAV_SWIPE_COMPLETE_S,
        ease: NAV_SWIPE_EASE,
      }}
      style={navigationStackShellStyleDesktop}
    >
      {children}
    </motion.div>
  );
}
