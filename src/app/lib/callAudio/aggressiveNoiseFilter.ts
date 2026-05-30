/**
 * Supplemental mic processing for keyboard clicks, breath rumble, and room noise.
 * Targets streams Blyve owns (voice memos, preflight). Jitsi iframe calls still rely
 * on browser NS + RNNoise via setNoiseSuppressionEnabled; see jitsiAudioBridge config.
 */

export interface AggressiveNoiseFilterOptions {
  highPassHz?: number;
  gateOpenDb?: number;
  gateCloseDb?: number;
  gateFloor?: number;
  gateAttack?: number;
  gateRelease?: number;
  compressorThreshold?: number;
  compressorRatio?: number;
  compressorAttack?: number;
  compressorRelease?: number;
}

export interface AggressiveNoiseFilterHandle {
  outputStream: MediaStream;
  dispose: () => void;
}

const DEFAULTS = {
  highPassHz: 140,
  gateOpenDb: -42,
  gateCloseDb: -52,
  gateFloor: 0.14,
  gateAttack: 0.012,
  gateRelease: 0.14,
  compressorThreshold: -28,
  compressorRatio: 6,
  compressorAttack: 0.002,
  compressorRelease: 0.08,
} as const;

let activeSession: AggressiveNoiseFilterHandle | null = null;

function linearRmsToDb(rms: number): number {
  if (rms <= 1e-8) return -100;
  return 20 * Math.log10(rms);
}

function resolveAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  return new Ctx();
}

export async function createAggressiveNoiseFilter(
  inputStream: MediaStream,
  options: AggressiveNoiseFilterOptions = {},
): Promise<AggressiveNoiseFilterHandle | null> {
  const audioTrack = inputStream.getAudioTracks()[0];
  if (!audioTrack || audioTrack.readyState !== 'live') return null;

  const audioContext = resolveAudioContext();
  if (!audioContext) return null;

  const settings = { ...DEFAULTS, ...options };
  let disposed = false;
  let rafId: number | null = null;
  let gateOpen = false;
  let currentGain = 1;

  const source = audioContext.createMediaStreamSource(inputStream);
  const highPass = audioContext.createBiquadFilter();
  highPass.type = 'highpass';
  highPass.frequency.value = settings.highPassHz;
  highPass.Q.value = 0.707;

  const compressor = audioContext.createDynamicsCompressor();
  compressor.threshold.value = settings.compressorThreshold;
  compressor.ratio.value = settings.compressorRatio;
  compressor.attack.value = settings.compressorAttack;
  compressor.release.value = settings.compressorRelease;
  compressor.knee.value = 8;

  const gateGain = audioContext.createGain();
  gateGain.gain.value = 1;

  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.25;

  const destination = audioContext.createMediaStreamDestination();

  source.connect(highPass);
  highPass.connect(compressor);
  compressor.connect(gateGain);
  gateGain.connect(analyser);
  analyser.connect(destination);

  const samples = new Float32Array(analyser.fftSize);

  const tick = () => {
    if (disposed) return;

    analyser.getFloatTimeDomainData(samples);
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i += 1) {
      sumSquares += samples[i] * samples[i];
    }
    const rmsDb = linearRmsToDb(Math.sqrt(sumSquares / samples.length));

    if (!gateOpen && rmsDb >= settings.gateOpenDb) {
      gateOpen = true;
    } else if (gateOpen && rmsDb <= settings.gateCloseDb) {
      gateOpen = false;
    }

    const targetGain = gateOpen ? 1 : settings.gateFloor;
    const smoothing = targetGain > currentGain ? settings.gateAttack : settings.gateRelease;
    currentGain += (targetGain - currentGain) * smoothing;
    gateGain.gain.setTargetAtTime(currentGain, audioContext.currentTime, 0.01);

    rafId = window.requestAnimationFrame(tick);
  };

  try {
    await audioContext.resume();
  } catch {
    // best effort — graph still works once user gesture resumes context
  }

  rafId = window.requestAnimationFrame(tick);

  const handle: AggressiveNoiseFilterHandle = {
    outputStream: destination.stream,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      source.disconnect();
      highPass.disconnect();
      compressor.disconnect();
      gateGain.disconnect();
      analyser.disconnect();
      destination.disconnect();
      void audioContext.close();
      if (activeSession === handle) activeSession = null;
    },
  };

  return handle;
}

export async function applyAggressiveNoiseFilter(
  inputStream: MediaStream,
  options?: AggressiveNoiseFilterOptions,
): Promise<MediaStream> {
  stopAggressiveNoiseFilter();
  const handle = await createAggressiveNoiseFilter(inputStream, options);
  if (!handle) return inputStream;
  activeSession = handle;
  return handle.outputStream;
}

export function stopAggressiveNoiseFilter(): void {
  activeSession?.dispose();
  activeSession = null;
}
