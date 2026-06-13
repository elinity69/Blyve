import { useEffect, useSyncExternalStore } from 'react';
import {
  acquireMobileViewportTracking,
  DEFAULT_MOBILE_VIEWPORT_FRAME,
  getMobileViewportFrame,
  measureMobileViewportFrame,
  measureSafeAreaInsetBottom,
  subscribeMobileViewportFrame,
  type MobileViewportFrame,
} from '../lib/mobileViewport';

const getMobileViewportMetrics = (frame: MobileViewportFrame) => {
  return {
    frame: { ...frame },
    windowInnerHeight: window.innerHeight,
    windowOuterHeight: window.outerHeight,
    vvHeight: window.visualViewport?.height ?? null,
    vvOffsetTop: window.visualViewport?.offsetTop ?? null,
    vvPageTop: window.visualViewport?.pageTop ?? null,
    activeElementTag: document.activeElement?.tagName ?? null,
    activeElementId: document.activeElement?.id ?? null,
    activeElementName: (document.activeElement as HTMLInputElement)?.name ?? null,
  };
};

const logMobileViewportDebug = (event: string, frame: MobileViewportFrame, additionalMetrics: Record<string, any> = {}) => {
  const metrics = getMobileViewportMetrics(frame);
  console.log('[BLYVE_MOBILE_VIEWPORT_DEBUG]', {
    event,
    ts: Date.now(),
    ...metrics,
    ...additionalMetrics,
  });
};

export type { MobileViewportFrame };
export {
  DEFAULT_MOBILE_VIEWPORT_FRAME,
  measureMobileViewportFrame,
  measureSafeAreaInsetBottom,
};

function subscribeFrame(onStoreChange: () => void) {
  return subscribeMobileViewportFrame(onStoreChange);
}

function getFrameSnapshot(): MobileViewportFrame {
  return getMobileViewportFrame();
}

function getServerFrameSnapshot(): MobileViewportFrame {
  return DEFAULT_MOBILE_VIEWPORT_FRAME;
}

/** Enables shared rAF viewport tracking and returns the latest frame. */
export function useMobileViewportInsets(enabled = true) {
  const frame = useSyncExternalStore(
    subscribeFrame,
    getFrameSnapshot,
    getServerFrameSnapshot
  );

  useEffect(() => {
    logMobileViewportDebug('useMobileViewportInsets_effect_run', frame, { enabled });
    if (!enabled) return;
    const cleanup = acquireMobileViewportTracking();
    logMobileViewportDebug('useMobileViewportInsets_tracking_acquired', frame, { enabled });
    return () => {
      logMobileViewportDebug('useMobileViewportInsets_tracking_released', frame, { enabled });
      cleanup();
    };
  }, [enabled, frame]);

  useEffect(() => {
    logMobileViewportDebug('useMobileViewportInsets_frame_change', frame, { enabled });
  }, [frame, enabled]);

  return enabled ? frame : DEFAULT_MOBILE_VIEWPORT_FRAME;
}

/** Only starts viewport tracking + CSS vars (no React subscription). */
export function useMobileViewportDriver(enabled = true) {
  useEffect(() => {
    logMobileViewportDebug('useMobileViewportDriver_effect_run', DEFAULT_MOBILE_VIEWPORT_FRAME, { enabled });
    if (!enabled) return;
    const cleanup = acquireMobileViewportTracking();
    logMobileViewportDebug('useMobileViewportDriver_tracking_acquired', DEFAULT_MOBILE_VIEWPORT_FRAME, { enabled });
    return () => {
      logMobileViewportDebug('useMobileViewportDriver_tracking_released', DEFAULT_MOBILE_VIEWPORT_FRAME, { enabled });
      cleanup();
    };
  }, [enabled]);
}
