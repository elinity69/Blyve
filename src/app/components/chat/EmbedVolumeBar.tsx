import { Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface EmbedVolumeBarProps {
  volume: number;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  className?: string;
}

export function EmbedVolumeBar({
  volume,
  onVolumeChange,
  onToggleMute,
  className = '',
}: EmbedVolumeBarProps) {
  const { t } = useTranslation();
  const muted = volume <= 0;

  return (
    <div
      className={`flex items-center gap-3 border-t border-white/10 bg-[#181818] px-3 py-2.5 ${className}`}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={onToggleMute}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/90 transition-colors hover:bg-white/15"
        aria-label={muted ? t('chat.embedMediaUnmute') : t('chat.embedMediaMute')}
      >
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        value={volume}
        onChange={(event) => onVolumeChange(Number(event.target.value))}
        className="call-volume-slider h-2 min-w-0 flex-1 cursor-pointer appearance-none rounded-full"
        style={{ ['--volume-percent' as string]: `${volume}%` }}
        aria-label={t('chat.embedMediaVolume')}
      />
      <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-white/75">
        {volume}%
      </span>
    </div>
  );
}
