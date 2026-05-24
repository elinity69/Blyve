export type CallMediaProvider = 'livekit' | 'jitsi';

/** Default jitsi — set VITE_CALL_PROVIDER=livekit to use LiveKit again. */
export function getCallMediaProvider(): CallMediaProvider {
  const raw = import.meta.env.VITE_CALL_PROVIDER?.trim().toLowerCase();
  if (raw === 'livekit') return 'livekit';
  return 'jitsi';
}

export function isJitsiCallProvider(): boolean {
  return getCallMediaProvider() === 'jitsi';
}

export function isLiveKitCallProvider(): boolean {
  return getCallMediaProvider() === 'livekit';
}
