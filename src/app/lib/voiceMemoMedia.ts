import { applyNoiseCancellationToStream, premiumCallAudio, releaseNoiseCancellation } from './callAudio/ensurePremiumCallAudio';
import { getPremiumMicConstraintsForPreflight } from './callAudio/browserCapabilities';
import { markJitsiMicGranted, shouldSkipJitsiPrejoin } from './jitsiMicStorage';
import {
  checkMicrophonePermission,
  hasMicrophonePermission,
  requestMicrophoneAccess,
} from './mediaPermissions';

let warmStream: MediaStream | null = null;

function stopStreamTracks(stream: MediaStream | null) {
  stream?.getAudioTracks().forEach((track) => {
    track.stop();
  });
}

/** Release mic hardware after voice memo ends; permission flag stays cached. */
export function releaseVoiceMemoStream(): void {
  stopStreamTracks(warmStream);
  warmStream = null;
  releaseNoiseCancellation();
}

/**
 * Mic for voice memos: one permission prompt, then reuse a warm stream across recordings.
 * Tracks are stopped when recording ends — only the grant flag persists.
 */
export async function acquireVoiceMemoStream(): Promise<MediaStream | null> {
  if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return null;
  }

  if (premiumCallAudio.isSessionActive()) {
    return null;
  }

  const liveTrack = warmStream?.getAudioTracks().find((track) => track.readyState === 'live');
  if (liveTrack) {
    return warmStream;
  }

  if (warmStream) {
    releaseVoiceMemoStream();
  }

  if (!(await hasMicrophonePermission()) && !shouldSkipJitsiPrejoin()) {
    const permission = await checkMicrophonePermission();
    if (permission !== 'granted') {
      const access = await requestMicrophoneAccess();
      if (!access.ok) return null;
    }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia(getPremiumMicConstraintsForPreflight());
    markJitsiMicGranted();
    warmStream = await applyNoiseCancellationToStream(stream);
    return warmStream;
  } catch {
    return null;
  }
}
