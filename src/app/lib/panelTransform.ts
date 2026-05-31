import { NAV_SWIPE_COMPLETE_S, NAV_SWIPE_EASE } from './navigationShellStyle';

const PANEL_TRANSITION = `transform ${NAV_SWIPE_COMPLETE_S}s cubic-bezier(${NAV_SWIPE_EASE.join(', ')})`;

export function setPanelTransform(
  el: HTMLElement,
  x: number,
  options?: { animate?: boolean },
) {
  el.style.transform = `translate3d(${x}px, 0, 0)`;
  if (options?.animate) {
    el.style.transition = PANEL_TRANSITION;
    el.style.willChange = 'transform';
  } else {
    el.style.transition = 'none';
    if (x === 0) {
      el.style.willChange = 'auto';
    } else {
      el.style.willChange = 'transform';
    }
  }
}

export function waitPanelTransition(el: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const onEnd = (event: TransitionEvent) => {
      if (event.propertyName !== 'transform') return;
      el.removeEventListener('transitionend', onEnd);
      resolve();
    };
    el.addEventListener('transitionend', onEnd);
    window.setTimeout(resolve, NAV_SWIPE_COMPLETE_S * 1000 + 40);
  });
}
