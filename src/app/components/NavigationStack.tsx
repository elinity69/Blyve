import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useMobileViewportDriver } from '../hooks/useMobileViewportInsets';
import {
  FORWARD_EDGE_RATIO,
  NAV_SWIPE_CANCEL_MS,
  NAV_SWIPE_COMPLETE_S,
  NAV_SWIPE_DISTANCE_RATIO,
  NAV_SWIPE_EASE,
  NAV_SWIPE_MIN_DISTANCE_PX,
  NAV_SWIPE_VELOCITY_THRESHOLD,
  navigationStackShellStyle,
  navigationStackShellStyleDesktop,
} from '../lib/navigationShellStyle';

interface NavigationStackProps {
  children: React.ReactNode;
  onBack: () => void;
  skipEnterAnimation?: boolean;
  /** Pull cached screen in from the right edge (Discord-style). */
  isForwardPull?: boolean;
  forwardShellRef?: React.RefObject<HTMLDivElement | null>;
  onForwardComplete?: () => void;
}

function getViewportWidth() {
  return typeof window !== 'undefined' ? window.innerWidth : 0;
}

function setForwardSwipeLock(locked: boolean, shell?: HTMLDivElement | null) {
  if (typeof document === 'undefined') return;
  if (locked) {
    document.documentElement.dataset.forwardSwipeLock = '1';
    if (shell) shell.style.touchAction = 'none';
  } else {
    delete document.documentElement.dataset.forwardSwipeLock;
    if (shell) shell.style.touchAction = '';
  }
}

export function NavigationStack({
  children,
  onBack,
  skipEnterAnimation = false,
  isForwardPull = false,
  forwardShellRef,
  onForwardComplete,
}: NavigationStackProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [translateX, setTranslateX] = useState(0);
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
  const onForwardCompleteRef = useRef(onForwardComplete);
  onBackRef.current = onBack;
  onForwardCompleteRef.current = onForwardComplete;

  useMobileViewportDriver(isMobile);

  const setSwipeBackLock = (locked: boolean) => {
    isDraggingRef.current = locked;
    setSwipeBackLocked(locked);
    if (typeof document === 'undefined') return;
    if (locked) {
      document.documentElement.dataset.swipeBackLock = '1';
      document.body.style.overflowX = 'hidden';
      document.body.style.overflowY = 'hidden';
    } else {
      delete document.documentElement.dataset.swipeBackLock;
      document.body.style.overflowX = '';
      document.body.style.overflowY = '';
    }
  };

  useLayoutEffect(() => {
    translateXRef.current = 0;
    setTranslateX(0);
  }, [isForwardPull]);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => {
      window.removeEventListener('resize', checkMobile);
      delete document.documentElement.dataset.swipeBackLock;
      document.body.style.overflowX = '';
      document.body.style.overflowY = '';
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (pendingTranslateFrameRef.current !== null) {
        cancelAnimationFrame(pendingTranslateFrameRef.current);
      }
    };
  }, []);

  const applyTranslateX = (value: number) => {
    translateXRef.current = value;
    if (pendingTranslateFrameRef.current !== null) return;
    pendingTranslateFrameRef.current = requestAnimationFrame(() => {
      setTranslateX(translateXRef.current);
      pendingTranslateFrameRef.current = null;
    });
  };

  const animateToRest = (startValue: number, targetValue: number, onDone?: () => void) => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / NAV_SWIPE_CANCEL_MS, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const currentValue = startValue + (targetValue - startValue) * eased;

      setTranslateX(currentValue);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        animationFrameRef.current = null;
        setTranslateX(targetValue);
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
    setForwardSwipeLock(false, forwardShellRef?.current);
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

    const width = getViewportWidth();

    if (isForwardPull && startX <= width * FORWARD_EDGE_RATIO) {
      return;
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
    setForwardSwipeLock(false, forwardShellRef?.current);
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
          setForwardSwipeLock(true, forwardShellRef?.current);
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
    setForwardSwipeLock(false, forwardShellRef?.current);

    if (shouldComplete) {
      setTranslateX(width);
      requestAnimationFrame(() => {
        if (isForwardPull) {
          onForwardCompleteRef.current?.();
        } else {
          onBackRef.current();
        }
      });
    } else if (distance > 0) {
      animateToRest(distance, 0);
    }

    translateXRef.current = 0;
    resetTouchState();
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
      setForwardSwipeLock(false, shell);
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

  const width = getViewportWidth();
  const motionX = isForwardPull ? width - translateX : translateX;
  const isSwipeDragging = translateX > 0 || swipeBackLocked;

  if (isMobile) {
    return (
      <motion.div
        initial={
          skipEnterAnimation || isForwardPull
            ? false
            : { x: '100%' }
        }
        animate={{ x: motionX }}
        exit={{ x: '100%' }}
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
          willChange: 'transform',
          touchAction: isForwardPull ? 'none' : swipeBackLocked ? 'none' : 'pan-y',
          pointerEvents: isForwardPull ? 'none' : 'auto',
        }}
      >
        <div
          data-visual-viewport-shell
          className="flex h-full min-h-0 w-full flex-col overflow-hidden"
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
