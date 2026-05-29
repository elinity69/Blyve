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

const FORWARD_EDGE_RATIO = 0.5;

function setForwardSwipeLock(locked: boolean) {
  if (typeof document === 'undefined') return;
  if (locked) {
    document.documentElement.dataset.forwardSwipeLock = '1';
  } else {
    delete document.documentElement.dataset.forwardSwipeLock;
  }
}

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
  const previewShellRef = useRef<HTMLDivElement | null>(null);
  const stackRef = useRef<StackScreen[]>([]);
  onStackChangeRef.current = onStackChange;
  onForwardSwipeRef.current = onForwardSwipe;
  stackRef.current = stack;

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
      setForwardSwipeLock(false);
    } else {
      window.dispatchEvent(new CustomEvent('mobile-chat-stack-close'));
    }
  }, [stack]);

  useEffect(() => {
    return () => {
      if (forwardAnimFrameRef.current) {
        cancelAnimationFrame(forwardAnimFrameRef.current);
      }
      setForwardSwipeLock(false);
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

  useEffect(() => {
    const shell = previewShellRef.current;
    if (!shell) return;

    const resetDrag = () => {
      forwardDragRef.current = {
        startX: 0,
        startY: 0,
        currentX: 0,
        directionLocked: false,
        isVerticalScroll: false,
        isDragging: false,
      };
      setForwardSwipeLock(false);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (stackRef.current.length > 0 || !onForwardSwipeRef.current || !lastScreenCacheRef.current) {
        return;
      }

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

    const onTouchMove = (event: TouchEvent) => {
      if (stackRef.current.length > 0 || !onForwardSwipeRef.current || !lastScreenCacheRef.current) {
        return;
      }

      const touch = event.touches[0];
      const drag = forwardDragRef.current;
      const deltaX = touch.clientX - drag.startX;
      const deltaY = touch.clientY - drag.startY;

      if (!drag.directionLocked) {
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);
        if (absDeltaX > 8 || absDeltaY > 8) {
          drag.directionLocked = true;
          const edgeLimit = window.innerWidth * FORWARD_EDGE_RATIO;
          if (absDeltaY > absDeltaX * 1.15 || deltaX <= 0 || drag.startX > edgeLimit) {
            drag.isVerticalScroll = true;
            return;
          }
          drag.isDragging = true;
          setForwardSwipeLock(true);
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

    const onTouchEnd = () => {
      if (stackRef.current.length > 0 || !onForwardSwipeRef.current || !lastScreenCacheRef.current) {
        resetDrag();
        return;
      }

      const drag = forwardDragRef.current;
      if (!drag.isDragging) {
        resetDrag();
        return;
      }

      const deltaX = Math.max(0, drag.currentX - drag.startX);
      const threshold = window.innerWidth * 0.28;

      resetDrag();

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

    shell.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    shell.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    shell.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    shell.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true });

    return () => {
      shell.removeEventListener('touchstart', onTouchStart, { capture: true });
      shell.removeEventListener('touchmove', onTouchMove, { capture: true });
      shell.removeEventListener('touchend', onTouchEnd, { capture: true });
      shell.removeEventListener('touchcancel', onTouchEnd, { capture: true });
    };
  }, [animateForwardDrag]);

  const renderLayers = useCallback(() => {
    const hasOverlay = stack.length > 0;
    const cachedScreen = lastScreenCacheRef.current;
    const showForwardPreview =
      !hasOverlay && forwardDragX > 0 && cachedScreen != null && onForwardSwipeRef.current;

    return (
      <>
        <div
          ref={previewShellRef}
          data-messages-preview-shell
          style={{
            ...previewShellStyle,
            pointerEvents: hasOverlay ? 'none' : 'auto',
            touchAction: hasOverlay || showForwardPreview ? 'none' : 'manipulation',
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
