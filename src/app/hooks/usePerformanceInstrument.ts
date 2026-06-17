import { useEffect, useLayoutEffect, useRef } from 'react';
import { useScreenLifecycle } from '../contexts/ScreenLifecycleContext';

export function usePerformanceInstrument(screenName: string) {
  const { phase, isFrozen } = useScreenLifecycle();
  const renderCount = useRef(0);
  renderCount.current++;

  useEffect(() => {
    console.log(`📊 [${screenName}] Phase: ${phase} | Frozen: ${isFrozen} | Render #${renderCount.current}`);
  }, [phase, isFrozen, screenName]);

  useLayoutEffect(() => {
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      if (duration > 8 && isFrozen) {
        console.warn(`🚨 [${screenName}] Jank Alert! Cleanup/Unmount in Frozen-State blockiert Main-Thread für ${duration.toFixed(1)}ms`);
      }
    };
  });
}
