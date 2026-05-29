import { useState, useCallback, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { NavigationStack } from '../components/NavigationStack';
import { MOBILE_VV_CSS } from '../lib/mobileViewport';

interface StackScreen {
  id: string;
  content: React.ReactNode;
  skipEnterAnimation?: boolean;
}

interface UseEdgeBackNavigationProps {
  baseContent: React.ReactNode;
  onStackChange?: (stackDepth: number) => void;
  /** Swipe right on the preview layer to reopen the last chat (Discord-style). */
  onForwardSwipe?: () => void;
}

const previewShellStyle = {
  position: 'fixed' as const,
  top: `var(${MOBILE_VV_CSS.offsetTop}, 0px)`,
  left: 0,
  right: 0,
  height: `var(${MOBILE_VV_CSS.height}, 100dvh)`,
  paddingBottom: `var(${MOBILE_VV_CSS.bottomInset}, 0px)`,
  zIndex: 0,
  overflow: 'hidden' as const,
};

export function useEdgeBackNavigation({
  baseContent,
  onStackChange,
  onForwardSwipe,
}: UseEdgeBackNavigationProps) {
  const [stack, setStack] = useState<StackScreen[]>([]);
  const [forwardDragX, setForwardDragX] = useState(0);
  const stackIdCounter = useRef(0);
  const onStackChangeRef = useRef(onStackChange);
  const onForwardSwipeRef = useRef(onForwardSwipe);
  const lastScreenCacheRef = useRef<StackScreen | null>(null);
  const forwardAnimFrameRef = useRef<number | null>(null);
  onStackChangeRef.current = onStackChange;
  onForwardSwipeRef.current = onForwardSwipe;

  const forwardDragRef = useRef({
    startX: 0,
    startY: 0,
    currentX: 0,
    directionLocked: false,
    isVerticalScroll: false,
    isDragging: false,
  });

  useEffect(() => {
    if (stack.length > 0) {
      lastScreenCacheRef.current = stack[stack.length - 1];
    }
    onStackChangeRef.current?.(stack.length);
    if (stack.length > 0) {
      window.dispatchEvent(new CustomEvent('mobile-chat-stack-open'));
      setForwardDragX(0);
    } else {
      window.dispatchEvent(new CustomEvent('mobile-chat-stack-close'));
    }
  }, [stack]);

  useEffect(() => {
    return () => {
      if (forwardAnimFrameRef.current) {
        cancelAnimationFrame(forwardAnimFrameRef.current);
      }
    };
  }, []);

  const pushScreen = useCallback((content: React.ReactNode, id?: string) => {
    const screenId = id || `screen-${++stackIdCounter.current}`;
    setStack((prev) => [...prev, { id: screenId, content, skipEnterAnimation: false }]);
  }, []);

  const popScreen = useCallback(() => {
    setStack((prev) => prev.slice(0, -1));
  }, []);

  const clearStack = useCallback(() => {
    setStack([]);
  }, []);

  const animateForwardDrag = useCallback(
    (from: number, to: number, onDone?: () => void) => {
      if (forwardAnimFrameRef.current) {
        cancelAnimationFrame(forwardAnimFrameRef.current);
      }
      const startTime = performance.now();
      const duration = 220;

      const animate = (now: number) => {
        const progress = Math.min((now - startTime) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const value = from + (to - from) * eased;
        setForwardDragX(value);

        if (progress < 1) {
          forwardAnimFrameRef.current = requestAnimationFrame(animate);
        } else {
          forwardAnimFrameRef.current = null;
          setForwardDragX(to);
          onDone?.();
        }
      };

      forwardAnimFrameRef.current = requestAnimationFrame(animate);
    },
    []
  );

  const handleBaseTouchStart = (event: React.TouchEvent) => {
    if (stack.length > 0 || !onForwardSwipeRef.current || !lastScreenCacheRef.current) return;
    const touch = event.touches[0];
    forwardDragRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      currentX: touch.clientX,
      directionLocked: false,
      isVerticalScroll: false,
      isDragging: false,
    };
  };

  const handleBaseTouchMove = (event: React.TouchEvent) => {
    if (stack.length > 0 || !onForwardSwipeRef.current || !lastScreenCacheRef.current) return;
    const touch = event.touches[0];
    const drag = forwardDragRef.current;
    const deltaX = touch.clientX - drag.startX;
    const deltaY = touch.clientY - drag.startY;

    if (!drag.directionLocked) {
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);
      if (absDeltaX > 10 || absDeltaY > 10) {
        drag.directionLocked = true;
        if (absDeltaY > absDeltaX * 1.3) {
          drag.isVerticalScroll = true;
          return;
        }
        if (deltaX <= 0 || drag.startX > window.innerWidth * 0.45) {
          drag.isVerticalScroll = true;
          return;
        }
        drag.isDragging = true;
      } else {
        return;
      }
    }

    if (drag.isVerticalScroll || !drag.isDragging) return;
    drag.currentX = touch.clientX;

    const positiveDelta = Math.max(0, drag.currentX - drag.startX);
    setForwardDragX(Math.min(positiveDelta, window.innerWidth));

    if (event.cancelable) event.preventDefault();
  };

  const handleBaseTouchEnd = () => {
    if (stack.length > 0 || !onForwardSwipeRef.current || !lastScreenCacheRef.current) return;
    const drag = forwardDragRef.current;
    if (!drag.isDragging) return;

    const deltaX = Math.max(0, drag.currentX - drag.startX);
    const threshold = window.innerWidth * 0.28;

    forwardDragRef.current = {
      startX: 0,
      startY: 0,
      currentX: 0,
      directionLocked: false,
      isVerticalScroll: false,
      isDragging: false,
    };

    if (deltaX > threshold) {
      animateForwardDrag(deltaX, window.innerWidth, () => {
        const cached = lastScreenCacheRef.current;
        if (cached) {
          setStack([{ ...cached, skipEnterAnimation: true }]);
        }
        onForwardSwipeRef.current?.();
      });
    } else {
      animateForwardDrag(deltaX, 0);
    }
  };

  const renderLayers = useCallback(() => {
    const hasOverlay = stack.length > 0;
    const cachedScreen = lastScreenCacheRef.current;
    const showForwardPreview =
      !hasOverlay && forwardDragX > 0 && cachedScreen != null && onForwardSwipeRef.current;

    return (
      <>
        <div
          data-messages-preview-shell
          onTouchStart={handleBaseTouchStart}
          onTouchMove={handleBaseTouchMove}
          onTouchEnd={handleBaseTouchEnd}
          onTouchCancel={handleBaseTouchEnd}
          style={{
            ...previewShellStyle,
            pointerEvents: hasOverlay ? 'none' : 'auto',
            touchAction: hasOverlay || showForwardPreview ? 'none' : 'pan-y',
            overscrollBehavior: 'none',
          }}
        >
          {baseContent}
        </div>

        {showForwardPreview ? (
          <motion.div
            key="forward-chat-preview"
            style={{
              ...previewShellStyle,
              zIndex: 5,
              backgroundColor: 'var(--color-background, #0d0d0d)',
              boxShadow: '-5px 0 20px rgba(0,0,0,0.15)',
              pointerEvents: 'none',
              transform: `translateX(${Math.max(0, window.innerWidth - forwardDragX)}px)`,
              willChange: 'transform',
            }}
          >
            <div
              data-visual-viewport-shell
              className="flex h-full min-h-0 w-full flex-col overflow-hidden"
            >
              {cachedScreen.content}
            </div>
          </motion.div>
        ) : null}

        <AnimatePresence mode="sync">
          {stack.map((screen, index) => {
            if (index !== stack.length - 1) return null;

            return (
              <NavigationStack
                key={screen.id}
                onBack={popScreen}
                skipEnterAnimation={screen.skipEnterAnimation}
              >
                {screen.content}
              </NavigationStack>
            );
          })}
        </AnimatePresence>
      </>
    );
  }, [stack, baseContent, popScreen, forwardDragX]);

  return {
    pushScreen,
    popScreen,
    clearStack,
    renderLayers,
  };
}
