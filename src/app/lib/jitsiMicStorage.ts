const JITSI_MIC_GRANTED_KEY = 'blyve_jitsi_mic_granted';

export function shouldSkipJitsiPrejoin(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(JITSI_MIC_GRANTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markJitsiMicGranted(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(JITSI_MIC_GRANTED_KEY, '1');
  } catch {
    // ignore storage failures
  }
}
