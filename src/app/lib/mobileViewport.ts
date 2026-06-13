export interface MobileViewportFrame {
  offsetTop: number;
  height: number;
  bottomInset: number;
  topInset: number;
}

export const DEFAULT_MOBILE_VIEWPORT_FRAME: MobileViewportFrame = {
  offsetTop: 0,
  height: typeof window !== 'undefined' ? window.innerHeight : 0,
  bottomInset: 0,
  topInset: 0,
};

export const MOBILE_VV_CSS = {
  offsetTop: '--blyve-vv-offset-top',
  height: '--blyve-vv-height',
  bottomInset: '--blyve-vv-bottom-inset',
  /**
   * Physical screen height (window.outerHeight). Written once on bind and
   * refreshed on orientationchange. Used by the outer nav shell so it always
   * covers the full screen even when 100vh shrinks with the keyboard (iOS
   * resize mode). outerHeight never shrinks when the keyboard opens.
   */
  screenHeight: '--blyve-screen-height',
} as const;

/** Inner padding for the composer row — safe area / keyboard are owned by the nav shell. */
export const COMPOSER_INNER_PADDING_PX = 18;

/**
 * Bottom padding for the chat message composer.
 * Inside `data-visual-viewport-shell`, the stack already applies `--blyve-vv-bottom-inset`
 * (home indicator + keyboard). Extra env(safe-area) on the composer would double-count.
 */
export function resolveComposerPaddingBottom(options: {
  isMobile: boolean;
  inVisualViewportShell: boolean;
  frame: MobileViewportFrame;
}): string {
  const min = `${COMPOSER_INNER_PADDING_PX}px`;
  if (!options.isMobile) {
    return `max(${min}, env(safe-area-inset-bottom, 0px))`;
  }
  if (options.inVisualViewportShell) {
    return min;
  }
  return `max(${min}, ${options.frame.bottomInset}px)`;
}

let latestFrame: MobileViewportFrame = DEFAULT_MOBILE_VIEWPORT_FRAME;
let rafPending = false;
let listenerCount = 0;
let bound = false;

const frameListeners = new Set<() => void>();

export function measureSafeAreaInsetBottom(): number {
  if (typeof document === 'undefined') return 0;

  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;left:-9999px;bottom:0;height:0;padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none;';
  document.body.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  document.body.removeChild(probe);
  return height;
}

export function measureMobileViewportFrame(): MobileViewportFrame {
  if (typeof window === 'undefined') return DEFAULT_MOBILE_VIEWPORT_FRAME;

  const layoutHeight = window.innerHeight;
  const safeBottom = measureSafeAreaInsetBottom();
  const vv = window.visualViewport;

  if (!vv) {
    return {
      offsetTop: 0,
      height: layoutHeight,
      bottomInset: safeBottom,
      topInset: 0,
    };
  }

  const offsetTop = Math.max(0, vv.offsetTop);
  const visibleHeight = vv.height;
  const obscuredBottom = Math.max(0, layoutHeight - (offsetTop + visibleHeight));
  const bottomInset = Math.max(safeBottom, obscuredBottom);

  return {
    offsetTop,
    height: visibleHeight,
    bottomInset,
    topInset: offsetTop,
  };
}

function applyCssVars(frame: MobileViewportFrame) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty(MOBILE_VV_CSS.offsetTop, `${frame.offsetTop}px`);
  root.style.setProperty(MOBILE_VV_CSS.height, `${frame.height}px`);
  root.style.setProperty(MOBILE_VV_CSS.bottomInset, `${frame.bottomInset}px`);
}

function flushViewportFrame() {
  rafPending = false;
  latestFrame = measureMobileViewportFrame();
  applyCssVars(latestFrame);
  frameListeners.forEach((listener) => listener());
}

export function scheduleMobileViewportUpdate() {
  if (typeof window === 'undefined') return;
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(flushViewportFrame);
}

function applyScreenHeight() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  // Use window.innerHeight (content area only, no browser chrome) as the outer
  // nav-shell height. outerHeight (844px) was tried but extends into the browser
  // chrome area (status bar + URL bar + bottom nav = 180px), which on a GPU
  // compositing layer (will-change:transform) is not properly clipped → visible
  // black bar extending beyond the keyboard.
  //
  // innerHeight when keyboard is CLOSED (664px on this device) = exactly the
  // right coverage: large enough to fill the screen, small enough that no GPU
  // layer overflow bleeds through.
  //
  // IMPORTANT: this must only be called when the keyboard is NOT open.
  // In iOS resize-mode, innerHeight drops to 441px when keyboard opens.
  // We capture it once at bind time and refresh only on orientationchange —
  // never on visualViewport.resize / window.resize (= keyboard events).
  document.documentElement.style.setProperty(
    MOBILE_VV_CSS.screenHeight,
    `${window.innerHeight}px`,
  );
}

function onViewportEvent() {
  // Write offsetTop and height synchronously so the fixed navigation shell
  // repositions and resizes in the same frame as the browser layout change —
  // frame-by-frame tracking of the keyboard animation, no rAF lag.
  if (typeof document !== 'undefined' && window.visualViewport) {
    const vv = window.visualViewport;
    const offsetTop = Math.max(0, vv.offsetTop);
    const height = vv.height;
    const root = document.documentElement;
    root.style.setProperty(MOBILE_VV_CSS.offsetTop, `${offsetTop}px`);
    root.style.setProperty(MOBILE_VV_CSS.height, `${height}px`);
  }
  // Do NOT call applyScreenHeight here: visualViewport.resize fires during the
  // keyboard animation. In iOS resize-mode innerHeight is already shrunk, so we
  // would store 441px as the screen height — exactly the bug we are fixing.
  scheduleMobileViewportUpdate();
}

function onOrientationChange() {
  // Device was rotated — innerHeight now reflects the new orientation.
  // A short delay lets the browser finish the rotation animation so we read
  // the settled value, not the transitional one.
  setTimeout(applyScreenHeight, 300);
  onViewportEvent();
}

function bindViewportListeners() {
  if (bound || typeof window === 'undefined') return;
  bound = true;
  // Capture keyboard-closed innerHeight before any keyboard can open.
  applyScreenHeight();
  flushViewportFrame();

  const vv = window.visualViewport;
  vv?.addEventListener('resize', onViewportEvent);
  vv?.addEventListener('scroll', onViewportEvent);
  // Only use window.resize as a fallback when visualViewport is unavailable.
  // On Android Chrome, window.resize fires only once after the keyboard is fully
  // open (a single jump), while visualViewport.resize fires every animation frame.
  // Using both would cause a redundant late-frame correction on Android.
  if (!vv) {
    window.addEventListener('resize', onViewportEvent);
  }
  window.addEventListener('orientationchange', onOrientationChange);
}

function unbindViewportListeners() {
  if (!bound || typeof window === 'undefined') return;
  bound = false;

  const vv = window.visualViewport;
  vv?.removeEventListener('resize', onViewportEvent);
  vv?.removeEventListener('scroll', onViewportEvent);
  if (!vv) {
    window.removeEventListener('resize', onViewportEvent);
  }
  window.removeEventListener('orientationchange', onOrientationChange);
}

export function acquireMobileViewportTracking() {
  listenerCount += 1;
  if (listenerCount === 1) {
    bindViewportListeners();
  }
  return () => {
    listenerCount = Math.max(0, listenerCount - 1);
    if (listenerCount === 0) {
      unbindViewportListeners();
    }
  };
}

export function getMobileViewportFrame(): MobileViewportFrame {
  return latestFrame;
}

export function subscribeMobileViewportFrame(listener: () => void): () => void {
  frameListeners.add(listener);
  return () => {
    frameListeners.delete(listener);
  };
}
