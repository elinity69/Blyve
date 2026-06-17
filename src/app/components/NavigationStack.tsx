import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { animate, motion, useMotionValue, useMotionValueEvent } from 'framer-motion';
import { useMobileViewportDriver } from '../hooks/useMobileViewportInsets';
import { navDebug } from '../lib/navDebug';
import {
  clearNavSwipeLocks,
  BACK_EDGE_INSET_RATIO,
  FORWARD_EDGE_RATIO,
  NAV_SWIPE_COMPLETE_S,
  NAV_SWIPE_DISTANCE_RATIO,
  NAV_SWIPE_MIN_DISTANCE_PX,
  NAV_SWIPE_FLICK_VELOCITY,
  NAV_SWIPE_FLICK_MIN_PX,
  NAV_SWIPE_EASE,
  NAV_ENTER_GRACE_MS,
  NAV_POST_ENTER_GRACE_MS,
  NAV_PANEL_HIDE_OVERSHOOT_PX,
  NAV_SWIPE_OFFSCREEN_EPSILON_PX,
  NAV_SWIPE_SETTLE,
  NAV_SWIPE_SPRING,
  NAV_SWIPE_VELOCITY_THRESHOLD,
  navigationStackShellStyle,
  navigationStackShellStyleDesktop,
  setNavEdgeTouchActive,
  setNavForwardSwipeLock,
  setNavSwipeBackLock,
  isSheetDragActive,
} from '../lib/navigationShellStyle';
import { MOBILE_VV_CSS } from '../lib/mobileViewport';

interface NavigationStackProps {
  children: React.ReactNode;
  onBack: () => void;
  skipEnterAnimation?: boolean;
  screenId?: string;
  onBeforeBack?: () => void;
  onSwipeBackStart?: () => void;
  onSwipeBackEnd?: () => void;
  /** Pull cached screen in from the right edge (Discord-style). */
  isForwardPull?: boolean;
  forwardShellRef?: React.RefObject<HTMLDivElement | null>;
  /** Preview cache only — mount live screen when forward snap begins. */
  onForwardOpenStart?: () => void;
  onForwardComplete?: () => void;
}

type NavPhase = 'idle' | 'enter' | 'drag' | 'snap';

function getViewportWidth() {
  return typeof window !== 'undefined' ? window.innerWidth : 0;
}

function offscreenPanelX(width: number) {
  return width + NAV_PANEL_HIDE_OVERSHOOT_PX;
}

function pullToPanelXForMode(
  pullDistance: number,
  width: number,
  forward: boolean
) {
  const clamped = Math.max(0, Math.min(pullDistance, width));
  if (forward) {
    if (clamped <= NAV_SWIPE_OFFSCREEN_EPSILON_PX) {
      return offscreenPanelX(width);
    }
    return width - clamped;
  }
  if (clamped >= width - NAV_SWIPE_OFFSCREEN_EPSILON_PX) {
    return offscreenPanelX(width);
  }
  return clamped;
}

function panelXToPullForMode(motionX: number, width: number, forward: boolean) {
  if (forward) {
    if (motionX >= width - NAV_SWIPE_OFFSCREEN_EPSILON_PX) {
      return 0;
    }
    return Math.max(0, Math.min(width, width - motionX));
  }
  if (motionX >= width - NAV_SWIPE_OFFSCREEN_EPSILON_PX) {
    return width;
  }
  return Math.max(0, Math.min(width, motionX));
}

export function NavigationStack({
  children,
  onBack,
  skipEnterAnimation = false,
  screenId,
  onBeforeBack,
  onSwipeBackStart,
  onSwipeBackEnd,
  isForwardPull = false,
  forwardShellRef,
  onForwardOpenStart,
  onForwardComplete,
}: NavigationStackProps) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 768
  );
  const [viewportWidth, setViewportWidth] = useState(() => getViewportWidth());
  const [translateX, setTranslateX] = useState(0);
  const [navPhase, setNavPhase] = useState<NavPhase>('idle');
  const [enterTouchShield, setEnterTouchShield] = useState(false);
  const enterTouchShieldRef = useRef(false);
  const enterCssActiveRef = useRef(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const viewportShellRef = useRef<HTMLDivElement | null>(null);
  const [swipeBackLocked, setSwipeBackLocked] = useState(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const currentXRef = useRef(0);
  const lastTouchXRef = useRef(0);
  const lastTouchTimeRef = useRef(0);
  const directionLockedRef = useRef(false);
  const isVerticalScrollRef = useRef(false);
  const isDraggingRef = useRef(false);
  const touchStartedOnEdgeRef = useRef(false);
  const snapAnimationStopRef = useRef<(() => void) | null>(null);
  const enterAnimationStopRef = useRef<(() => void) | null>(null);
  const translateXRef = useRef(0);
  const lastPullDistanceRef = useRef(0);
  const lastPullTimeRef = useRef(0);
  const pendingTranslateFrameRef = useRef<number | null>(null);
  const panelXRef = useRef(0);
  const panelX = useMotionValue(0);
  const enterGraceUntilRef = useRef(0);
  const interactionReadyAtRef = useRef(0);
  const enterLockedRef = useRef(false);
  const enterBlockLogRef = useRef(false);
  const layoutGenRef = useRef(0);
  const enterWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enterStartRafRef = useRef<number | null>(null);
  const enterShieldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapOnDoneRef = useRef<(() => void) | null>(null);
  const layoutPrevRef = useRef({
    isForwardPull,
    skipEnterAnimation,
    screenId,
  });
  const onBackRef = useRef(onBack);
  const onBeforeBackRef = useRef(onBeforeBack);
  const onSwipeBackStartRef = useRef(onSwipeBackStart);
  const onSwipeBackEndRef = useRef(onSwipeBackEnd);
  const onForwardCompleteRef = useRef(onForwardComplete);
  const onForwardOpenStartRef = useRef(onForwardOpenStart);
  onBackRef.current = onBack;
  onBeforeBackRef.current = onBeforeBack;
  onSwipeBackStartRef.current = onSwipeBackStart;
  onSwipeBackEndRef.current = onSwipeBackEnd;
  onForwardCompleteRef.current = onForwardComplete;
  onForwardOpenStartRef.current = onForwardOpenStart;

  useMobileViewportDriver(isMobile);

  const logPose = useCallback(
    (event: string, extra?: Record<string, unknown>) => {
      navDebug.log('stack', event, {
        ...navDebug.panelPose(screenId, {
          isForwardPull,
          translateX: translateXRef.current,
          panelX: panelXRef.current,
          width: viewportWidth || getViewportWidth(),
          phase: navPhase,
          skipEnterAnimation,
          isDragging: isDraggingRef.current,
          swipeBackLocked,
          layoutGen: layoutGenRef.current,
        }),
        ...extra,
      });
    },
    [screenId, isForwardPull, navPhase, skipEnterAnimation, swipeBackLocked, viewportWidth]
  );

  useMotionValueEvent(panelX, 'change', (latest) => {
    panelXRef.current = latest;
  });

  const setSwipeBackLock = (locked: boolean) => {
    isDraggingRef.current = locked;
    setSwipeBackLocked(locked);
    setNavSwipeBackLock(locked, shellRef.current);
    if (locked) {
      onSwipeBackStartRef.current?.();
    } else {
      onSwipeBackEndRef.current?.();
    }
  };

  const pullToPanelX = (pullDistance: number, width: number) =>
    pullToPanelXForMode(pullDistance, width, isForwardPull);

  const panelXToPull = (motionX: number, width: number) =>
    panelXToPullForMode(motionX, width, isForwardPull);

  const cancelPendingTranslateFrame = () => {
    if (pendingTranslateFrameRef.current === null) return;
    cancelAnimationFrame(pendingTranslateFrameRef.current);
    pendingTranslateFrameRef.current = null;
  };

  const jumpPanelX = (px: number) => {
    panelX.jump(px);
    panelXRef.current = px;
  };

  /** Hard-reset panel off-screen (forward-pull cache). Survives aborted enter tweens. */
  const forceForwardPullHidden = (width: number) => {
    cancelPendingTranslateFrame();
    const px = offscreenPanelX(width);
    jumpPanelX(px);
    translateXRef.current = 0;
    lastPullDistanceRef.current = 0;
    setTranslateX(0);
    clearNavSwipeLocks(forwardShellRef?.current ?? undefined);
  };

  const applyPanelX = (pullDistance: number, width = viewportWidth || getViewportWidth()) => {
    const clamped = Math.max(0, Math.min(pullDistance, width));
    translateXRef.current = clamped;
    const px = pullToPanelX(clamped, width);
    panelX.set(px);
    panelXRef.current = px;
    cancelPendingTranslateFrame();
    // DO NOT call setTranslateX here — it was causing a full React re-render
    // on every swipe frame. translateX state is only used for logPose (debug),
    // so we read translateXRef.current directly there instead.
    pendingTranslateFrameRef.current = null;
  };

  const stopSnapAnimation = () => {
    snapAnimationStopRef.current?.();
    snapAnimationStopRef.current = null;
    snapOnDoneRef.current = null;
    if (navPhase === 'snap') {
      setNavPhase('idle');
    }
  };

  const releaseEnterLock = () => {
    enterLockedRef.current = false;
    enterGraceUntilRef.current = 0;
    enterBlockLogRef.current = false;
  };

  const blockTouchInteraction = (ms: number) => {
    interactionReadyAtRef.current = Math.max(
      interactionReadyAtRef.current,
      performance.now() + ms
    );
  };

  const scheduleEnterShieldRelease = () => {
    if (enterShieldTimerRef.current !== null) {
      clearTimeout(enterShieldTimerRef.current);
    }
    const delay = Math.max(0, interactionReadyAtRef.current - performance.now());
    enterShieldTimerRef.current = setTimeout(() => {
      enterShieldTimerRef.current = null;
      setEnterTouchShield(false);
      enterTouchShieldRef.current = false;
    }, delay);
  };

  const isTouchInteractionReady = () => performance.now() >= interactionReadyAtRef.current;

  const stopEnterAnimation = () => {
    cancelEnterStartRaf();
    cancelEnterAnimation();
    enterCssActiveRef.current = false;
    releaseEnterLock();
    if (navPhase === 'enter') {
      setNavPhase('idle');
    }
  };

  const cancelEnterStartRaf = () => {
    if (enterStartRafRef.current === null) return;
    cancelAnimationFrame(enterStartRafRef.current);
    enterStartRafRef.current = null;
  };

  const cancelEnterAnimation = () => {
    enterAnimationStopRef.current?.();
    enterAnimationStopRef.current = null;
  };

  const startEnterTween = (
    enterStartX: number,
    enterLayoutGen: number,
    width: number,
    completeEnter: (reason: string) => void
  ) => {
    jumpPanelX(enterStartX);
    const controls = animate(panelX, 0, {
      ...NAV_SWIPE_SETTLE,
      onComplete: () => {
        if (enterLayoutGen !== layoutGenRef.current) {
          navDebug.log('stack', 'enter:tween:stale', {
            enterLayoutGen,
            currentGen: layoutGenRef.current,
            screenId,
          });
          return;
        }
        enterAnimationStopRef.current = null;
        completeEnter('enter-tween');
      },
    });
    enterAnimationStopRef.current = () => {
      controls.stop();
    };
  };

  const settleOpenPanel = useCallback(
    (
      width = getViewportWidth(),
      reason = 'settle',
      opts?: { releaseShield?: boolean }
    ) => {
      releaseEnterLock();
      cancelPendingTranslateFrame();
      translateXRef.current = 0;
      jumpPanelX(0);
      setTranslateX(0);
      setNavPhase('idle');
      if (opts?.releaseShield !== false) {
        setEnterTouchShield(false);
        enterTouchShieldRef.current = false;
      }
      enterCssActiveRef.current = false;

      requestAnimationFrame(() => {
        jumpPanelX(0);
        logPose(`settle:open:${reason}`, {
          panelXPx: Math.round(panelX.get()),
          pullPx: Math.round(translateXRef.current),
          viewportW: Math.round(width),
        });
      });
    },
    [logPose, panelX]
  );

  const stopAllAnimations = () => {
    stopSnapAnimation();
    stopEnterAnimation();
  };

  useLayoutEffect(() => {
    const width = getViewportWidth();
    const prev = layoutPrevRef.current;
    layoutGenRef.current += 1;
    const layoutGen = layoutGenRef.current;

    navDebug.log('stack', 'layout:effect', {
      layoutGen,
      screenId,
      from: {
        isForwardPull: prev.isForwardPull,
        skipEnter: prev.skipEnterAnimation,
        screenId: prev.screenId,
      },
      to: { isForwardPull, skipEnter: skipEnterAnimation, screenId },
      trace: navDebug.captureTrace(),
    });
    layoutPrevRef.current = { isForwardPull, skipEnterAnimation, screenId };

    cancelPendingTranslateFrame();
    cancelEnterAnimation();
    stopSnapAnimation();
    translateXRef.current = 0;
    lastPullDistanceRef.current = 0;
    setTranslateX(0);

    if (isForwardPull) {
      releaseEnterLock();
      forceForwardPullHidden(width);
      setNavPhase('idle');
      interactionReadyAtRef.current = 0;
      setEnterTouchShield(false);
      enterTouchShieldRef.current = false;
      enterCssActiveRef.current = false;
      logPose('layout:forward-pull-hidden', {
        panelXStart: Math.round(offscreenPanelX(width)),
        panelXPx: Math.round(panelX.get()),
      });
      return;
    }

    if (skipEnterAnimation) {
      const fromForwardCommit = prev.isForwardPull && !isForwardPull;
      cancelPendingTranslateFrame();
      translateXRef.current = 0;
      lastPullDistanceRef.current = 0;
      setTranslateX(0);
      jumpPanelX(0);
      releaseEnterLock();
      setNavPhase('idle');
      setEnterTouchShield(false);
      enterTouchShieldRef.current = false;
      enterCssActiveRef.current = false;
      blockTouchInteraction(fromForwardCommit ? NAV_POST_ENTER_GRACE_MS : 120);
      if (!fromForwardCommit) {
        settleOpenPanel(width, 'skip-enter');
      } else {
        scheduleEnterShieldRelease();
        logPose('settle:open:forward-commit', { viewportW: Math.round(width) });
      }
      logPose('layout:skip-enter', { fromForwardCommit });
      return;
    }

    if (!isMobile) {
      return;
    }

    const enterStartX = offscreenPanelX(width);
    const enterLayoutGen = layoutGen;
    const completeEnter = (reason: string) => {
      if (enterLayoutGen !== layoutGenRef.current) {
        navDebug.log('stack', 'enter:complete:stale', {
          enterLayoutGen,
          currentGen: layoutGenRef.current,
          screenId,
          reason,
        });
        return;
      }
      if (!enterCssActiveRef.current) return;
      enterCssActiveRef.current = false;
      if (enterWatchdogRef.current !== null) {
        clearTimeout(enterWatchdogRef.current);
        enterWatchdogRef.current = null;
      }
      enterAnimationStopRef.current = null;
      settleOpenPanel(width, reason, { releaseShield: false });
      blockTouchInteraction(NAV_POST_ENTER_GRACE_MS);
      scheduleEnterShieldRelease();
      logPose('layout:enter-complete', { layoutGen: enterLayoutGen, reason });
    };

    jumpPanelX(enterStartX);
    translateXRef.current = 0;
    setNavPhase('enter');
    setEnterTouchShield(true);
    enterTouchShieldRef.current = true;
    enterLockedRef.current = true;
    enterGraceUntilRef.current = performance.now() + NAV_ENTER_GRACE_MS;
    blockTouchInteraction(NAV_ENTER_GRACE_MS);
    enterCssActiveRef.current = true;
    enterAnimationStopRef.current = null;
    scheduleEnterShieldRelease();
    logPose('layout:enter-start', {
      panelXStart: Math.round(enterStartX),
      graceMs: NAV_ENTER_GRACE_MS,
      layoutGen,
      enterMode: 'panel-settle',
    });

    cancelEnterStartRaf();
    enterStartRafRef.current = requestAnimationFrame(() => {
      enterStartRafRef.current = null;
      if (enterLayoutGen !== layoutGenRef.current) return;
      if (!enterCssActiveRef.current) return;
      startEnterTween(enterStartX, enterLayoutGen, width, completeEnter);
    });

    enterWatchdogRef.current = setTimeout(() => {
      if (enterLayoutGen !== layoutGenRef.current) return;
      if (!enterCssActiveRef.current) return;
      navDebug.log('stack', 'enter:watchdog', { screenId, layoutGen: enterLayoutGen });
      cancelEnterAnimation();
      jumpPanelX(0);
      completeEnter('enter-watchdog');
    }, NAV_SWIPE_COMPLETE_S * 1000 + 150);

    return () => {
      cancelEnterStartRaf();
      if (enterWatchdogRef.current !== null) {
        clearTimeout(enterWatchdogRef.current);
        enterWatchdogRef.current = null;
      }
      if (enterShieldTimerRef.current !== null) {
        clearTimeout(enterShieldTimerRef.current);
        enterShieldTimerRef.current = null;
      }
      stopEnterAnimation();
    };
  }, [isForwardPull, skipEnterAnimation, screenId, isMobile]);

  useEffect(() => {
    const syncViewport = () => {
      setViewportWidth(getViewportWidth());
      setIsMobile(window.innerWidth < 768);
    };
    syncViewport();
    window.addEventListener('resize', syncViewport);
    window.visualViewport?.addEventListener('resize', syncViewport);
    logPose('mount');
    return () => {
      window.removeEventListener('resize', syncViewport);
      window.visualViewport?.removeEventListener('resize', syncViewport);
      clearNavSwipeLocks(forwardShellRef?.current ?? undefined);
      stopAllAnimations();
      if (pendingTranslateFrameRef.current !== null) {
        cancelAnimationFrame(pendingTranslateFrameRef.current);
      }
      if (enterShieldTimerRef.current !== null) {
        clearTimeout(enterShieldTimerRef.current);
        enterShieldTimerRef.current = null;
      }
      logPose('unmount');
    };
  }, []);

  const animateToRest = (
    targetPull: number,
    onDone?: () => void,
    releaseVelocityPxPerMs = 0
  ) => {
    stopSnapAnimation();
    const width = getViewportWidth();
    const forward = isForwardPull;
    const targetPanelX = pullToPanelXForMode(targetPull, width, forward);
    const motionVelocity =
      (forward ? -releaseVelocityPxPerMs : releaseVelocityPxPerMs) * 1000;
    const dismissingStack =
      !forward && targetPull >= width - NAV_SWIPE_OFFSCREEN_EPSILON_PX;
    const openingStack =
      !forward && targetPull <= NAV_SWIPE_OFFSCREEN_EPSILON_PX;
    const openingForward =
      forward && targetPull >= width - NAV_SWIPE_OFFSCREEN_EPSILON_PX;
    const useSettleTween = dismissingStack || openingStack || openingForward;
    const offscreenX = offscreenPanelX(width);

    setNavPhase('snap');
    const snapLayoutGen = layoutGenRef.current;
    snapOnDoneRef.current = onDone ?? null;
    logPose('snap:start', {
      targetPull: Math.round(targetPull),
      targetPanelX: Math.round(targetPanelX),
      velocityPxPerS: Math.round(motionVelocity),
      layoutGen: snapLayoutGen,
      settleMode: useSettleTween ? 'tween' : 'spring',
    });

    const controls = animate(panelX, targetPanelX, {
      ...(useSettleTween ? NAV_SWIPE_SETTLE : NAV_SWIPE_SPRING),
      velocity: useSettleTween ? undefined : motionVelocity,
      onUpdate: (latest) => {
        const clampedLatest = Math.max(0, Math.min(latest, offscreenX));
        translateXRef.current = panelXToPullForMode(clampedLatest, width, forward);
      },
      onComplete: () => {
        snapAnimationStopRef.current = null;
        const done = snapOnDoneRef.current;
        snapOnDoneRef.current = null;

        if (snapLayoutGen !== layoutGenRef.current) {
          navDebug.log('stack', 'snap:complete:stale', {
            snapLayoutGen,
            currentGen: layoutGenRef.current,
            screenId,
            hadOnDone: Boolean(done),
            trace: navDebug.captureTrace(),
          });
          return;
        }

        setNavPhase('idle');
        if (dismissingStack) {
          const hiddenX = offscreenPanelX(width);
          jumpPanelX(hiddenX);
          translateXRef.current = 0;
          setTranslateX(0);
          logPose('snap:complete:dismiss', {
            targetPanelX: Math.round(hiddenX),
            layoutGen: snapLayoutGen,
          });
        } else if (!forward && targetPull <= NAV_SWIPE_OFFSCREEN_EPSILON_PX) {
          settleOpenPanel(width, 'snap-open');
          logPose('snap:complete:open', {
            targetPull: Math.round(targetPull),
            targetPanelX: Math.round(panelX.get()),
            layoutGen: snapLayoutGen,
          });
        } else {
          translateXRef.current = targetPull;
          setTranslateX(targetPull);
          jumpPanelX(targetPanelX);
          logPose('snap:complete', {
            targetPull: Math.round(targetPull),
            targetPanelX: Math.round(targetPanelX),
            layoutGen: snapLayoutGen,
          });
        }
        done?.();
      },
    });
    snapAnimationStopRef.current = () => controls.stop();
  };

  const resetTouchState = () => {
    touchStartedOnEdgeRef.current = false;
    directionLockedRef.current = false;
    isVerticalScrollRef.current = false;
    isDraggingRef.current = false;
    setNavEdgeTouchActive(false);
    setSwipeBackLock(false);
    setNavForwardSwipeLock(false, forwardShellRef?.current);
    if (navPhase === 'drag') {
      setNavPhase('idle');
    }
  };

  const handleTouchStart = (startX: number, startY: number) => {
    // If an overlay sheet (e.g. profile card) is currently being dragged
    // vertically, do not start a horizontal swipe-back gesture.
    if (isSheetDragActive()) return;
    if (!isForwardPull && enterTouchShieldRef.current) {
      return;
    }
    if (!isForwardPull && !isTouchInteractionReady()) {
      logPose('touch:start:blocked-grace', {
        pull: Math.round(translateXRef.current),
        graceLeftMs: Math.max(0, Math.round(interactionReadyAtRef.current - performance.now())),
      });
      return;
    }
    if (enterCssActiveRef.current || enterAnimationStopRef.current) {
      if (!enterBlockLogRef.current) {
        enterBlockLogRef.current = true;
        logPose('touch:start:blocked-enter', {
          pull: Math.round(translateXRef.current),
          panelXPx: Math.round(panelXRef.current),
          graceLeftMs: Math.max(0, Math.round(enterGraceUntilRef.current - performance.now())),
        });
      }
      return;
    }
    stopSnapAnimation();
    if (pendingTranslateFrameRef.current !== null) {
      cancelAnimationFrame(pendingTranslateFrameRef.current);
      pendingTranslateFrameRef.current = null;
    }
    touchStartedOnEdgeRef.current = false;

    const width = getViewportWidth();

    if (isForwardPull) {
      if (startX <= width * FORWARD_EDGE_RATIO) return;
    }
    // For back-swipe: accept touches anywhere on screen, but only set
    // navEdgeTouch (which suppresses swipe-to-reply) when the touch genuinely
    // started in the reserved left-edge zone.  Mid-screen back-swipes proceed
    // normally — the reply hook won't be suppressed for them.

    touchStartedOnEdgeRef.current = true;
    if (!isForwardPull && startX <= width * BACK_EDGE_INSET_RATIO) {
      setNavEdgeTouchActive(true);
    } else if (isForwardPull) {
      setNavEdgeTouchActive(true);
    }

    const now = performance.now();
    startXRef.current = startX;
    startYRef.current = startY;
    currentXRef.current = startX;
    lastTouchXRef.current = startX;
    lastTouchTimeRef.current = now;
    lastPullDistanceRef.current = translateXRef.current;
    lastPullTimeRef.current = now;
    directionLockedRef.current = false;
    isVerticalScrollRef.current = false;
    isDraggingRef.current = false;
    setSwipeBackLock(false);
    setNavForwardSwipeLock(false, forwardShellRef?.current);

    logPose('touch:start', {
      x: Math.round(startX),
      y: Math.round(startY),
      pull: Math.round(translateXRef.current),
      panelX: Math.round(panelXRef.current),
    });
  };

  const handleTouchMove = (currentX: number, currentY: number) => {
    if (!touchStartedOnEdgeRef.current) return;
    // Yield to an active sheet drag even if touchstart already registered.
    if (isSheetDragActive()) {
      touchStartedOnEdgeRef.current = false;
      return;
    }
    if (!isForwardPull && enterTouchShieldRef.current) return;
    if (!isForwardPull && !isTouchInteractionReady()) return;

    const deltaX = currentX - startXRef.current;
    const deltaY = currentY - startYRef.current;
    const width = getViewportWidth();

    if (!directionLockedRef.current) {
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);

      if (absDeltaX > 10 || absDeltaY > 10) {
        directionLockedRef.current = true;

        if (isForwardPull) {
          const isRightEdgeSwipe = startXRef.current > width * FORWARD_EDGE_RATIO && deltaX < 0;
          if (absDeltaY > absDeltaX * 1.65 || !isRightEdgeSwipe) {
            isVerticalScrollRef.current = true;
            setNavEdgeTouchActive(false);
            setSwipeBackLock(false);
            return;
          }
        } else if (absDeltaY > absDeltaX * 1.65 || deltaX <= 0) {
          isVerticalScrollRef.current = true;
          setNavEdgeTouchActive(false);
          setSwipeBackLock(false);
          return;
        }

        isVerticalScrollRef.current = false;
        isDraggingRef.current = true;
        setNavPhase('drag');
        if (isForwardPull) {
          setNavForwardSwipeLock(true, forwardShellRef?.current);
        } else {
          setSwipeBackLock(true);
        }
        logPose('touch:drag-lock', { deltaX: Math.round(deltaX), deltaY: Math.round(deltaY) });
      } else {
        return;
      }
    }

    if (isVerticalScrollRef.current || !isDraggingRef.current) return;

    const pullDistance = isForwardPull
      ? Math.min(Math.max(0, startXRef.current - currentX), width)
      : Math.min(Math.max(0, deltaX), width);

    if (pullDistance > 0) {
      currentXRef.current = currentX;
      lastTouchXRef.current = currentX;
      const now = performance.now();
      const pullDt = now - lastPullTimeRef.current;
      if (pullDt > 0) {
        lastPullDistanceRef.current = pullDistance;
        lastPullTimeRef.current = now;
      }
      lastTouchTimeRef.current = now;
      applyPanelX(pullDistance, width);
    }
  };

  const handleTouchEnd = () => {
    if (!touchStartedOnEdgeRef.current) return;
    touchStartedOnEdgeRef.current = false;
    if (!isForwardPull && enterTouchShieldRef.current) {
      resetTouchState();
      return;
    }
    if (!isForwardPull && !isTouchInteractionReady()) {
      resetTouchState();
      return;
    }

    if (pendingTranslateFrameRef.current !== null) {
      cancelAnimationFrame(pendingTranslateFrameRef.current);
      pendingTranslateFrameRef.current = null;
      applyPanelX(translateXRef.current);
    }

    if (!isDraggingRef.current) {
      resetTouchState();
      return;
    }

    const width = getViewportWidth();
    const now = performance.now();
    const fingerTimeDelta = now - lastTouchTimeRef.current;
    const fingerVelocity =
      fingerTimeDelta > 0 ? (currentXRef.current - lastTouchXRef.current) / fingerTimeDelta : 0;
    const pullTimeDelta = now - lastPullTimeRef.current;
    const pullVelocity =
      pullTimeDelta > 0
        ? (translateXRef.current - lastPullDistanceRef.current) / pullTimeDelta
        : fingerVelocity;
    const distance = translateXRef.current;
    const distanceThreshold = Math.max(NAV_SWIPE_MIN_DISTANCE_PX, width * NAV_SWIPE_DISTANCE_RATIO);

    // Fast-flick path: short decisive swipe at high velocity succeeds regardless
    // of the distance ratio.  Both the panel velocity and the raw finger velocity
    // are checked so either a slowly-accelerating drag or a crisp wrist-flick wins.
    const isFlick = isForwardPull
      ? (pullVelocity > NAV_SWIPE_FLICK_VELOCITY || fingerVelocity < -NAV_SWIPE_FLICK_VELOCITY) &&
        distance >= NAV_SWIPE_FLICK_MIN_PX
      : (pullVelocity > NAV_SWIPE_FLICK_VELOCITY || fingerVelocity > NAV_SWIPE_FLICK_VELOCITY) &&
        distance >= NAV_SWIPE_FLICK_MIN_PX;

    const shouldComplete = isFlick ||
      (isForwardPull
        ? pullVelocity > NAV_SWIPE_VELOCITY_THRESHOLD ||
          fingerVelocity < -NAV_SWIPE_VELOCITY_THRESHOLD ||
          distance > distanceThreshold
        : pullVelocity > NAV_SWIPE_VELOCITY_THRESHOLD ||
          fingerVelocity > NAV_SWIPE_VELOCITY_THRESHOLD ||
          distance > distanceThreshold);

    const wasDraggingForward = isForwardPull;

    isDraggingRef.current = false;
    setSwipeBackLock(false);
    setNavForwardSwipeLock(false, forwardShellRef?.current);

    // After any forward-swipe drag the browser fires a synthetic click at the
    // lift-off coordinates.  Because the forward shell has pointerEvents:'none'
    // that click falls through to the preview list and opens the wrong chat row.
    // Install a one-shot capture handler that swallows that click.
    if (wasDraggingForward && forwardShellRef?.current) {
      const shield = forwardShellRef.current;
      const blockClick = (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        shield.removeEventListener('click', blockClick, true);
      };
      shield.addEventListener('click', blockClick, { capture: true, once: true });
      // Safety removal if no click arrives within 600 ms.
      setTimeout(() => shield.removeEventListener('click', blockClick, true), 600);
    }

    logPose('touch:end', {
      distance: Math.round(distance),
      threshold: Math.round(distanceThreshold),
      pullVelocity: Number(pullVelocity.toFixed(3)),
      fingerVelocity: Number(fingerVelocity.toFixed(3)),
      shouldComplete,
    });

    if (shouldComplete) {
      if (isForwardPull) {
        onForwardOpenStartRef.current?.();
      }
      animateToRest(width, () => {
        if (isForwardPull) {
          onForwardCompleteRef.current?.();
        } else {
          onBeforeBackRef.current?.();
          onBackRef.current();
        }
        resetTouchState();
      }, pullVelocity);
      return;
    }

    if (distance > NAV_SWIPE_OFFSCREEN_EPSILON_PX) {
      animateToRest(0, resetTouchState, pullVelocity);
    } else {
      stopSnapAnimation();
      applyPanelX(0, width);
      resetTouchState();
      logPose('touch:end:cancel');
    }
  };

  useEffect(() => {
    if (!isMobile) return;

    const shell = isForwardPull ? forwardShellRef?.current : shellRef.current;
    if (!shell) return;

    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      handleTouchStart(touch.clientX, touch.clientY);
    };

    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      handleTouchMove(touch.clientX, touch.clientY);
    };

    const onTouchEnd = () => {
      handleTouchEnd();
    };

    shell.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    shell.addEventListener('touchmove', onTouchMove, { capture: true, passive: true });
    shell.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    shell.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true });

    return () => {
      shell.removeEventListener('touchstart', onTouchStart, { capture: true });
      shell.removeEventListener('touchmove', onTouchMove, { capture: true });
      shell.removeEventListener('touchend', onTouchEnd, { capture: true });
      shell.removeEventListener('touchcancel', onTouchEnd, { capture: true });
      if (isForwardPull) {
        setNavForwardSwipeLock(false, shell);
      } else {
        setNavSwipeBackLock(false, shell);
      }
    };
  }, [forwardShellRef, isForwardPull, isMobile]);

  const width = viewportWidth || getViewportWidth();
  const offscreenX = width;
  const isGestureActive =
    navPhase === 'drag' || navPhase === 'snap' || isDraggingRef.current;
  const isForwardHidden = isForwardPull && !isGestureActive;
  const isEnterSliding = enterCssActiveRef.current || navPhase === 'enter';
  const isTransitioning = isGestureActive || isEnterSliding;

  useLayoutEffect(() => {
    const node = viewportShellRef.current;
    if (!node) return;

    if (isForwardHidden && isForwardPull) {
      node.setAttribute('inert', '');
      const active = document.activeElement;
      if (active instanceof HTMLElement && node.contains(active)) {
        active.blur();
      }
    } else {
      node.removeAttribute('inert');
    }
  }, [isForwardHidden, isForwardPull]);

  if (isMobile) {
    const stackAboveTabBar = !isForwardHidden;
    const mobileShellStyle: React.CSSProperties = {
      ...navigationStackShellStyle,
      zIndex: stackAboveTabBar ? navigationStackShellStyle.zIndex : 5,
      // No box-shadow on the moving layer — shadows on will-change:transform
      // elements force per-frame repaint and are not GPU-composited.
      touchAction: isForwardPull ? 'none' : swipeBackLocked ? 'none' : 'pan-y',
      pointerEvents: isForwardPull ? 'none' : 'auto',
      visibility: isForwardHidden ? 'hidden' : 'visible',
      contentVisibility: isForwardHidden ? 'hidden' : undefined,
      willChange: isForwardHidden ? undefined : 'transform',
      backfaceVisibility: 'hidden',
      WebkitBackfaceVisibility: 'hidden',
    };
    return (
      <>
        <motion.div
          ref={shellRef}
          data-nav-shell
          initial={false}
          style={{ x: panelX, ...mobileShellStyle }}
          exit={{ x: offscreenX }}
          transition={{ duration: 0 }}
        >
          <div
            ref={viewportShellRef}
            data-visual-viewport-shell
            data-nav-phase={navPhase}
            data-nav-screen-id={screenId}
            className="flex min-h-0 w-full flex-col overflow-hidden"
            style={{
              boxSizing: 'border-box',
              // Explicitly sized to the visual viewport height so chat content
              // (header + messages + composer) stays above the keyboard.
              // The outer motion.div extends to screen bottom (bottom:0) so its
              // opaque background covers the gap — no preview bleed.
              height: `var(${MOBILE_VV_CSS.height}, 100dvh)`,
              pointerEvents: isForwardHidden ? 'none' : 'auto',
            }}
            aria-hidden={isForwardHidden}
          >
            {React.isValidElement(children) ? React.cloneElement(children as React.ReactElement<any>, { ...(screenId?.startsWith('chat-') ? { isActiveTopScreen: !isForwardHidden, isTransitioning } : {}) }) : children}
            {enterTouchShield ? (
              <div
                className="absolute inset-0 z-[200] touch-none pointer-events-none"
                aria-hidden
                data-nav-enter-shield
              />
            ) : null}
          </div>
        </motion.div>
      </>
    );
  }

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{
        type: 'tween',
        duration: NAV_SWIPE_COMPLETE_S,
        ease: NAV_SWIPE_EASE,
      }}
      style={navigationStackShellStyleDesktop}
    >
      {React.isValidElement(children) ? React.cloneElement(children as React.ReactElement<any>, { ...(screenId?.startsWith('chat-') ? { isActiveTopScreen: true, isTransitioning: false } : {}) }) : children}
    </motion.div>
  );
}
