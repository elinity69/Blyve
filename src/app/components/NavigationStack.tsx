import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useMobileViewportInsets } from '../hooks/useMobileViewportInsets';

interface NavigationStackProps {
  children: React.ReactNode;
  onBack: () => void;
  onEdgeDragProgress?: (progress: number) => void;
}

export function NavigationStack({ children, onBack, onEdgeDragProgress }: NavigationStackProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [translateX, setTranslateX] = useState(0);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const currentXRef = useRef(0);
  const directionLockedRef = useRef(false);
  const isVerticalScrollRef = useRef(false);
  const allowEdgeBackRef = useRef(true);
  const isDraggingRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null); // ✅ NEU
  const enterAnimationStateRef = useRef<'idle' | 'running' | 'done'>('idle');
  const viewportFrame = useMobileViewportInsets(isMobile);

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      console.log('📱 IS MOBILE:', mobile, '| WIDTH:', window.innerWidth);
      setIsMobile(mobile);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => {
      window.removeEventListener('resize', checkMobile);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const handleTouchStart = (e: React.TouchEvent) => {
    console.log('👆 TOUCH START');
    
    // ✅ Cancel any ongoing animation
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    const startX = e.touches[0].clientX;
    const startY = e.touches[0].clientY;

    // Edge-only: back gesture starts from the left screen edge
    if (startX > 80) {
      allowEdgeBackRef.current = false;
      isDraggingRef.current = false;
      return;
    }

    allowEdgeBackRef.current = true;
    startXRef.current = startX;
    startYRef.current = startY;
    currentXRef.current = startX;

    // Direction lock reset
    directionLockedRef.current = false;
    isVerticalScrollRef.current = false;
    isDraggingRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const currentX = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    if (!allowEdgeBackRef.current) return;
    
    const deltaX = currentX - startXRef.current;
    const deltaY = currentY - startYRef.current;
    
    // ✅ Direction Detection (iOS-style)
    if (!directionLockedRef.current) {
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);

      if (absDeltaX > 10 || absDeltaY > 10) {
        directionLockedRef.current = true;

        if (absDeltaY > absDeltaX * 1.3) {
          isVerticalScrollRef.current = true;
          isDraggingRef.current = false;
          return;
        }

        isVerticalScrollRef.current = false;
        isDraggingRef.current = true;

        if (typeof document !== 'undefined') {
          document.body.style.overflow = 'hidden';
        }
      } else {
        return;
      }
    }

    if (isVerticalScrollRef.current) {
      return;
    }

    if (!isDraggingRef.current) return;

    const positiveDeltaX = Math.max(0, deltaX);
    
    console.log('🔵 TOUCH MOVE - Delta:', positiveDeltaX);
    
    if (positiveDeltaX > 0) {
      if (e.cancelable) {
        e.preventDefault();
      }

      currentXRef.current = currentX;
      
      // ✅ CONSTRAINT: Max bei window.innerWidth (100%)
      const constrainedDelta = Math.min(positiveDeltaX, window.innerWidth);
      
      setTranslateX(constrainedDelta);
      onEdgeDragProgress?.(constrainedDelta);
      
      const progress = (constrainedDelta / window.innerWidth) * 100;
      console.log('🟢 PROGRESS:', progress);
    }
  };

  const handleTouchEnd = () => {
    // Reset direction locks
    directionLockedRef.current = false;
    isVerticalScrollRef.current = false;
    allowEdgeBackRef.current = true;

    if (typeof document !== 'undefined') {
      document.body.style.overflow = '';
    }

    if (!isDraggingRef.current) {
      return;
    }
    
    isDraggingRef.current = false;
    if (typeof document !== 'undefined') {
      document.body.style.overflow = '';
    }

    const deltaX = Math.max(0, currentXRef.current - startXRef.current);
    const threshold = window.innerWidth * 0.4;
    
    console.log('🔴 TOUCH END - Distance:', deltaX, 'Threshold:', threshold);
    
    if (deltaX > threshold) {
      console.log('✅ TRIGGERING BACK');
      animateToComplete(deltaX);
    } else {
      console.log('❌ NOT ENOUGH - RESETTING');
      animateToZero(deltaX);
    }
  };

  // ✅ Animation to complete (back gesture)
  const animateToComplete = (startValue: number) => {
    const targetValue = window.innerWidth;
    const startTime = performance.now();
    const duration = 200; // Fixed duration for consistency

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const currentValue = startValue + (targetValue - startValue) * eased;
      
      setTranslateX(currentValue);
      onEdgeDragProgress?.(currentValue);
      
      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        // ✅ Animation complete → trigger callback
        onBack();
        setTranslateX(0);
        onEdgeDragProgress?.(0);
        animationFrameRef.current = null;
      }
    };
    
    animationFrameRef.current = requestAnimationFrame(animate);
  };

  // ✅ Animation to zero (cancel gesture)
  const animateToZero = (startValue: number) => {
    const startTime = performance.now();
    const duration = 200;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const currentValue = startValue * (1 - eased);
      
      setTranslateX(currentValue);
      onEdgeDragProgress?.(currentValue);
      
      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        animationFrameRef.current = null;
      }
    };
    
    animationFrameRef.current = requestAnimationFrame(animate);
  };

  // ✅ Animation in (clone of back animation, reversed)
  const animateIn = (startValue: number, callback?: () => void) => {
    const targetValue = 0;
    const startTime = performance.now();
    const duration = 200; // Same duration as back

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease-out cubic (same as back)
      const eased = 1 - Math.pow(1 - progress, 3);
      const currentValue = startValue + (targetValue - startValue) * eased;

      setTranslateX(currentValue);
      onEdgeDragProgress?.(currentValue);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        animationFrameRef.current = null;
        callback?.();
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);
  };

  // ✅ Animate in once on mount (guarded)
  useEffect(() => {
    if (!isMobile) return;
    if (enterAnimationStateRef.current !== 'idle') return;

    // Cancel any ongoing animation before starting
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    enterAnimationStateRef.current = 'running';
    const startValue = window.innerWidth;
    setTranslateX(startValue);
    onEdgeDragProgress?.(startValue);

    animateIn(startValue, () => {
      enterAnimationStateRef.current = 'done';
      setTranslateX(0);
      onEdgeDragProgress?.(0);
    });

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (enterAnimationStateRef.current === 'running') {
        enterAnimationStateRef.current = 'idle';
      }
    };
  }, [isMobile, onEdgeDragProgress]);

  // MOBILE: touch back-from-edge
  if (isMobile) {
    return (
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd} // ✅ Handle touch cancel
        style={{
          position: 'fixed',
          top: viewportFrame.offsetTop,
          left: 0,
          right: 0,
          height: viewportFrame.height,
          bottom: 'auto',
          zIndex: 10,
          backgroundColor: 'var(--color-background, white)',
          boxShadow: '-5px 0 20px rgba(0,0,0,0.15)',
          transform: `translateX(${translateX}px)`,
          willChange: isDraggingRef.current ? 'transform' : 'auto',
          overflow: 'hidden',
          touchAction: 'pan-y',
        }}
      >
        <div
          data-visual-viewport-shell
          className="flex h-full min-h-0 w-full flex-col overflow-hidden"
        >
          {children}
        </div>
      </div>
    );
  }

  // DESKTOP: Slide animation
  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ 
        type: 'tween',
        duration: 0.25,
        ease: 'easeOut'
      }}
      style={{ 
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10,
        backgroundColor: 'var(--color-background, white)',
        boxShadow: '-5px 0 20px rgba(0,0,0,0.15)',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch'
      }}
    >
      {children}
    </motion.div>
  );
}
