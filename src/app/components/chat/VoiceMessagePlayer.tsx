import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
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

interface VoiceMessagePlayerProps {
  src: string;
  isMe?: boolean;
}

export function VoiceMessagePlayer({ src, isMe = false }: VoiceMessagePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const bars = useMemo(() => buildWaveformBars(src), [src]);
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  const syncTimes = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
    setDuration(nextDuration);
    setCurrentTime(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('loadedmetadata', syncTimes);
    audio.addEventListener('durationchange', syncTimes);
    audio.addEventListener('timeupdate', syncTimes);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('loadedmetadata', syncTimes);
      audio.removeEventListener('durationchange', syncTimes);
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

  const accent = isMe ? 'bg-white/90' : 'bg-[#5865f2]';
  const accentSoft = isMe ? 'bg-white/35' : 'bg-[#5865f2]/35';
  const textClass = isMe ? 'text-white/85' : 'text-gray-600 dark:text-gray-300';

  return (
    <div
      className="flex min-w-[11.5rem] max-w-[min(100%,15rem)] items-center gap-2 py-0.5"
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
    </div>
  );
}
