const MOBILE_UA_PATTERN = /Android|iPhone|iPad|iPod|Mobile/i;

export function isMobileWebBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return MOBILE_UA_PATTERN.test(navigator.userAgent);
}

export function isScreenShareApiAvailable(): boolean {
  if (typeof navigator === 'undefined') return false;
  return typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

/** Browsers that can pick a screen/tab/window for sharing (mobile or desktop). */
export function isScreenShareSupported(): boolean {
  if (!isScreenShareApiAvailable()) return false;
  if (typeof window !== 'undefined' && !window.isSecureContext) return false;
  return true;
}