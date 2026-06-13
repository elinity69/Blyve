import { MOBILE_VV_CSS } from './mobileViewport';

/** Static enter/exit when not finger-tracking. */
export const NAV_SWIPE_COMPLETE_S = 0.26;
export const NAV_SWIPE_EASE = [0.22, 0.61, 0.36, 1] as const;
/** Framer spring for partial snap-back cancel only (never for forward-open commit). */
export const NAV_SWIPE_SPRING = {
  type: 'spring' as const,
  stiffness: 380,
  damping: 38,
  mass: 0.8,
  restDelta: 0.5,
  restSpeed: 0.5,
};
/** Deterministic settle — Discord-style, no overshoot at x=0 or off-screen. */
export const NAV_SWIPE_SETTLE = {
  type: 'tween' as const,
  duration: NAV_SWIPE_COMPLETE_S,
  ease: NAV_SWIPE_EASE,
};
/** Push enter — slower ease-out so the panel does not overshoot past x=0. */
export const NAV_ENTER_EASE = [0.25, 0.46, 0.45, 0.94] as const;
export const NAV_ENTER_DURATION_S = 0.4;
export const NAV_ENTER_SETTLE_MS = Math.round(NAV_ENTER_DURATION_S * 1000);
export const NAV_SWIPE_CANCEL_MS = 280;
/** Minimum velocity (px/ms) for any flick path to succeed. */
export const NAV_SWIPE_VELOCITY_THRESHOLD = 0.28;
/** Fraction of screen width the panel must travel for a slow drag to succeed. */
export const NAV_SWIPE_DISTANCE_RATIO = 0.22;
/** Absolute minimum px for a slow drag (lower bound for narrow screens). */
export const NAV_SWIPE_MIN_DISTANCE_PX = 44;
/**
 * Fast-flick path: if velocity ≥ this AND distance ≥ NAV_SWIPE_FLICK_MIN_PX,
 * the gesture completes regardless of NAV_SWIPE_DISTANCE_RATIO.
 * Lets short decisive swipes succeed like native iOS.
 */
export const NAV_SWIPE_FLICK_VELOCITY = 0.45;
export const NAV_SWIPE_FLICK_MIN_PX = 28;
/** Snap / hide threshold so the panel never rests slightly on-screen. */
export const NAV_SWIPE_OFFSCREEN_EPSILON_PX = 0.5;
/** Ignore touches right after push — blocks tap ghost from the list row. */
/** Block swipe-back from list-row tap ghost (starts at push). */
export const NAV_ENTER_GRACE_MS = 720;
/** Extra block after enter animation completes (extends grace, never shortens). */
export const NAV_POST_ENTER_GRACE_MS = 520;
/** Extra px off-screen so preview/chat never peek through subpixel gaps. */
export const NAV_PANEL_HIDE_OVERSHOOT_PX = 24;
/**
 * Mobile bottom nav reserved height — must equal the rendered `h-[52px]` (52px) of
 * `BottomNavigation`. Used by:
 *   • mobilePreviewShellStyle `bottom` (useEdgeBackNavigation)
 *   • MessagesScreen scroll-container paddingBottom
 * Change only if BottomNavigation's base height changes.
 */
export const MOBILE_BOTTOM_NAV_HEIGHT_PX = 52;

/** Left bleed cover when the stack panel is fully open (hides preview edge peek). */
export function stackPanelOpenBoxShadow(): string {
  const bg = 'var(--color-background, #0d0d0d)';
  return `-${NAV_PANEL_HIDE_OVERSHOOT_PX}px 0 0 0 ${bg}, -5px 0 20px rgba(0,0,0,0.15)`;
}
/** Right-edge inset for forward (re-open) swipe — left 50% of screen is list-only. */
export const FORWARD_EDGE_RATIO = 0.5;
export const FORWARD_EDGE_INSET_RATIO = FORWARD_EDGE_RATIO;
/** Left-edge inset for swipe-back — ignores taps from the conversation list center. */
export const BACK_EDGE_INSET_RATIO = 0.18;

/**
 * Signal that a profile sheet (or any overlay sheet) is currently being dragged
 * vertically.  NavigationStack checks this flag before starting a horizontal
 * swipe-back gesture so the two gestures never compete.
 */
const SHEET_DRAG_ATTR = 'sheetDragActive' as const;

export function setSheetDragActive(active: boolean) {
  if (typeof document === 'undefined') return;
  if (active) {
    document.documentElement.dataset[SHEET_DRAG_ATTR] = '1';
  } else {
    delete document.documentElement.dataset[SHEET_DRAG_ATTR];
  }
}

export function isSheetDragActive(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset[SHEET_DRAG_ATTR] === '1';
}

export function clearNavSwipeLocks(shell?: HTMLDivElement | null) {
  if (typeof document === 'undefined') return;
  delete document.documentElement.dataset.swipeBackLock;
  delete document.documentElement.dataset.forwardSwipeLock;
  delete document.documentElement.dataset.navEdgeTouch;
  if (shell) shell.style.touchAction = '';
}

export function setNavSwipeBackLock(locked: boolean, shell?: HTMLDivElement | null) {
  if (typeof document === 'undefined') return;
  if (locked) {
    document.documentElement.dataset.swipeBackLock = '1';
    if (shell) shell.style.touchAction = 'none';
  } else {
    delete document.documentElement.dataset.swipeBackLock;
    if (shell) shell.style.touchAction = '';
  }
}

/**
 * Written at touchstart the moment NavigationStack accepts a potential back/forward swipe.
 * Cleared when the gesture resolves (commit, cancel, or direction rejected).
 * useSwipeToReply reads this to suppress reply swipes that share the same touch event.
 */
export function setNavEdgeTouchActive(active: boolean) {
  if (typeof document === 'undefined') return;
  if (active) {
    document.documentElement.dataset.navEdgeTouch = '1';
  } else {
    delete document.documentElement.dataset.navEdgeTouch;
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
  // top: 0 — anchored to visual viewport top.
  // On iOS 15+ (resize-mode), vv.offsetTop is always 0 so this is safe.
  // The offsetTop CSS var caused header jumps when offsetTop briefly oscillated.
  top: 0,
  left: 0,
  right: 0,
  // Use explicit height instead of `bottom: 0`.
  // `position: fixed; bottom: 0` combined with `will-change: transform` (applied
  // by framer-motion on this element) is a known iOS Safari compositor bug:
  // composited layers do not re-evaluate `bottom` positioning when innerHeight
  // changes due to the keyboard, so the shell stayed at the old height (664px)
  // while the inner viewport-shell correctly shrank to 441px — producing the
  // large black gap the user sees below the composer.
  // Using var(--blyve-vv-height) directly is a style value, not layout-dependent,
  // and updates correctly on composited layers.
  height: `var(${MOBILE_VV_CSS.height}, 100dvh)`,
  boxSizing: 'border-box' as const,
  paddingBottom: 0,
  zIndex: 65,
  backgroundColor: 'var(--color-background, #0d0d0d)',
  // NO box-shadow here — shadows on will-change:transform layers are not GPU-composited
  // and force a pixel repaint on every swipe frame. The left-edge depth effect is
  // achieved via the [data-nav-shell-shadow] sibling element in NavigationStack.
  overflowX: 'hidden' as const,
  overflowY: 'hidden' as const,
  overscrollBehavior: 'contain' as const,
  overscrollBehaviorX: 'contain' as const,
  overscrollBehaviorY: 'none' as const,
};

export const navigationPreviewShellStyle = {
  position: 'absolute' as const,
  inset: 0,
  zIndex: 0,
  overflow: 'hidden' as const,
  backgroundColor: 'var(--color-background, #0d0d0d)',
};

export const navigationStackShellStyleDesktop = {
  position: 'relative' as const,
  top: 'auto',
  left: 'auto',
  right: 'auto',
  bottom: 'auto',
  width: '100%',
  height: '100%',
  zIndex: 'auto' as const,
  backgroundColor: 'var(--color-background, #0d0d0d)',
  boxShadow: 'none',
  overflowX: 'hidden' as const,
  overflowY: 'hidden' as const,
  overscrollBehavior: 'contain' as const,
};
