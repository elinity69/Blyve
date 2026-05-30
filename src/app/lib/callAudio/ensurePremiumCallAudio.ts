import type { AudioProcessingBackend } from './audioProcessingProvider';
import { applyAggressiveNoiseFilter, stopAggressiveNoiseFilter } from './aggressiveNoiseFilter';
import {
  applyJitsiNoiseSuppression,
  registerJitsiMeetingApi,
  reinforceJitsiNoiseSuppressionOnUnmute,
  setCallAudioSessionActive,
  unregisterJitsiMeetingApi,
  type JitsiCommandApi,
} from './jitsiAudioBridge';

export type { JitsiCommandApi };

/** Jitsi RNNoise (toggle only) + supplemental Web Audio filter for Blyve-owned streams. */
const JITSI_NATIVE_BACKEND: AudioProcessingBackend = 'jitsi-native';

let sessionActive = false;
let processedStream: MediaStream | null = null;
let rawInputStream: MediaStream | null = null;

export const premiumCallAudio = {
  getActiveBackend(): AudioProcessingBackend {
    return JITSI_NATIVE_BACKEND;
  },

  getProcessedStream(): MediaStream | null {
    return processedStream;
  },

  async prepareForCall(_deviceId?: string | null): Promise<void> {
    sessionActive = true;
    setCallAudioSessionActive(true);
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
    setCallAudioSessionActive(false);
    unregisterJitsiMeetingApi();
  },

  release(): void {
    sessionActive = false;
    setCallAudioSessionActive(false);
    unregisterJitsiMeetingApi();
    releaseProcessedMic();
  },

  isSessionActive(): boolean {
    return sessionActive;
  },
};

export async function ensurePremiumCallAudio(_deviceId?: string | null): Promise<void> {
  await premiumCallAudio.prepareForCall();
}

export async function applyNoiseCancellationToStream(stream: MediaStream): Promise<MediaStream> {
  releaseProcessedMic();
  rawInputStream = stream;
  processedStream = await applyAggressiveNoiseFilter(stream);
  return processedStream;
}

export function releaseNoiseCancellation(): void {
  releaseProcessedMic();
}

function releaseProcessedMic(): void {
  stopAggressiveNoiseFilter();
  processedStream = null;
  if (rawInputStream) {
    rawInputStream.getAudioTracks().forEach((track) => track.stop());
  }
  rawInputStream = null;
}
