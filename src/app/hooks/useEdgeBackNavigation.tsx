import { useState, useCallback, useRef, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { NavigationStack } from '../components/NavigationStack';

interface UseEdgeBackNavigationProps {
  baseContent: React.ReactNode;
  onStackChange?: (stackDepth: number) => void;
  /** Swipe right on the preview layer to reopen the last chat (Discord-style). */
  onForwardSwipe?: () => void;
}

export function useEdgeBackNavigation({
  baseContent,
  onStackChange,
  onForwardSwipe,
}: UseEdgeBackNavigationProps) {
  const [stack, setStack] = useState<Array<{ id: string; content: React.ReactNode }>>([]);
  const stackIdCounter = useRef(0);
  const onStackChangeRef = useRef(onStackChange);
  const onForwardSwipeRef = useRef(onForwardSwipe);
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
    onStackChangeRef.current?.(stack.length);
    if (stack.length > 0) {
      window.dispatchEvent(new CustomEvent('mobile-chat-stack-open'));
    } else {
      window.dispatchEvent(new CustomEvent('mobile-chat-stack-close'));
    }
  }, [stack.length]);

  const pushScreen = useCallback((content: React.ReactNode, id?: string) => {
    const screenId = id || `screen-${++stackIdCounter.current}`;
    setStack((prev) => [...prev, { id: screenId, content }]);
  }, []);

  const popScreen = useCallback(() => {
    setStack((prev) => prev.slice(0, -1));
  }, []);

  const clearStack = useCallback(() => {
    setStack([]);
  }, []);

  const handleBaseTouchStart = (event: React.TouchEvent) => {
    if (stack.length > 0 || !onForwardSwipeRef.current) return;
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
    if (stack.length > 0 || !onForwardSwipeRef.current) return;
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
    if (event.cancelable) event.preventDefault();
  };

  const handleBaseTouchEnd = () => {
    if (stack.length > 0 || !onForwardSwipeRef.current) return;
    const drag = forwardDragRef.current;
    if (!drag.isDragging) return;

    const deltaX = Math.max(0, drag.currentX - drag.startX);
    if (deltaX > window.innerWidth * 0.28) {
      onForwardSwipeRef.current();
    }

    forwardDragRef.current = {
      startX: 0,
      startY: 0,
      currentX: 0,
      directionLocked: false,
      isVerticalScroll: false,
      isDragging: false,
    };
  };

  const renderLayers = useCallback(() => {
    const hasOverlay = stack.length > 0;

    return (
      <>
        <div
          onTouchStart={handleBaseTouchStart}
          onTouchMove={handleBaseTouchMove}
          onTouchEnd={handleBaseTouchEnd}
          onTouchCancel={handleBaseTouchEnd}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 0,
            transform: 'translateX(0)',
            pointerEvents: hasOverlay ? 'none' : 'auto',
            touchAction: hasOverlay ? 'none' : 'pan-y',
            willChange: hasOverlay ? 'auto' : 'auto',
          }}
        >
          {baseContent}
        </div>

        <AnimatePresence mode="sync">
          {stack.map((screen, index) => {
            if (index !== stack.length - 1) return null;

            return (
              <NavigationStack key={screen.id} onBack={popScreen}>
                {screen.content}
              </NavigationStack>
            );
          })}
        </AnimatePresence>
      </>
    );
  }, [stack, baseContent, popScreen]);

  return {
    pushScreen,
    popScreen,
    clearStack,
    renderLayers,
  };
}
