import { useState, useCallback, useRef, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { NavigationStack } from '../components/NavigationStack';

interface UseEdgeBackNavigationProps {
  baseContent: React.ReactNode;
  onStackChange?: (stackDepth: number) => void;
}

export function useEdgeBackNavigation({ baseContent, onStackChange }: UseEdgeBackNavigationProps) {
  const [stack, setStack] = useState<Array<{ id: string; content: React.ReactNode }>>([]);
  const [edgeDragProgress, setEdgeDragProgress] = useState(0);
  const stackIdCounter = useRef(0);
  const onStackChangeRef = useRef(onStackChange);
  onStackChangeRef.current = onStackChange;

  useEffect(() => {
    onStackChangeRef.current?.(stack.length);
  }, [stack.length]);

  const pushScreen = useCallback((content: React.ReactNode, id?: string) => {
    const screenId = id || `screen-${++stackIdCounter.current}`;
    setStack((prev) => [...prev, { id: screenId, content }]);
  }, []);

  const popScreen = useCallback(() => {
    setStack((prev) => prev.slice(0, -1));
    setEdgeDragProgress(0);
  }, []);

  const clearStack = useCallback(() => {
    setStack([]);
    setEdgeDragProgress(0);
  }, []);

  const renderLayers = useCallback(() => {
    const hasOverlay = stack.length > 0;

    const clampedProgress = Math.min(edgeDragProgress, window.innerWidth);
    const progressPercent = (clampedProgress / window.innerWidth) * 100;

    const layerATransform = hasOverlay
      ? `translateX(${Math.max(-100, -100 + progressPercent)}%)`
      : 'translateX(0)';

    return (
      <>
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 0,
            transform: layerATransform,
            transition: clampedProgress === 0 && !hasOverlay ? 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
            pointerEvents: hasOverlay ? 'none' : 'auto',
            touchAction: hasOverlay ? 'none' : 'auto',
            willChange: hasOverlay ? 'transform' : 'auto',
          }}
        >
          {baseContent}
        </div>

        <AnimatePresence mode="sync">
          {stack.map((screen, index) => {
            if (index !== stack.length - 1) return null;

            return (
              <NavigationStack
                key={screen.id}
                onBack={popScreen}
                onEdgeDragProgress={setEdgeDragProgress}
              >
                {screen.content}
              </NavigationStack>
            );
          })}
        </AnimatePresence>
      </>
    );
  }, [stack, baseContent, popScreen, edgeDragProgress]);

  return {
    pushScreen,
    popScreen,
    clearStack,
    renderLayers,
  };
}
