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
  
  return (
    <ScreenLifecycleProvider phase={phase}>
      <motion.div
        className={`screen-layer ${className}`}
        style={{
          x,
          contentVisibility: isParked ? 'hidden' : 'visible',
          visibility: isParked ? 'hidden' : 'visible',
          containIntrinsicSize: isParked ? 'auto 100dvh' : 'auto',
          pointerEvents: phase === 'active' ? 'auto' : 'none',
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
