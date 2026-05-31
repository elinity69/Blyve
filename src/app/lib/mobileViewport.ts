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
} as const;

/** Inner padding for the composer row — safe area / keyboard are owned by the nav shell. */
export const COMPOSER_INNER_PADDING_PX = 8;

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

function onViewportEvent() {
  scheduleMobileViewportUpdate();
}

function bindViewportListeners() {
  if (bound || typeof window === 'undefined') return;
  bound = true;
  flushViewportFrame();

  const vv = window.visualViewport;
  vv?.addEventListener('resize', onViewportEvent);
  vv?.addEventListener('scroll', onViewportEvent);
  window.addEventListener('resize', onViewportEvent);
  window.addEventListener('orientationchange', onViewportEvent);
}

function unbindViewportListeners() {
  if (!bound || typeof window === 'undefined') return;
  bound = false;

  const vv = window.visualViewport;
  vv?.removeEventListener('resize', onViewportEvent);
  vv?.removeEventListener('scroll', onViewportEvent);
  window.removeEventListener('resize', onViewportEvent);
  window.removeEventListener('orientationchange', onViewportEvent);
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
