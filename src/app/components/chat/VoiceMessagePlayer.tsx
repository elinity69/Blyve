import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function readAudioDuration(audio: HTMLAudioElement): number {
  const value = audio.duration;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function buildWaveformBars(seed: string, count = 28): number[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  return Array.from({ length: count }, (_, index) => {
    const value = Math.abs(Math.sin(hash * 0.017 + index * 0.85)) * 0.65 + 0.22;
    return Math.min(1, value);
  });
}

interface VoiceMessageVolumeHoverProps {
  volume: number;
  isMe: boolean;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
}

function VoiceMessageVolumeHover({
  volume,
  isMe,
  onVolumeChange,
  onToggleMute,
}: VoiceMessageVolumeHoverProps) {
  const { t } = useTranslation();
  const muted = volume <= 0;
  const iconClass = isMe
    ? 'text-white/80 hover:text-white'
    : 'text-[#5865f2] hover:text-[#4752c4] dark:text-[#aeb4ff] dark:hover:text-white';

  return (
    <div
      className="group/volume relative hidden shrink-0 self-center md:flex"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={onToggleMute}
        className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
          isMe ? 'hover:bg-white/15' : 'hover:bg-[#5865f2]/10 dark:hover:bg-white/10'
        } ${iconClass}`}
        aria-label={muted ? t('chat.embedMediaUnmute') : t('chat.embedMediaMute')}
      >
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
      <div
        className="pointer-events-none absolute bottom-full right-0 z-30 flex flex-col items-center rounded-lg border border-black/10 bg-white px-2 py-2 pb-3 opacity-0 shadow-lg transition-opacity duration-150 group-hover/volume:pointer-events-auto group-hover/volume:opacity-100 group-focus-within/volume:pointer-events-auto group-focus-within/volume:opacity-100 dark:border-white/10 dark:bg-[#2b2d31]"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex h-[4.5rem] w-8 items-center justify-center">
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(event) => onVolumeChange(Number(event.target.value))}
            className="call-volume-slider h-2 w-[4.5rem] shrink-0 cursor-pointer appearance-none rounded-full"
            style={{
              transform: 'rotate(-90deg)',
              ['--volume-percent' as string]: `${volume}%`,
            }}
            aria-label={t('chat.embedMediaVolume')}
            aria-orientation="vertical"
          />
        </div>
      </div>
    </div>
  );
}

interface VoiceMessagePlayerProps {
  src: string;
  isMe?: boolean;
}

export function VoiceMessagePlayer({ src, isMe = false }: VoiceMessagePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const volumeBeforeMuteRef = useRef(100);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(100);

  const bars = useMemo(() => buildWaveformBars(src), [src]);
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  const applyVolume = useCallback((percent: number) => {
    const clamped = Math.max(0, Math.min(100, percent));
    setVolume(clamped);
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = clamped / 100;
    audio.muted = clamped === 0;
  }, []);

  const syncTimes = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextDuration = readAudioDuration(audio);
    if (nextDuration > 0) setDuration(nextDuration);
    setCurrentTime(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume / 100;
    audio.muted = volume === 0;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    let cancelled = false;
    let seekProbeActive = false;

    const applyDuration = (value: number) => {
      if (cancelled || value <= 0) return;
      setDuration(value);
    };

    const probeWebmDuration = () => {
      if (seekProbeActive || readAudioDuration(audio) > 0) return;
      seekProbeActive = true;

      const onSeeked = () => {
        audio.removeEventListener('seeked', onSeeked);
        seekProbeActive = false;
        const resolved = readAudioDuration(audio);
        if (resolved > 0) applyDuration(resolved);
        if (!audio.paused) return;
        try {
          audio.currentTime = 0;
        } catch {
          // ignore reset failures
        }
        syncTimes();
      };

      audio.addEventListener('seeked', onSeeked);
      try {
        audio.currentTime = Number.MAX_SAFE_INTEGER;
      } catch {
        audio.removeEventListener('seeked', onSeeked);
        seekProbeActive = false;
      }
    };

    const onMetadata = () => {
      syncTimes();
      if (readAudioDuration(audio) <= 0) probeWebmDuration();
    };

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
    };

    setDuration(0);
    setCurrentTime(0);
    setPlaying(false);

    audio.addEventListener('loadedmetadata', onMetadata);
    audio.addEventListener('durationchange', syncTimes);
    audio.addEventListener('loadeddata', onMetadata);
    audio.addEventListener('canplay', onMetadata);
    audio.addEventListener('timeupdate', syncTimes);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    audio.load();
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) onMetadata();

    return () => {
      cancelled = true;
      audio.removeEventListener('loadedmetadata', onMetadata);
      audio.removeEventListener('durationchange', syncTimes);
      audio.removeEventListener('loadeddata', onMetadata);
      audio.removeEventListener('canplay', onMetadata);
      audio.removeEventListener('timeupdate', syncTimes);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, [src, syncTimes]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  };

  const seekToRatio = (ratio: number) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const next = Math.max(0, Math.min(duration, ratio * duration));
    audio.currentTime = next;
    setCurrentTime(next);
  };

  const toggleMute = () => {
    if (volume <= 0) {
      applyVolume(volumeBeforeMuteRef.current || 100);
      return;
    }
    volumeBeforeMuteRef.current = volume;
    applyVolume(0);
  };

  const accent = isMe ? 'bg-white/90' : 'bg-[#5865f2]';
  const accentSoft = isMe ? 'bg-white/35' : 'bg-[#5865f2]/35';
  const textClass = isMe ? 'text-white/85' : 'text-gray-600 dark:text-gray-300';

  return (
    <div
      className="flex min-w-[11.5rem] max-w-[min(100%,17rem)] items-center gap-1.5 py-0.5"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={togglePlayback}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
          isMe ? 'bg-white/20 text-white' : 'bg-[#5865f2]/15 text-[#5865f2] dark:bg-[#5865f2]/25 dark:text-[#aeb4ff]'
        }`}
        aria-label={playing ? 'Pause' : 'Play'}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <button
          type="button"
          className="relative flex h-7 w-full items-center gap-[2px] px-0.5"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
            seekToRatio(ratio);
          }}
          aria-label="Seek"
        >
          {bars.map((height, index) => {
            const barProgress = (index + 0.5) / bars.length;
            const active = barProgress <= progress;
            return (
              <span
                key={index}
                className={`w-[3px] shrink-0 rounded-full transition-colors ${
                  active ? accent : accentSoft
                }`}
                style={{ height: `${Math.round(height * 20) + 4}px` }}
              />
            );
          })}
        </button>
        <div className={`flex justify-between text-[10px] font-medium tabular-nums leading-none ${textClass}`}>
          <span>{formatAudioTime(currentTime)}</span>
          <span>{formatAudioTime(duration)}</span>
        </div>
      </div>
      <VoiceMessageVolumeHover
        volume={volume}
        isMe={isMe}
        onVolumeChange={applyVolume}
        onToggleMute={toggleMute}
      />
    </div>
  );
}
