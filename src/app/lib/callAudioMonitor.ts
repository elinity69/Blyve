import { linearRmsToDb, shouldShowSpeakingRing } from './callAudioLevels';

export interface LocalAudioMonitorOptions {
  onLevel: (levelDb: number, speaking: boolean) => void;
}

export interface LocalAudioMonitorHandle {
  dispose: () => void;
}

export async function startLocalAudioMonitor(
  options: LocalAudioMonitorOptions,
): Promise<LocalAudioMonitorHandle | null> {
  if (typeof window === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return null;
  }

  let disposed = false;
  let speaking = false;
  let stream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let rafId: number | null = null;

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    audioContext = new AudioCtx();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.35;
    source.connect(analyser);

    const samples = new Float32Array(analyser.fftSize);

    const tick = () => {
      if (disposed) return;
      analyser.getFloatTimeDomainData(samples);
      let sumSquares = 0;
      for (let i = 0; i < samples.length; i += 1) {
        sumSquares += samples[i] * samples[i];
      }
      const rms = Math.sqrt(sumSquares / samples.length);
      const levelDb = linearRmsToDb(rms);
      const nextSpeaking = shouldShowSpeakingRing(levelDb, speaking);
      speaking = nextSpeaking;
      options.onLevel(levelDb, nextSpeaking);
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
  } catch {
    return null;
  }

  return {
    dispose: () => {
      disposed = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      void audioContext?.close();
      audioContext = null;
    },
  };
}
