export const PREMIUM_MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export function getPremiumMicConstraintsForPreflight(): MediaStreamConstraints {
  return {
    audio: PREMIUM_MIC_CONSTRAINTS,
    video: false,
  };
}
