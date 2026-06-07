const PROBE_TIMEOUT_MS = 15_000;

// Large but finite seek target. Using 1e101 throws NotSupportedError on Safari
// for MP4/M4A; Number.MAX_SAFE_INTEGER is accepted by all browsers and still
// forces Chromium/WebM to compute the real duration via the seek-to-end trick.
const SEEK_TARGET = 1e9;

function readElementDuration(audio: HTMLAudioElement): number {
  const value = audio.duration;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function probeWithAudioElement(src: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'auto';
    // Set crossOrigin before src so the browser uses the same CORS cache
    // partition as VoiceMessagePlayer — avoids a double-fetch and cache mismatch.
    audio.crossOrigin = 'anonymous';
    audio.src = src;

    let settled = false;
    let seekProbeStarted = false;

    const settle = (value: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      } catch {
        // ignore cleanup errors
      }
      resolve(value > 0 ? value : 0);
    };

    const timer = window.setTimeout(() => settle(0), PROBE_TIMEOUT_MS);

    const trySeekProbe = () => {
      if (settled || seekProbeStarted) return;

      const direct = readElementDuration(audio);
      if (direct > 0) {
        settle(direct);
        return;
      }

      seekProbeStarted = true;

      // Allow a grace period for 'seeked' to fire (Safari on MP4 may be slow).
      const seekTimer = window.setTimeout(() => {
        audio.removeEventListener('seeked', onSeeked);
        settle(readElementDuration(audio));
      }, 4_000);

      const onSeeked = () => {
        window.clearTimeout(seekTimer);
        audio.removeEventListener('seeked', onSeeked);
        settle(readElementDuration(audio));
      };

      audio.addEventListener('seeked', onSeeked);
      try {
        audio.currentTime = SEEK_TARGET;
      } catch {
        window.clearTimeout(seekTimer);
        audio.removeEventListener('seeked', onSeeked);
        settle(0);
      }
    };

    const onDurationOrData = () => {
      const direct = readElementDuration(audio);
      if (direct > 0) settle(direct);
    };

    const onMetadata = () => {
      const direct = readElementDuration(audio);
      if (direct > 0) {
        settle(direct);
        return;
      }
      // Duration is Infinity (headerless WebM) or 0 — attempt seek probe.
      trySeekProbe();
    };

    audio.addEventListener('loadedmetadata', onMetadata);
    audio.addEventListener('durationchange', onDurationOrData);
    // 'canplay' fires on Safari before loadedmetadata in some MP4 streams.
    audio.addEventListener('canplay', onDurationOrData);
    // 'canplaythrough' is a reliable second chance on Safari for remote MP4.
    audio.addEventListener('canplaythrough', () => {
      const direct = readElementDuration(audio);
      if (direct > 0) settle(direct);
      else trySeekProbe();
    });
    audio.addEventListener('error', () => settle(0), { once: true });
    audio.load();

    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) onMetadata();
  });
}

/** Resolves playable length for voice messages (incl. WebM without duration metadata). */
export async function resolveAudioDuration(src: string): Promise<number> {
  if (!src) return 0;
  return probeWithAudioElement(src);
}
