/** Reload chat data when the tab/app returns to the foreground (mobile Safari, PWA). */
export function onAppForeground(callback: () => void): () => void {
  if (typeof document === 'undefined') return () => {};

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      callback();
    }
  };

  const handlePageShow = (event: PageTransitionEvent) => {
    if (event.persisted) {
      callback();
    }
  };

  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('pageshow', handlePageShow);

  return () => {
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('pageshow', handlePageShow);
  };
}

/** Re-subscribe when Supabase Realtime drops the channel (background tab, network blip). */
export function shouldResubscribeRealtimeChannel(status: string): boolean {
  return status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED';
}
