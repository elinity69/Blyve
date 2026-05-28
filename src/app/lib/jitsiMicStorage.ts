/** Persists on same origin — survives PWA / Add to Home Screen reloads. */
const JITSI_MIC_GRANTED_KEY = 'blyve_jitsi_mic_granted';

function writeMicGrantedFlag(): void {
  try {
    window.localStorage.setItem(JITSI_MIC_GRANTED_KEY, '1');
    window.sessionStorage.setItem(JITSI_MIC_GRANTED_KEY, '1');
  } catch {
    // ignore storage failures
  }
}

export function shouldSkipJitsiPrejoin(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return (
      window.localStorage.getItem(JITSI_MIC_GRANTED_KEY) === '1' ||
      window.sessionStorage.getItem(JITSI_MIC_GRANTED_KEY) === '1'
    );
  } catch {
    return false;
  }
}

export function markJitsiMicGranted(): void {
  if (typeof window === 'undefined') return;
  writeMicGrantedFlag();
}
