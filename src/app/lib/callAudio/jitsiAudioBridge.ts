type JitsiCommandApi = {
  executeCommand: (command: string, ...args: unknown[]) => void;
};

export type { JitsiCommandApi };

let activeApi: JitsiCommandApi | null = null;
let reinforceTimeoutIds: number[] = [];
let deviceChangeListenerAttached = false;

function clearReinforceTimers() {
  for (const id of reinforceTimeoutIds) {
    window.clearTimeout(id);
  }
  reinforceTimeoutIds = [];
}

function scheduleNoiseSuppressionReinforcement() {
  clearReinforceTimers();
  for (const delayMs of [0, 400, 1200, 2500]) {
    reinforceTimeoutIds.push(
      window.setTimeout(() => {
        enableJitsiNoiseSuppression(activeApi);
      }, delayMs),
    );
  }
}

/** Enables Jitsi extra noise suppression (RNNoise) on the local audio track. */
export function enableJitsiNoiseSuppression(api: JitsiCommandApi | null = activeApi): void {
  if (!api) return;

  try {
    api.executeCommand('setNoiseSuppressionEnabled', { enabled: true });
  } catch (error) {
    console.warn('[call-audio] setNoiseSuppressionEnabled failed', error);
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
