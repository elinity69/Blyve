import React, { createContext, useContext, useMemo } from 'react';

export type ScreenPhase = 'active' | 'preparing-underlay' | 'leaving' | 'parked';

export interface ScreenLifecycleState {
  phase: ScreenPhase;
  isFrozen: boolean;
  isActiveTop: boolean;
  isInteractive: boolean;
  shouldRunExpensiveEffects: boolean;
}

const ScreenLifecycleContext = createContext<ScreenLifecycleState>({
  phase: 'active',
  isFrozen: false,
  isActiveTop: true,
  isInteractive: true,
  shouldRunExpensiveEffects: true,
});

export const useScreenLifecycle = () => useContext(ScreenLifecycleContext);

export const ScreenLifecycleProvider = ({ 
  phase, 
  children 
}: { 
  phase: ScreenPhase; 
  children: React.ReactNode 
}) => {
  const value = useMemo(() => {
    const isFrozen = phase === 'leaving' || phase === 'parked';
    const isActive = phase === 'active';
    return {
      phase,
      isFrozen,
      isActiveTop: isActive,
      isInteractive: isActive,
      shouldRunExpensiveEffects: !isFrozen,
    };
  }, [phase]);

  return (
    <ScreenLifecycleContext.Provider value={value}>
      {children}
    </ScreenLifecycleContext.Provider>
  );
};
