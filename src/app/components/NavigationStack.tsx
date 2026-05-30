import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { MOBILE_VV_CSS } from '../lib/mobileViewport';
import { useMobileViewportDriver } from '../hooks/useMobileViewportInsets';

interface NavigationStackProps {
  children: React.ReactNode;
  onBack: () => void;
  skipEnterAnimation?: boolean;
}

const shellStyle = {
  position: 'fixed' as const,
  top: `var(${MOBILE_VV_CSS.offsetTop}, 0px)`,
  left: 0,
  right: 0,
  height: `var(${MOBILE_VV_CSS.height}, 100dvh)`,
  paddingBottom: `var(${MOBILE_VV_CSS.bottomInset}, 0px)`,
  bottom: 'auto' as const,
  zIndex: 10,
  backgroundColor: 'var(--color-background, #0d0d0d)',
  boxShadow: '-5px 0 20px rgba(0,0,0,0.15)',
  overflow: 'hidden' as const,
  overscrollBehavior: 'contain' as const,
  overscrollBehaviorX: 'contain' as const,
  overscrollBehaviorY: 'none' as const,
};

export function NavigationStack({ children, onBack, skipEnterAnimation = false }: NavigationStackProps) {
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
  const animationFrameRef = useRef<number | null>(null);
  const translateXRef = useRef(0);
  const pendingTranslateFrameRef = useRef<number | null>(null);
  useMobileViewportDriver(isMobile);

  const setSwipeBackLock = (locked: boolean) => {
    isDraggingRef.current = locked;
    setSwipeBackLocked(locked);
    if (typeof document === 'undefined') return;
    if (locked) {
      document.documentElement.dataset.swipeBackLock = '1';
      document.body.style.overflow = 'hidden';
    } else {
      delete document.documentElement.dataset.swipeBackLock;
      document.body.style.overflow = '';
    }
  };

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => {
      window.removeEventListener('resize', checkMobile);
      delete document.documentElement.dataset.swipeBackLock;
      document.body.style.overflow = '';
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (pendingTranslateFrameRef.current !== null) {
        cancelAnimationFrame(pendingTranslateFrameRef.current);
      }
    };
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (pendingTranslateFrameRef.current !== null) {
      cancelAnimationFrame(pendingTranslateFrameRef.current);
      pendingTranslateFrameRef.current = null;
    }

    const startX = e.touches[0].clientX;
    const startY = e.touches[0].clientY;
    const now = performance.now();

    startXRef.current = startX;
    startYRef.current = startY;
    currentXRef.current = startX;
    lastTouchXRef.current = startX;
    lastTouchTimeRef.current = now;
    translateXRef.current = 0;
    setTranslateX(0);
    directionLockedRef.current = false;
    isVerticalScrollRef.current = false;
    setSwipeBackLock(false);

  const handleTouchMove = (e: React.TouchEvent) => {
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;

    const deltaX = currentX - startXRef.current;
    const deltaY = currentY - startYRef.current;

    if (!directionLockedRef.current) {
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);

      if (absDeltaX > 10 || absDeltaY > 10) {
        directionLockedRef.current = true;

        if (absDeltaY > absDeltaX * 1.65) {
          isVerticalScrollRef.current = true;
          setSwipeBackLock(false);
          return;
        }

        isVerticalScrollRef.current = false;
        setSwipeBackLock(true);
      } else {
        return;
      }
    }

    if (isVerticalScrollRef.current) {
      return;
    }

    if (!isDraggingRef.current) return;

    const positiveDeltaX = Math.max(0, deltaX);

    if (positiveDeltaX > 0) {
      if (e.cancelable) {
        e.preventDefault();
      }

      currentXRef.current = currentX;
      const constrainedDelta = Math.min(positiveDeltaX, window.innerWidth);
      translateXRef.current = constrainedDelta;

      const now = performance.now();
      lastTouchXRef.current = currentX;
      lastTouchTimeRef.current = now;

      if (pendingTranslateFrameRef.current === null) {
        pendingTranslateFrameRef.current = requestAnimationFrame(() => {
          setTranslateX(translateXRef.current);
          pendingTranslateFrameRef.current = null;
        });
      }
    }
  };

  const handleTouchEnd = () => {
    if (pendingTranslateFrameRef.current !== null) {
      cancelAnimationFrame(pendingTranslateFrameRef.current);
      pendingTranslateFrameRef.current = null;
    }

    const width = window.innerWidth;
    const deltaX = currentXRef.current - startXRef.current;
    const timeDelta = performance.now() - lastTouchTimeRef.current;
    const velocity = timeDelta > 0 ? (currentXRef.current - lastTouchXRef.current) / timeDelta : 0;
    const distance = translateXRef.current;
    const velocityThreshold = 0.35;
    const distanceThreshold = Math.max(56, width * 0.33);

    const shouldGoBack = velocity > velocityThreshold || distance > distanceThreshold;

    if (shouldGoBack) {
      setTranslateX(width);
      requestAnimationFrame(onBack);
    } else if (distance > 0) {
      animateToZero(distance);
    }

    setSwipeBackLock(false);
    translateXRef.current = 0;
  };

  const animateToZero = (startValue: number) => {
    const startTime = performance.now();
    const duration = 200;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const currentValue = startValue * (1 - eased);

      setTranslateX(currentValue);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);
  };

  const isSwipeDragging = translateX > 0 || swipeBackLocked;

  if (isMobile) {
    return (
      <motion.div
        initial={skipEnterAnimation ? false : { x: '100%' }}
        animate={{ x: translateX }}
        exit={{ x: '100%' }}
        transition={
          isSwipeDragging
            ? { duration: 0 }
            : { type: 'tween', duration: 0.28, ease: [0.32, 0.72, 0, 1] }
        }
        onTouchStart={handleTouchStart}
        onTouchStartCapture={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchMoveCapture={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchEndCapture={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onTouchCancelCapture={handleTouchEnd}
        style={{
          ...shellStyle,
          willChange: 'transform',
          touchAction: swipeBackLocked ? 'none' : 'pan-y',
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
        duration: 0.28,
        ease: [0.32, 0.72, 0, 1],
      }}
      style={{
        ...shellStyle,
        top: 0,
        height: '100%',
        paddingBottom: 0,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {children}
    </motion.div>
  );
}
