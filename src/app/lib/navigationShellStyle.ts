import { MOBILE_VV_CSS } from './mobileViewport';

export const NAV_SWIPE_EASE = [0.32, 0.72, 0, 1] as const;
export const NAV_SWIPE_COMPLETE_S = 0.28;
export const NAV_SWIPE_CANCEL_MS = 200;
export const NAV_SWIPE_VELOCITY_THRESHOLD = 0.35;
export const NAV_SWIPE_DISTANCE_RATIO = 0.33;
export const NAV_SWIPE_MIN_DISTANCE_PX = 56;
/** Right-edge inset for forward (re-open) swipe — left 50% of screen is list-only. */
export const FORWARD_EDGE_RATIO = 0.5;
export const FORWARD_EDGE_INSET_RATIO = FORWARD_EDGE_RATIO;

export function clearNavSwipeLocks(shell?: HTMLDivElement | null) {
  if (typeof document === 'undefined') return;
  delete document.documentElement.dataset.swipeBackLock;
  delete document.documentElement.dataset.forwardSwipeLock;
  document.body.style.overflowX = '';
  document.body.style.overflowY = '';
  if (shell) shell.style.touchAction = '';
}

export function setNavSwipeBackLock(locked: boolean) {
  if (typeof document === 'undefined') return;
  if (locked) {
    document.documentElement.dataset.swipeBackLock = '1';
    document.body.style.overflowX = 'hidden';
    document.body.style.overflowY = 'hidden';
  } else {
    delete document.documentElement.dataset.swipeBackLock;
    document.body.style.overflowX = '';
    document.body.style.overflowY = '';
  }
}

export function setNavForwardSwipeLock(locked: boolean, shell?: HTMLDivElement | null) {
  if (typeof document === 'undefined') return;
  if (locked) {
    document.documentElement.dataset.forwardSwipeLock = '1';
    if (shell) shell.style.touchAction = 'none';
  } else {
    delete document.documentElement.dataset.forwardSwipeLock;
    if (shell) shell.style.touchAction = '';
  }
}

export const navigationStackShellStyle = {
  position: 'fixed' as const,
  top: `var(${MOBILE_VV_CSS.offsetTop}, 0px)`,
  left: 0,
  right: 0,
  height: `var(${MOBILE_VV_CSS.height}, 100dvh)`,
  paddingBottom: `var(${MOBILE_VV_CSS.bottomInset}, 0px)`,
  bottom: 'auto' as const,
  zIndex: 10,
  backgroundColor: 'var(--color-background, #0d0d0d)',
  boxShadow: '-5px 0 20px rgba(0,0,0,0.15)',
  overflowX: 'hidden' as const,
  overflowY: 'hidden' as const,
  overscrollBehavior: 'contain' as const,
  overscrollBehaviorX: 'contain' as const,
  overscrollBehaviorY: 'none' as const,
};

export const navigationPreviewShellStyle = {
  ...navigationStackShellStyle,
  zIndex: 5,
};

export const navigationStackShellStyleDesktop = {
  ...navigationStackShellStyle,
  top: 0,
  height: '100%',
  paddingBottom: 0,
  overflowX: 'hidden' as const,
  overflowY: 'auto' as const,
  WebkitOverflowScrolling: 'touch' as const,
};
