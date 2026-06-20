import React from 'react';
import { motion, MotionValue } from 'framer-motion';
import { ScreenPhase, ScreenLifecycleProvider } from '../contexts/ScreenLifecycleContext';

interface ScreenWrapperProps {
  phase: ScreenPhase;
  children: React.ReactNode;
  x?: MotionValue<number> | number;
  className?: string;
}

export const ScreenWrapper = ({ phase, children, x = 0, className = '' }: ScreenWrapperProps) => {
  const isParked = phase === 'parked';
  const isActive = phase === 'active';
  const elementRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const el = elementRef.current;
    if (!el) return;

    const screenId = className || el.id || 'unknown';
    const computedStyle = window.getComputedStyle(el);
    const pointerEvents = computedStyle.pointerEvents;
    const zIndex = computedStyle.zIndex;

    const containsCallSurface = !!el.querySelector('iframe, .floating-call-widget-global, [data-chat-call-host-zone]');
    const containsTopbarPortal = !!el.querySelector('[data-slot="dialog-header"], header, .header-portal');

    const isHidden = isParked || computedStyle.display === 'none' || computedStyle.visibility === 'hidden';
    const isInert = el.hasAttribute('inert');
    const isAriaHidden = el.getAttribute('aria-hidden') === 'true';

    console.log(`[SCREEN WRAPPER DEBUG] ts=${performance.now()}`, {
      screenId,
      phase,
      isActive,
      isHidden,
      isInert,
      isAriaHidden,
      pointerEvents,
      zIndex,
      containsCallSurface,
      containsTopbarPortal
    });

    if ((isHidden || isInert) && pointerEvents === 'auto') {
      console.warn(`[SCREEN WRAPPER DEBUG] WARNING: Hidden/Inert wrapper (${screenId}) still has pointer-events: auto! ts=${performance.now()}`);
    }

    if (!isActive && containsCallSurface) {
      console.warn(`[SCREEN WRAPPER DEBUG] WARNING: Inactive wrapper (${screenId}) contains a call surface! ts=${performance.now()}`);
    }
  }, [phase, className, isActive, isParked]);
  
  return (
    <ScreenLifecycleProvider phase={phase}>
      <motion.div
        ref={elementRef}
        className={`screen-layer ${className}`}
        // @ts-expect-error React 18 types do not include inert
        inert={!isActive ? "" : undefined}
        aria-hidden={!isActive ? "true" : undefined}
        style={{
          x,
          contentVisibility: isParked ? 'hidden' : 'visible',
          visibility: isParked ? 'hidden' : 'visible',
          pointerEvents: !isActive ? 'none' : 'auto',
          containIntrinsicSize: isParked ? 'auto 100dvh' : 'auto',
          willChange: (phase === 'preparing-underlay' || phase === 'leaving') ? 'transform' : 'auto',
          transform: 'translateZ(0)',
          backfaceVisibility: 'hidden',
        }}
      >
        {children}
      </motion.div>
    </ScreenLifecycleProvider>
  );
};
