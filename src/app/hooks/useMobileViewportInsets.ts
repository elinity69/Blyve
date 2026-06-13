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
    if (!enabled) return;
    return acquireMobileViewportTracking();
  }, [enabled]);

  return enabled ? frame : DEFAULT_MOBILE_VIEWPORT_FRAME;
}

/** Only starts viewport tracking + CSS vars (no React subscription). */
export function useMobileViewportDriver(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    return acquireMobileViewportTracking();
  }, [enabled]);
}
