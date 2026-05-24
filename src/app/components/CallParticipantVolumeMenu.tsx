import React, { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Volume2, VolumeX } from 'lucide-react';

interface CallParticipantVolumeMenuProps {
  participantName: string;
  volume: number;
  x: number;
  y: number;
  onVolumeChange: (volume: number) => void;
  onClose: () => void;
}

const MENU_WIDTH = 52;
const MENU_HEIGHT = 148;

function clampMenuPosition(x: number, y: number) {
  const maxX = window.innerWidth - MENU_WIDTH - 8;
  const maxY = window.innerHeight - MENU_HEIGHT - 8;
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
        className="fixed inset-0 z-[250] cursor-default bg-transparent"
        aria-label="Close volume menu"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        className="fixed z-[251] flex flex-col items-center gap-2 rounded-lg border border-white/10 bg-[#111214] px-3 py-3 shadow-2xl"
        style={{ left: position.x, top: position.y, width: MENU_WIDTH }}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <span className="max-w-[44px] truncate text-[10px] font-medium text-white/70">
          {participantName}
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          onChange={(event) => onVolumeChange(Number(event.target.value) / 100)}
          className="h-[88px] w-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-[#5865f2] [writing-mode:vertical-lr] [direction:rtl]"
          aria-label={`Volume ${participantName}`}
        />
        {muted ? (
          <VolumeX className="h-4 w-4 text-white/50" />
        ) : (
          <Volume2 className="h-4 w-4 text-white/70" />
        )}
      </div>
    </>,
    document.body
  );
}
