type JitsiCommandApi = {
  executeCommand: (command: string, ...args: unknown[]) => void;
};

export type { JitsiCommandApi };

let activeApi: JitsiCommandApi | null = null;
let reinforceTimeoutIds: number[] = [];
let deviceChangeListenerAttached = false;
let lastNoiseSuppressionAppliedAt = 0;
let callAudioSessionActive = false;

export function setCallAudioSessionActive(active: boolean): void {
  callAudioSessionActive = active;
  if (!active) {
    clearReinforceTimers();
  }
}

function clearReinforceTimers() {
  for (const id of reinforceTimeoutIds) {
    window.clearTimeout(id);
  }
  reinforceTimeoutIds = [];
}

function scheduleNoiseSuppressionReinforcement() {
  if (!callAudioSessionActive) return;
  clearReinforceTimers();
  const delays = activeApi ? [0, 400, 1200, 2500, 5000] : [200, 800, 2000];
  for (const delayMs of delays) {
    reinforceTimeoutIds.push(
      window.setTimeout(() => {
        const applied = enableJitsiNoiseSuppression(activeApi);
        if (!applied && import.meta.env.DEV) {
          console.debug('[call-audio] noise suppression retry skipped (no active api/session)');
        }
      }, delayMs),
    );
  }
}

/** Enables Jitsi extra noise suppression (RNNoise) on the local audio track. */
export function enableJitsiNoiseSuppression(api: JitsiCommandApi | null = activeApi): boolean {
  if (!api || !callAudioSessionActive) return false;

  try {
    api.executeCommand('setNoiseSuppressionEnabled', { enabled: true });
    lastNoiseSuppressionAppliedAt = Date.now();
    return true;
  } catch (error) {
    console.warn('[call-audio] setNoiseSuppressionEnabled failed', error);
    return false;
  }
}

function handleDeviceChange() {
  if (!activeApi) return;
  scheduleNoiseSuppressionReinforcement();
}

function attachDeviceChangeListener() {
  if (deviceChangeListenerAttached || typeof navigator === 'undefined') return;
  if (!navigator.mediaDevices?.addEventListener) return;
  navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
  deviceChangeListenerAttached = true;
}

function detachDeviceChangeListener() {
  if (!deviceChangeListenerAttached || typeof navigator === 'undefined') return;
  if (!navigator.mediaDevices?.removeEventListener) return;
  navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
  deviceChangeListenerAttached = false;
}

export function registerJitsiMeetingApi(api: JitsiCommandApi): void {
  activeApi = api;
  attachDeviceChangeListener();
}

export function unregisterJitsiMeetingApi(): void {
  clearReinforceTimers();
  detachDeviceChangeListener();
  activeApi = null;
  lastNoiseSuppressionAppliedAt = 0;
}

export function getLastNoiseSuppressionAppliedAt(): number {
  return lastNoiseSuppressionAppliedAt;
}

export function applyJitsiNoiseSuppression(): void {
  scheduleNoiseSuppressionReinforcement();
}

export function reinforceJitsiNoiseSuppressionOnUnmute(): void {
  scheduleNoiseSuppressionReinforcement();
}

/** Jitsi iframe config: keep audio processing + extra NS enabled (standard for all calls). */
export function buildJitsiNoiseSuppressionConfigOverwrite(): Record<string, unknown> {
  return {
    disableNS: false,
    disableAP: false,
    enableNoisyMicDetection: false,
    enableTalkWhileMuted: false,
  };
}

/** @deprecated Use applyJitsiNoiseSuppression */
export const applyPremiumCallAudioToJitsi = applyJitsiNoiseSuppression;

/** @deprecated Use reinforceJitsiNoiseSuppressionOnUnmute */
export const reinforcePremiumCallAudioOnUnmute = reinforceJitsiNoiseSuppressionOnUnmute;

/** @deprecated Use buildJitsiNoiseSuppressionConfigOverwrite */
export const buildJitsiPremiumAudioConfigOverwrite = buildJitsiNoiseSuppressionConfigOverwrite;

/** @deprecated Use enableJitsiNoiseSuppression */
export const enableJitsiNativeNoiseSuppression = enableJitsiNoiseSuppression;
