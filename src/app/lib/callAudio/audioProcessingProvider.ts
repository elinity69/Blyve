/** Blyve call audio: Jitsi RNNoise (on/off) + Web Audio filter for owned mic streams. */
export type AudioProcessingBackend = 'jitsi-native';

export function describeActiveBackend(): AudioProcessingBackend {
  return 'jitsi-native';
}
