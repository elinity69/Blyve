import type { AudioProcessingBackend } from './audioProcessingProvider';
import {
  applyJitsiNoiseSuppression,
  registerJitsiMeetingApi,
  reinforceJitsiNoiseSuppressionOnUnmute,
  unregisterJitsiMeetingApi,
  type JitsiCommandApi,
} from './jitsiAudioBridge';

export type { JitsiCommandApi };

/** Standard call audio: Jitsi RNNoise via setNoiseSuppressionEnabled (always on, no user toggle). */
const JITSI_NATIVE_BACKEND: AudioProcessingBackend = 'jitsi-native';

let sessionActive = false;

export const premiumCallAudio = {
  getActiveBackend(): AudioProcessingBackend {
    return JITSI_NATIVE_BACKEND;
  },

  getProcessedStream(): MediaStream | null {
    return null;
  },

  async prepareForCall(_deviceId?: string | null): Promise<void> {
    sessionActive = true;
  },

  attachJitsiMeeting(api: JitsiCommandApi): void {
    registerJitsiMeetingApi(api);
    applyJitsiNoiseSuppression();
  },

  onJitsiConferenceJoined(): void {
    applyJitsiNoiseSuppression();
  },

  onJitsiAudioUnmuted(): void {
    reinforceJitsiNoiseSuppressionOnUnmute();
  },

  async onInputDeviceChanged(_deviceId?: string | null): Promise<void> {
    reinforceJitsiNoiseSuppressionOnUnmute();
  },

  detachJitsiMeeting(): void {
    unregisterJitsiMeetingApi();
  },

  release(): void {
    sessionActive = false;
    unregisterJitsiMeetingApi();
  },

  isSessionActive(): boolean {
    return sessionActive;
  },
};

export async function ensurePremiumCallAudio(_deviceId?: string | null): Promise<void> {
  await premiumCallAudio.prepareForCall();
}

export function applyNoiseCancellationToStream(stream: MediaStream): MediaStream {
  return stream;
}
