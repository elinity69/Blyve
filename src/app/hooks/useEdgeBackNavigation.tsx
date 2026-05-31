import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { NavigationStack } from '../components/NavigationStack';
import { MOBILE_BOTTOM_NAV_HEIGHT_PX } from '../lib/navigationShellStyle';
import { MOBILE_VV_CSS } from '../lib/mobileViewport';
import { navDebug } from '../lib/navDebug';
import { useIsMobile } from '../components/ui/use-mobile';

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
  /** When false, hides the forward-pull cache (e.g. messages tab not active). */
  forwardSwipeEnabled?: boolean;
}

const navViewportClipStyle = {
  position: 'fixed' as const,
  top: `var(${MOBILE_VV_CSS.offsetTop}, 0px)`,
  left: 0,
  right: 0,
  bottom: 0,
  boxSizing: 'border-box' as const,
  paddingBottom: `var(${MOBILE_VV_CSS.bottomInset}, 0px)`,
  overflow: 'hidden' as const,
  isolation: 'isolate' as const,
  contain: 'layout paint' as const,
  zIndex: 1,
  pointerEvents: 'none' as const,
};

const previewShellStyle = {
  position: 'absolute' as const,
  inset: 0,
  zIndex: 0,
  overflow: 'hidden' as const,
  isolation: 'isolate' as const,
  backgroundColor: 'var(--color-background, #0d0d0d)',
};

/** List layer sits above the tab bar; chat stack is portaled at z-55. */
const mobilePreviewShellStyle = {
  position: 'fixed' as const,
  top: `var(${MOBILE_VV_CSS.offsetTop}, 0px)`,
  left: 0,
  right: 0,
  bottom: `${MOBILE_BOTTOM_NAV_HEIGHT_PX}px`,
  boxSizing: 'border-box' as const,
  zIndex: 1,
  overflow: 'hidden' as const,
  backgroundColor: 'var(--color-background, #0d0d0d)',
};

export function useEdgeBackNavigation({
  baseContent,
  onStackChange,
  onForwardSwipe,
  forwardSwipeEnabled = true,
}: UseEdgeBackNavigationProps) {
  const isMobile = useIsMobile();
  const [stack, setStack] = useState<StackScreen[]>([]);
  const stackIdCounter = useRef(0);
  const onStackChangeRef = useRef(onStackChange);
  const onForwardSwipeRef = useRef(onForwardSwipe);
  const lastScreenCacheRef = useRef<StackScreen | null>(null);
  const previewShellRef = useRef<HTMLDivElement | null>(null);
  const stackRef = useRef<StackScreen[]>([]);
  const lastReportedStackDepthRef = useRef<number | null>(null);
  const forwardSwipeEnabledRef = useRef(forwardSwipeEnabled);
  const lastRenderLogRef = useRef<string>('');
  const popScreenRef = useRef<() => void>(() => {});
  onStackChangeRef.current = onStackChange;
  onForwardSwipeRef.current = onForwardSwipe;
  forwardSwipeEnabledRef.current = forwardSwipeEnabled;
  stackRef.current = stack;

  useEffect(() => {
    if (forwardSwipeEnabled) return;
    lastScreenCacheRef.current = null;
  }, [forwardSwipeEnabled]);

  useEffect(() => {
    const stackDepth = stack.length;
    const stackIds = stack.map((s) => s.id);

    navDebug.log('nav', 'stack:depth', {
      depth: stackDepth,
      ids: stackIds,
      cachedId: lastScreenCacheRef.current?.id ?? null,
      forwardSwipeEnabled: forwardSwipeEnabledRef.current,
    });

    if (stackDepth > 0) {
      lastScreenCacheRef.current = stack[stackDepth - 1];
    }

    if (lastReportedStackDepthRef.current !== stackDepth) {
      lastReportedStackDepthRef.current = stackDepth;
      onStackChangeRef.current?.(stackDepth);
    }

    if (stackDepth > 0) {
      window.dispatchEvent(new CustomEvent('mobile-chat-stack-open'));
      const preview = previewShellRef.current;
      const active = document.activeElement;
      if (
        preview &&
        active instanceof HTMLElement &&
        preview.contains(active)
      ) {
        active.blur();
      }
    } else {
      window.dispatchEvent(new CustomEvent('mobile-chat-stack-close'));
    }
  }, [stack]);

  const pushScreen = useCallback((content: React.ReactNode, id?: string) => {
    const screenId = id || `screen-${++stackIdCounter.current}`;
    navDebug.log('nav', 'pushScreen', {
      screenId,
      prevDepth: stackRef.current.length,
      trace: navDebug.captureTrace(),
    });
    setStack((prev) => [...prev, { id: screenId, content, skipEnterAnimation: false }]);
  }, []);

  const popScreen = useCallback(() => {
    navDebug.log('nav', 'popScreen', {
      prevDepth: stackRef.current.length,
      topId: stackRef.current[stackRef.current.length - 1]?.id ?? null,
      trace: navDebug.captureTrace(),
    });
    setStack((prev) => prev.slice(0, -1));
  }, []);
  popScreenRef.current = popScreen;

  const tracedPopScreen = useCallback(() => {
    navDebug.log('nav', 'onBack', {
      trace: navDebug.captureTrace(),
    });
    popScreenRef.current();
  }, []);

  const clearStack = useCallback(() => {
    navDebug.log('nav', 'clearStack', {
      prevDepth: stackRef.current.length,
      trace: navDebug.captureTrace(),
    });
    setStack([]);
  }, []);

  const handleForwardComplete = useCallback(() => {
    const cached = lastScreenCacheRef.current;
    navDebug.log('nav', 'forwardComplete', {
      cachedId: cached?.id ?? null,
      trace: navDebug.captureTrace(),
    });
    if (!cached) return;
    setStack([{ ...cached, skipEnterAnimation: true }]);
    onForwardSwipeRef.current?.();
  }, []);

  const renderLayers = useCallback(() => {
    const topStack = stack[stack.length - 1];
    const cachedScreen = lastScreenCacheRef.current;
    const canForwardPull =
      forwardSwipeEnabledRef.current &&
      !topStack &&
      cachedScreen != null &&
      onForwardSwipeRef.current != null;
    const overlayScreen = topStack ?? (canForwardPull ? cachedScreen : null);
    const isForwardPull = canForwardPull;

    const renderKey = `${stack.length}|${topStack?.id ?? ''}|${overlayScreen?.id ?? ''}|${isForwardPull}|${topStack?.skipEnterAnimation ?? true}`;
    if (lastRenderLogRef.current !== renderKey) {
      lastRenderLogRef.current = renderKey;
      navDebug.log('nav', 'renderLayers', {
        depth: stack.length,
        topId: topStack?.id ?? null,
        overlayId: overlayScreen?.id ?? null,
        isForwardPull,
        skipEnter: topStack?.skipEnterAnimation ?? true,
        mobilePortal: isMobile,
      });
    }

    const stackOverlay = overlayScreen ? (
      <NavigationStack
        key={overlayScreen.id}
        screenId={overlayScreen.id}
        isForwardPull={isForwardPull}
        forwardShellRef={previewShellRef}
        skipEnterAnimation={topStack?.skipEnterAnimation ?? true}
        onBack={tracedPopScreen}
        onForwardComplete={handleForwardComplete}
      >
        {overlayScreen.content}
      </NavigationStack>
    ) : null;

    if (isMobile) {
      return (
        <>
          <div
            ref={previewShellRef}
            data-messages-preview-shell
            data-nav-messages-viewport
            style={{
              ...mobilePreviewShellStyle,
              pointerEvents: topStack ? 'none' : 'auto',
              touchAction: topStack ? 'none' : 'manipulation',
              overscrollBehavior: 'none',
            }}
          >
            {baseContent}
          </div>
          {stackOverlay && typeof document !== 'undefined'
            ? createPortal(stackOverlay, document.body)
            : null}
        </>
      );
    }

    return (
      <div style={navViewportClipStyle} data-nav-messages-viewport>
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
        {stackOverlay}
      </div>
    );
  }, [
    stack,
    baseContent,
    tracedPopScreen,
    handleForwardComplete,
    forwardSwipeEnabled,
    isMobile,
  ]);

  return {
    pushScreen,
    popScreen,
    clearStack,
    renderLayers,
  };
}
