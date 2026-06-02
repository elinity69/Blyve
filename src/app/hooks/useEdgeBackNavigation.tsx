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
  /** Static shell only — forward commit must push the live screen. */
  isForwardPreview?: boolean;
}

interface UseEdgeBackNavigationProps {
  baseContent: React.ReactNode;
  onStackChange?: (stackDepth: number) => void;
  /** Swipe right on the preview layer to reopen the last chat (Discord-style). */
  onForwardSwipe?: () => void;
  /** When false, hides the forward-pull cache (e.g. messages tab not active). */
  forwardSwipeEnabled?: boolean;
  /** When false, cached screen is ignored for forward-pull (DM vs group scope). */
  canForwardPull?: (cached: { id: string }) => boolean;
  /** Seed forward-pull cache synchronously before the pop commit (avoids one black frame). */
  onPopToPreview?: (poppedScreenId?: string | null) => void;
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
  canForwardPull,
  onPopToPreview,
}: UseEdgeBackNavigationProps) {
  const isMobile = useIsMobile();
  const [stack, setStack] = useState<StackScreen[]>([]);
  const [forwardCacheVersion, setForwardCacheVersion] = useState(0);
  const stackIdCounter = useRef(0);
  const onStackChangeRef = useRef(onStackChange);
  const onForwardSwipeRef = useRef(onForwardSwipe);
  const lastScreenCacheRef = useRef<StackScreen | null>(null);
  const previewShellRef = useRef<HTMLDivElement | null>(null);
  const stackRef = useRef<StackScreen[]>([]);
  const lastReportedStackDepthRef = useRef<number | null>(null);
  const forwardSwipeEnabledRef = useRef(forwardSwipeEnabled);
  const canForwardPullRef = useRef(canForwardPull);
  const lastRenderLogRef = useRef<string>('');
  const popScreenRef = useRef<() => void>(() => {});
  const onPopToPreviewRef = useRef(onPopToPreview);
  onStackChangeRef.current = onStackChange;
  onForwardSwipeRef.current = onForwardSwipe;
  onPopToPreviewRef.current = onPopToPreview;
  forwardSwipeEnabledRef.current = forwardSwipeEnabled;
  canForwardPullRef.current = canForwardPull;
  stackRef.current = stack;

  const bumpForwardCache = useCallback(() => {
    setForwardCacheVersion((v) => v + 1);
  }, []);

  const clearForwardCache = useCallback(() => {
    if (!lastScreenCacheRef.current) return;
    lastScreenCacheRef.current = null;
    bumpForwardCache();
  }, [bumpForwardCache]);

  const setForwardCache = useCallback(
    (content: React.ReactNode, id: string) => {
      lastScreenCacheRef.current = {
        id,
        content,
        skipEnterAnimation: true,
        isForwardPreview: true,
      };
      bumpForwardCache();
    },
    [bumpForwardCache]
  );

  const isCachedForwardAllowed = useCallback(() => {
    const cached = lastScreenCacheRef.current;
    if (!cached) return false;
    const allow = canForwardPullRef.current?.(cached) ?? true;
    if (!allow) lastScreenCacheRef.current = null;
    return allow;
  }, []);

  useEffect(() => {
    if (stack.length > 0) return;
    isCachedForwardAllowed();
  }, [stack.length, isCachedForwardAllowed]);

  useEffect(() => {
    const stackDepth = stack.length;
    const stackIds = stack.map((s) => s.id);

    navDebug.log('nav', 'stack:depth', {
      depth: stackDepth,
      ids: stackIds,
      cachedId: lastScreenCacheRef.current?.id ?? null,
      forwardSwipeEnabled: forwardSwipeEnabledRef.current,
    });

    if (lastReportedStackDepthRef.current !== stackDepth) {
      lastReportedStackDepthRef.current = stackDepth;
      onStackChangeRef.current?.(stackDepth);
    }

    if (stackDepth > 0) {
      lastScreenCacheRef.current = stack[stackDepth - 1];
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

  const pushScreen = useCallback(
    (
      content: React.ReactNode,
      id?: string,
      options?: { skipEnterAnimation?: boolean }
    ) => {
      const screenId = id || `screen-${++stackIdCounter.current}`;
      navDebug.log('nav', 'pushScreen', {
        screenId,
        skipEnter: options?.skipEnterAnimation ?? false,
        prevDepth: stackRef.current.length,
        trace: navDebug.captureTrace(),
      });
      setStack((prev) => [
        ...prev,
        {
          id: screenId,
          content,
          skipEnterAnimation: options?.skipEnterAnimation ?? false,
        },
      ]);
    },
    []
  );

  /** Swap the top stack entry (e.g. forward-pull preview → live screen) without growing depth. */
  const replaceTopScreen = useCallback((content: React.ReactNode, id?: string) => {
    const screenId = id || `screen-${++stackIdCounter.current}`;
    navDebug.log('nav', 'replaceTopScreen', {
      screenId,
      prevDepth: stackRef.current.length,
      trace: navDebug.captureTrace(),
    });
    setStack((prev) => {
      const entry: StackScreen = { id: screenId, content, skipEnterAnimation: true };
      if (prev.length === 0) return [entry];
      return [...prev.slice(0, -1), entry];
    });
  }, []);

  const popScreen = useCallback(() => {
    navDebug.log('nav', 'popScreen', {
      prevDepth: stackRef.current.length,
      topId: stackRef.current[stackRef.current.length - 1]?.id ?? null,
      trace: navDebug.captureTrace(),
    });
    const top = stackRef.current[stackRef.current.length - 1];
    if (top && !top.skipEnterAnimation) {
      lastScreenCacheRef.current = {
        id: top.id,
        content: top.content,
        skipEnterAnimation: true,
        isForwardPreview: false,
      };
    } else if (top?.skipEnterAnimation) {
      lastScreenCacheRef.current = {
        ...top,
        isForwardPreview: top.isForwardPreview ?? false,
      };
    } else {
      lastScreenCacheRef.current = null;
    }
    onPopToPreviewRef.current?.(top?.id ?? null);
    setStack((prev) => prev.slice(0, -1));
    bumpForwardCache();
  }, [bumpForwardCache]);
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

  const handleForwardOpenStart = useCallback(() => {
    const cached = lastScreenCacheRef.current;
    if (!cached?.isForwardPreview || !isCachedForwardAllowed()) return;
    navDebug.log('nav', 'forwardOpenStart', {
      cachedId: cached.id,
      trace: navDebug.captureTrace(),
    });
    requestAnimationFrame(() => {
      onForwardSwipeRef.current?.();
    });
  }, [isCachedForwardAllowed]);

  const handleForwardComplete = useCallback(() => {
    const cached = lastScreenCacheRef.current;
    navDebug.log('nav', 'forwardComplete', {
      cachedId: cached?.id ?? null,
      isForwardPreview: cached?.isForwardPreview ?? false,
      stackDepth: stackRef.current.length,
      trace: navDebug.captureTrace(),
    });
    if (!cached || !isCachedForwardAllowed()) return;
    if (!cached.isForwardPreview) {
      setStack([{ ...cached, skipEnterAnimation: true, isForwardPreview: false }]);
      return;
    }
    if (stackRef.current.length === 0) {
      requestAnimationFrame(() => {
        onForwardSwipeRef.current?.();
      });
    }
  }, [isCachedForwardAllowed]);

  const renderLayers = useCallback(() => {
    const topStack = stack[stack.length - 1];
    const cachedScreen = lastScreenCacheRef.current;
    const cachedAllowed =
      cachedScreen != null &&
      (canForwardPullRef.current?.(cachedScreen) ?? true);
    if (cachedScreen && !cachedAllowed) {
      lastScreenCacheRef.current = null;
    }
    const canForwardPull =
      forwardSwipeEnabledRef.current &&
      !topStack &&
      cachedScreen != null &&
      cachedAllowed &&
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
        onForwardOpenStart={handleForwardOpenStart}
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
    forwardCacheVersion,
    baseContent,
    tracedPopScreen,
    handleForwardOpenStart,
    handleForwardComplete,
    forwardSwipeEnabled,
    canForwardPull,
    isMobile,
  ]);

  return {
    pushScreen,
    replaceTopScreen,
    popScreen,
    clearStack,
    clearForwardCache,
    setForwardCache,
    renderLayers,
  };
}
