import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getOptimizedImageUrl } from '../lib/images';
import {
  CallParticipantVolumeMenu,
  VOLUME_MENU_HEIGHT,
  VOLUME_MENU_WIDTH,
} from './CallParticipantVolumeMenu';
import { useIsMobile } from './ui/use-mobile';

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

const remoteJoinTransition = {
  type: 'spring' as const,
  stiffness: 560,
  damping: 26,
  mass: 0.75,
};

function avatarSrc(participant: CallStageParticipant): string {
  if (participant.avatarUrl) {
    return getOptimizedImageUrl(participant.avatarUrl, 240);
  }
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(participant.name)}&background=3FAF95&color=fff&size=200`;
}

function ParticipantAvatar({
  participant,
  isSpeaking,
  sizeClass,
  isMobile,
  onOpenVolumeMenu,
}: {
  participant: CallStageParticipant;
  isSpeaking: boolean;
  sizeClass: string;
  isMobile: boolean;
  onOpenVolumeMenu?: (event: React.MouseEvent) => void;
}) {
  const interactive = !participant.isLocal && onOpenVolumeMenu;

  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={interactive ? onOpenVolumeMenu : undefined}
      onContextMenu={
        interactive && !isMobile
          ? (event) => {
              event.preventDefault();
              onOpenVolumeMenu?.(event);
            }
          : undefined
      }
      className={`rounded-full transition-all duration-100 ${
        isSpeaking
          ? 'p-0.5 ring-4 ring-[#23a559] shadow-[0_0_20px_rgba(35,165,89,0.55)]'
          : 'p-0.5 ring-2 ring-white/10'
      } ${
        interactive
          ? isMobile
            ? 'cursor-pointer hover:ring-white/30 active:scale-95'
            : 'cursor-context-menu hover:ring-white/25'
          : 'cursor-default'
      }`}
      style={interactive ? { touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' } : undefined}
      aria-label={interactive ? `Volume for ${participant.name}` : participant.name}
    >
      <img
        src={avatarSrc(participant)}
        alt={participant.name}
        className={`rounded-full object-cover ${sizeClass}`}
        draggable={false}
      />
    </button>
  );
}

function ParticipantStageItem({
  participant,
  isSpeaking,
  sizeClass,
  isMobile,
  showName,
  onOpenVolumeMenu,
}: {
  participant: CallStageParticipant;
  isSpeaking: boolean;
  sizeClass: string;
  isMobile: boolean;
  showName: boolean;
  onOpenVolumeMenu: (event: React.MouseEvent) => void;
}) {
  const isRemote = !participant.isLocal;

  return (
    <motion.div
      layout
      initial={isRemote ? { opacity: 0, scale: 0.35, y: 10 } : false}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={isRemote ? { opacity: 0, scale: 0.85, y: 6 } : { opacity: 0, scale: 0.95 }}
      transition={remoteJoinTransition}
      className={`flex flex-col items-center gap-2 ${showName ? '' : 'pointer-events-auto'}`}
    >
      <div className={showName ? 'pointer-events-auto' : undefined}>
        <ParticipantAvatar
          participant={participant}
          isSpeaking={isSpeaking}
          sizeClass={sizeClass}
          isMobile={isMobile}
          onOpenVolumeMenu={onOpenVolumeMenu}
        />
      </div>
      {showName ? (
        <motion.span
          initial={isRemote ? { opacity: 0, y: 4 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...remoteJoinTransition, delay: isRemote ? 0.04 : 0 }}
          className="max-w-[120px] truncate text-center text-sm font-medium text-white/90"
        >
          {participant.name}
        </motion.span>
      ) : null}
    </motion.div>
  );
}

export function CallParticipantStage({
  participants,
  speakingParticipantId,
  participantVolumes,
  onParticipantVolumeChange,
  variant = 'center',
}: CallParticipantStageProps) {
  const isMobile = useIsMobile();
  const [volumeMenu, setVolumeMenu] = useState<VolumeMenuState | null>(null);

  if (participants.length === 0) return null;

  const openVolumeMenu = (participant: CallStageParticipant, event: React.MouseEvent) => {
    if (participant.isLocal) return;
    event.preventDefault();
    event.stopPropagation();

    if (volumeMenu?.participantId === participant.id) {
      setVolumeMenu(null);
      return;
    }

    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();

    let x = event.clientX - VOLUME_MENU_WIDTH / 2;
    let y = event.clientY + 12;

    if (isMobile) {
      x = rect.left + rect.width / 2 - VOLUME_MENU_WIDTH / 2;
      y = rect.bottom + 10;
      if (y + VOLUME_MENU_HEIGHT > window.innerHeight - 8) {
        y = rect.top - VOLUME_MENU_HEIGHT - 10;
      }
    }

    setVolumeMenu({
      participantId: participant.id,
      participantName: participant.name,
      x,
      y,
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
            <AnimatePresence initial={false}>
              {participants.map((participant) => {
                const isSpeaking =
                  speakingParticipantId === participant.id ||
                  (!!participant.jitsiParticipantId &&
                    speakingParticipantId === participant.jitsiParticipantId);
                return (
                  <ParticipantStageItem
                    key={participant.id}
                    participant={participant}
                    isSpeaking={isSpeaking}
                    sizeClass="h-11 w-11 sm:h-12 sm:w-12"
                    isMobile={isMobile}
                    showName={false}
                    onOpenVolumeMenu={(event) => openVolumeMenu(participant, event)}
                  />
                );
              })}
            </AnimatePresence>
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
          <AnimatePresence initial={false}>
            {participants.map((participant) => {
              const isSpeaking =
                speakingParticipantId === participant.id ||
                (!!participant.jitsiParticipantId &&
                  speakingParticipantId === participant.jitsiParticipantId);
              return (
                <ParticipantStageItem
                  key={participant.id}
                  participant={participant}
                  isSpeaking={isSpeaking}
                  sizeClass="h-20 w-20 sm:h-24 sm:w-24"
                  isMobile={isMobile}
                  showName
                  onOpenVolumeMenu={(event) => openVolumeMenu(participant, event)}
                />
              );
            })}
          </AnimatePresence>
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
