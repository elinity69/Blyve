export type CallMediaProvider = 'jitsi';

/** Jitsi-only call media provider. */
export function getCallMediaProvider(): CallMediaProvider {
  return 'jitsi';
}

export function isJitsiCallProvider(): boolean {
  return true;
}
