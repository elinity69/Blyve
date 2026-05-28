import { useCallback, useEffect, useState } from 'react';

export interface MobileViewportFrame {
  /** Visible viewport top (keyboard / browser chrome). */
  offsetTop: number;
  /** Visible viewport height. */
  height: number;
  /** Extra space hidden below the visible viewport (URL bar, home indicator overlap). */
  bottomInset: number;
  /** Space hidden above the visible viewport. */
  topInset: number;
}

const DEFAULT_FRAME: MobileViewportFrame = {
  offsetTop: 0,
  height: typeof window !== 'undefined' ? window.innerHeight : 0,
  bottomInset: 0,
  topInset: 0,
};

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

function measureFrame(): MobileViewportFrame {
  if (typeof window === 'undefined') return DEFAULT_FRAME;

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

/**
 * Tracks visual viewport + safe-area so fixed footers (chat composer) stay above
 * mobile browser chrome, PWA home indicator, and the on-screen keyboard.
 */
export function useMobileViewportInsets(enabled = true) {
  const [frame, setFrame] = useState<MobileViewportFrame>(DEFAULT_FRAME);

  const update = useCallback(() => {
    if (!enabled) {
      setFrame(DEFAULT_FRAME);
      return;
    }
    setFrame(measureFrame());
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    update();

    const vv = window.visualViewport;
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);

    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, [enabled, update]);

  return frame;
}
