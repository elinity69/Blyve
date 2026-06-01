const PROBE_TIMEOUT_MS = 12_000;
const DECODE_MAX_BYTES = 8 * 1024 * 1024;

function readElementDuration(audio: HTMLAudioElement): number {
  const value = audio.duration;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function probeWithAudioElement(src: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'auto';
    audio.src = src;

    let settled = false;
    let seekProbeStarted = false;

    const settle = (value: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      resolve(value > 0 ? value : 0);
    };

    const timer = window.setTimeout(() => settle(0), PROBE_TIMEOUT_MS);

    const trySeekProbe = () => {
      if (settled || seekProbeStarted) return;
      if (readElementDuration(audio) > 0) {
        settle(readElementDuration(audio));
        return;
      }
      seekProbeStarted = true;

      const onSeeked = () => {
        audio.removeEventListener('seeked', onSeeked);
        settle(readElementDuration(audio));
      };

      audio.addEventListener('seeked', onSeeked);
      try {
        audio.currentTime = 1e101;
      } catch {
        settle(0);
      }
    };

    const onMetadata = () => {
      const direct = readElementDuration(audio);
      if (direct > 0) {
        settle(direct);
        return;
      }
      trySeekProbe();
    };

    audio.addEventListener('loadedmetadata', onMetadata);
    audio.addEventListener('durationchange', () => {
      const direct = readElementDuration(audio);
      if (direct > 0) settle(direct);
    });
    audio.addEventListener('canplay', () => {
      const direct = readElementDuration(audio);
      if (direct > 0) settle(direct);
      else trySeekProbe();
    });
    audio.addEventListener('error', () => settle(0), { once: true });
    audio.load();

    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) onMetadata();
  });
}

async function probeWithDecode(src: string): Promise<number> {
  try {
    const response = await fetch(src);
    if (!response.ok) return 0;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength <= 0 || buffer.byteLength > DECODE_MAX_BYTES) return 0;

    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(buffer.slice(0));
      return decoded.duration > 0 ? decoded.duration : 0;
    } finally {
      void context.close();
    }
  } catch {
    return 0;
  }
}

/** Resolves playable length for voice messages (incl. WebM without duration metadata). */
export async function resolveAudioDuration(src: string): Promise<number> {
  if (!src) return 0;
  const fromElement = await probeWithAudioElement(src);
  if (fromElement > 0) return fromElement;
  return probeWithDecode(src);
}
