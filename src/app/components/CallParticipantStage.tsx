import React, { useState } from 'react';
import { getOptimizedImageUrl } from '../lib/images';
import { CallParticipantVolumeMenu } from './CallParticipantVolumeMenu';

export interface CallStageParticipant {
  id: string;
  name: string;
  avatarUrl?: string;
  jitsiParticipantId?: string;
  isLocal?: boolean;
}

interface CallParticipantStageProps {
  participants: CallStageParticipant[];
  speakingParticipantId: string | null;
  participantVolumes: Record<string, number>;
  onParticipantVolumeChange: (participantId: string, volume: number) => void;
  variant?: 'center' | 'stream';
}

interface VolumeMenuState {
  participantId: string;
  participantName: string;
  x: number;
  y: number;
}

function avatarSrc(participant: CallStageParticipant): string {
  if (participant.avatarUrl) {
    return getOptimizedImageUrl(participant.avatarUrl, 240);
  }
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(participant.name)}&background=5865f2&color=fff&size=200`;
}

function ParticipantAvatar({
  participant,
  isSpeaking,
  sizeClass,
  onContextMenu,
}: {
  participant: CallStageParticipant;
  isSpeaking: boolean;
  sizeClass: string;
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  return (
    <div
      onContextMenu={onContextMenu}
      className={`rounded-full transition-all duration-100 ${
        isSpeaking
          ? 'p-0.5 ring-4 ring-[#23a559] shadow-[0_0_20px_rgba(35,165,89,0.55)]'
          : 'p-0.5 ring-2 ring-white/10'
      } ${participant.isLocal ? '' : 'cursor-context-menu hover:ring-white/25'}`}
    >
      <img
        src={avatarSrc(participant)}
        alt={participant.name}
        className={`rounded-full object-cover ${sizeClass}`}
        draggable={false}
      />
    </div>
  );
}

export function CallParticipantStage({
  participants,
  speakingParticipantId,
  participantVolumes,
  onParticipantVolumeChange,
  variant = 'center',
}: CallParticipantStageProps) {
  const [volumeMenu, setVolumeMenu] = useState<VolumeMenuState | null>(null);

  if (participants.length === 0) return null;

  const openVolumeMenu = (participant: CallStageParticipant, event: React.MouseEvent) => {
    if (participant.isLocal) return;
    event.preventDefault();
    event.stopPropagation();
    setVolumeMenu({
      participantId: participant.id,
      participantName: participant.name,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const activeVolumeMenuParticipant = volumeMenu
    ? participants.find((participant) => participant.id === volumeMenu.participantId)
    : null;

  if (variant === 'stream') {
    return (
      <>
        <div className="pointer-events-none absolute inset-0 z-[6]">
          <div className="pointer-events-none absolute bottom-[5.5rem] left-5 flex items-center gap-2">
            {participants.map((participant) => {
              const isSpeaking =
                speakingParticipantId === participant.id ||
                (!!participant.jitsiParticipantId &&
                  speakingParticipantId === participant.jitsiParticipantId);
              return (
                <div key={participant.id} className="pointer-events-auto">
                  <ParticipantAvatar
                    participant={participant}
                    isSpeaking={isSpeaking}
                    sizeClass="h-11 w-11 sm:h-12 sm:w-12"
                    onContextMenu={(event) => openVolumeMenu(participant, event)}
                  />
                </div>
              );
            })}
          </div>
        </div>
        {volumeMenu && activeVolumeMenuParticipant ? (
          <CallParticipantVolumeMenu
            participantName={volumeMenu.participantName}
            volume={participantVolumes[volumeMenu.participantId] ?? 1}
            x={volumeMenu.x}
            y={volumeMenu.y}
            onVolumeChange={(volume) => onParticipantVolumeChange(volumeMenu.participantId, volume)}
            onClose={() => setVolumeMenu(null)}
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <div className="pointer-events-none absolute inset-0 z-[6] flex items-center justify-center bg-[#0b0b0b] px-4">
        <div className="flex flex-wrap items-start justify-center gap-8">
          {participants.map((participant) => {
            const isSpeaking =
              speakingParticipantId === participant.id ||
              (!!participant.jitsiParticipantId &&
                speakingParticipantId === participant.jitsiParticipantId);
            return (
              <div key={participant.id} className="flex flex-col items-center gap-2">
                <div className="pointer-events-auto">
                  <ParticipantAvatar
                    participant={participant}
                    isSpeaking={isSpeaking}
                    sizeClass="h-20 w-20 sm:h-24 sm:w-24"
                    onContextMenu={(event) => openVolumeMenu(participant, event)}
                  />
                </div>
                <span className="max-w-[120px] truncate text-center text-sm font-medium text-white/90">
                  {participant.name}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {volumeMenu && activeVolumeMenuParticipant ? (
        <CallParticipantVolumeMenu
          participantName={volumeMenu.participantName}
          volume={participantVolumes[volumeMenu.participantId] ?? 1}
          x={volumeMenu.x}
          y={volumeMenu.y}
          onVolumeChange={(volume) => onParticipantVolumeChange(volumeMenu.participantId, volume)}
          onClose={() => setVolumeMenu(null)}
        />
      ) : null}
    </>
  );
}
