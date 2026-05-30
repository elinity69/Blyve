import { useState, useCallback, useRef, useEffect } from 'react';
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
  overflowX: 'hidden' as const,
  overflowY: 'hidden' as const,
};

export function useEdgeBackNavigation({
  baseContent,
  onStackChange,
  onForwardSwipe,
}: UseEdgeBackNavigationProps) {
  const [stack, setStack] = useState<StackScreen[]>([]);
  const stackIdCounter = useRef(0);
  const onStackChangeRef = useRef(onStackChange);
  const onForwardSwipeRef = useRef(onForwardSwipe);
  const lastScreenCacheRef = useRef<StackScreen | null>(null);
  const previewShellRef = useRef<HTMLDivElement | null>(null);
  const stackRef = useRef<StackScreen[]>([]);
  const lastReportedStackDepthRef = useRef<number | null>(null);
  onStackChangeRef.current = onStackChange;
  onForwardSwipeRef.current = onForwardSwipe;
  stackRef.current = stack;

  useEffect(() => {
    const stackDepth = stack.length;

    if (stackDepth > 0) {
      lastScreenCacheRef.current = stack[stackDepth - 1];
    }

    if (lastReportedStackDepthRef.current !== stackDepth) {
      lastReportedStackDepthRef.current = stackDepth;
      onStackChangeRef.current?.(stackDepth);
    }

    if (stackDepth > 0) {
      window.dispatchEvent(new CustomEvent('mobile-chat-stack-open'));
    } else {
      window.dispatchEvent(new CustomEvent('mobile-chat-stack-close'));
    }
  }, [stack]);

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

  const handleForwardComplete = useCallback(() => {
    const cached = lastScreenCacheRef.current;
    if (!cached) return;
    setStack([{ ...cached, skipEnterAnimation: true }]);
    onForwardSwipeRef.current?.();
  }, []);

  const renderLayers = useCallback(() => {
    const topStack = stack[stack.length - 1];
    const cachedScreen = lastScreenCacheRef.current;
    const canForwardPull =
      !topStack && cachedScreen != null && onForwardSwipeRef.current != null;
    const overlayScreen = topStack ?? (canForwardPull ? cachedScreen : null);
    const isForwardPull = canForwardPull;

    return (
      <>
        <div
          ref={previewShellRef}
          data-messages-preview-shell
          style={{
            ...previewShellStyle,
            pointerEvents: topStack ? 'none' : 'auto',
            touchAction: topStack ? 'none' : 'manipulation',
            overscrollBehavior: 'none',
          }}
        >
          {baseContent}
        </div>

        {overlayScreen ? (
          <NavigationStack
            key={overlayScreen.id}
            isForwardPull={isForwardPull}
            forwardShellRef={previewShellRef}
            skipEnterAnimation={topStack?.skipEnterAnimation ?? true}
            onBack={popScreen}
            onForwardComplete={handleForwardComplete}
          >
            {overlayScreen.content}
          </NavigationStack>
        ) : null}
      </>
    );
  }, [stack, baseContent, popScreen, handleForwardComplete]);

  return {
    pushScreen,
    popScreen,
    clearStack,
    renderLayers,
  };
}
