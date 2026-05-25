import React, { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Volume2, VolumeX } from 'lucide-react';

export const VOLUME_MENU_WIDTH = 252;
export const VOLUME_MENU_HEIGHT = 76;

interface CallParticipantVolumeMenuProps {
  participantName: string;
  volume: number;
  x: number;
  y: number;
  onVolumeChange: (volume: number) => void;
  onClose: () => void;
}

function clampMenuPosition(x: number, y: number) {
  const maxX = window.innerWidth - VOLUME_MENU_WIDTH - 8;
  const maxY = window.innerHeight - VOLUME_MENU_HEIGHT - 8;
  return {
    x: Math.max(8, Math.min(x, maxX)),
    y: Math.max(8, Math.min(y, maxY)),
  };
}

export function CallParticipantVolumeMenu({
  participantName,
  volume,
  x,
  y,
  onVolumeChange,
  onClose,
}: CallParticipantVolumeMenuProps) {
  const position = useMemo(() => clampMenuPosition(x, y), [x, y]);
  const muted = volume <= 0;
  const volumePercent = Math.round(volume * 100);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-[250] cursor-default bg-black/20"
        aria-label="Close volume menu"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        className="fixed z-[251] flex flex-col gap-2.5 rounded-xl border border-white/25 bg-[#404249] px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.55)] ring-1 ring-white/10"
        style={{ left: position.x, top: position.y, width: VOLUME_MENU_WIDTH }}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <span className="truncate text-xs font-semibold text-white/95">{participantName}</span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onVolumeChange(muted ? 1 : 0)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/90 hover:bg-white/15"
            aria-label={muted ? 'Unmute participant' : 'Mute participant'}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={volumePercent}
            onChange={(event) => onVolumeChange(Number(event.target.value) / 100)}
            className="call-volume-slider h-2 min-w-0 flex-1 cursor-pointer appearance-none rounded-full"
            style={{ ['--volume-percent' as string]: `${volumePercent}%` }}
            aria-label={`Volume ${participantName}`}
          />
          <span className="w-9 shrink-0 text-right text-xs font-medium tabular-nums text-white/80">
            {volumePercent}%
          </span>
        </div>
      </div>
    </>,
    document.body
  );
}
