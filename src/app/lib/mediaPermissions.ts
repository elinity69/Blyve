import { markJitsiMicGranted, shouldSkipJitsiPrejoin } from './jitsiMicStorage';

export type MicrophoneAccessResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'insecure' | 'denied' | 'error'; message?: string };

export function isSecureContextForMedia(): boolean {
  if (typeof window === 'undefined') return false;
  return window.isSecureContext;
}

export function getInsecureMediaContextHint(): string | null {
  if (typeof window === 'undefined') return null;
  if (window.isSecureContext) return null;

  const { protocol, hostname } = window.location;
  if (protocol === 'http:' && hostname !== 'localhost' && hostname !== '127.0.0.1') {
    return 'http-lan';
  }
  if (protocol === 'http:') {
    return 'http';
  }
  return 'insecure';
}

export type MicrophonePermissionState = 'granted' | 'denied' | 'prompt' | 'unknown';

export async function checkMicrophonePermission(): Promise<MicrophonePermissionState> {
  if (typeof window === 'undefined') return 'unknown';
  if (!navigator.permissions?.query) return 'unknown';

  try {
    const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    return result.state as MicrophonePermissionState;
  } catch {
    return 'unknown';
  }
}

export async function hasMicrophonePermission(): Promise<boolean> {
  // Persisted across sessions (incl. PWA / Add to Home Screen on same origin).
  if (shouldSkipJitsiPrejoin()) {
    return true;
  }
  const state = await checkMicrophonePermission();
  if (state === 'granted') {
    markJitsiMicGranted();
    return true;
  }
  return false;
}

/** Request mic while the browser still has a user-gesture (call/accept button click). */
export async function requestMicrophoneAccess(): Promise<MicrophoneAccessResult> {
  if (typeof window === 'undefined') {
    return { ok: false, reason: 'unsupported' };
  }

  const insecureHint = getInsecureMediaContextHint();
  if (insecureHint) {
    return {
      ok: false,
      reason: 'insecure',
      message: insecureHint,
    };
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: 'unsupported' };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach((track) => track.stop());
    markJitsiMicGranted();
    return { ok: true };
  } catch (error: unknown) {
    const name = String((error as DOMException)?.name || '');
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return { ok: false, reason: 'denied', message: name };
    }
    return {
      ok: false,
      reason: 'error',
      message: String((error as Error)?.message || name || 'unknown'),
    };
  }
}
