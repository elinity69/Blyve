/** Shared easing/timing for mobile panel swipe (Discord-style). */
export const PANEL_SWIPE_EASE_CSS = 'cubic-bezier(0.32, 0.72, 0, 1)';
export const PANEL_SWIPE_SNAP_MS = 320;
export const PANEL_SWIPE_DISMISS_MS = 340;

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function animatePanelOffset(
  from: number,
  to: number,
  durationMs: number,
  onUpdate: (value: number) => void,
  onDone?: () => void,
): () => void {
  const startTime = performance.now();
  let frameId = 0;

  const tick = (now: number) => {
    const progress = Math.min((now - startTime) / durationMs, 1);
    const value = from + (to - from) * easeOutCubic(progress);
    onUpdate(value);
    if (progress < 1) {
      frameId = requestAnimationFrame(tick);
    } else {
      onUpdate(to);
      onDone?.();
    }
  };

  frameId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frameId);
}
