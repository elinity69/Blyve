/** Standard Blyve call audio backend — Jitsi iframe RNNoise via setNoiseSuppressionEnabled. */
export type AudioProcessingBackend = 'jitsi-native';

export function describeActiveBackend(): AudioProcessingBackend {
  return 'jitsi-native';
}
