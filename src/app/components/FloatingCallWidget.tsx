import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Minimize2, User, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getOptimizedImageUrl } from '../lib/images';
import type { CallMediaType, JitsiHandle } from '../lib/jitsi';
import type { JitsiJoinCredentials } from '../lib/jitsiCall';
import type { CallStageParticipant } from './CallParticipantStage';
import {
  CallParticipantVolumeMenu,
  VOLUME_MENU_HEIGHT,
  VOLUME_MENU_WIDTH,
} from './CallParticipantVolumeMenu';
import type { JitsiCallLayout } from './JitsiCallView';
import { PersistentJitsiMeeting } from './PersistentJitsiMeeting';
import { useIsMobile } from './ui/use-mobile';

const PIP_SIZE = 136;
const PIP_MARGIN = 12;

interface FloatingCallParty {
  id: string;
  name: string;
  avatarUrl?: string;
  jitsiParticipantId?: string;
}

interface FloatingCallActiveCall {
  conversationId?: string | null;
  participants: FloatingCallParty[];
}

interface FloatingCallWidgetProps {
  displayMode: 'pip' | 'fullscreen' | 'embedded';
  hostAnchorEl?: HTMLElement | null;
  callPinned?: boolean;
  activeCall: FloatingCallActiveCall | null;
  localIdentity: string | null;
  sessionId: string;
  inviteToken?: string;
  callType: CallMediaType;
  userId?: string;
  mountKey?: number;
  connectionState: string;
  isMuted: boolean;
  isCameraEnabled: boolean;
  isScreenShareEnabled: boolean;
  remoteVideoActive: boolean;
  remoteScreenShareActive: boolean;
  stageParticipants: CallStageParticipant[];
  speakingParticipantId: string | null;
  participantVolumes: Record<string, number>;
  onParticipantVolumeChange: (participantId: string, volume: number) => void;
  onJoinResolved?: (credentials: JitsiJoinCredentials) => void;
  onJoinError?: (error: unknown) => void;
  onReady?: (handle: JitsiHandle) => void;
  onConnectionEstablished?: () => void;
  onReadyToClose?: () => void;
  onParticipantCountChange?: (count: number) => void;
  onAudioMuteChanged?: (muted: boolean) => void;
  onVideoMuteChanged?: (muted: boolean) => void;
  onScreenShareChanged?: (active: boolean) => void;
  onScreenShareError?: (code: string) => void;
  onDominantSpeakerChanged?: (participantId: string | null) => void;
  onConferenceJoined?: (payload: { id?: string; displayName?: string }) => void;
  onRemoteParticipantJoined?: (payload: { id?: string; displayName?: string }) => void;
  onRemoteMediaChanged?: (state: { remoteVideoActive: boolean; remoteScreenShareActive: boolean }) => void;
  onRemoteMediaSync?: (payload: {
    participantId?: string;
    camera: boolean;
    screenShare: boolean;
  }) => void;
  onRemoteSpeakingChanged?: (payload: {
    participantId?: string;
    speaking: boolean;
    levelDb: number;
  }) => void;
  onHangUp: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onToggleScreenShare: () => void;
  onMinimizeFullscreen: () => void;
  onOpenInChat: () => void;
  onClosePip: () => void;
  onEnterFullscreen: () => void;
  onExpandedChange?: (expanded: boolean) => void;
  onMinimizeToPip?: () => void;
  onTogglePin?: () => void;
}

function clampPosition(x: number, y: number) {
  if (typeof window === 'undefined') return { x, y };
  const maxX = Math.max(PIP_MARGIN, window.innerWidth - PIP_SIZE - PIP_MARGIN);
  const maxY = Math.max(PIP_MARGIN, window.innerHeight - PIP_SIZE - PIP_MARGIN);
  return {
    x: Math.min(Math.max(PIP_MARGIN, x), maxX),
    y: Math.min(Math.max(PIP_MARGIN, y), maxY),
  };
}

function PipAvatar({
  participant,
  isSpeaking,
  sizeClass,
  onOpenVolumeMenu,
}: {
  participant: CallStageParticipant;
  isSpeaking: boolean;
  sizeClass: string;
  onOpenVolumeMenu?: (event: React.MouseEvent) => void;
}) {
  const isMobile = useIsMobile();
  const src = participant.avatarUrl
    ? getOptimizedImageUrl(participant.avatarUrl, 240) || participant.avatarUrl
    : undefined;
  const interactive = !participant.isLocal && onOpenVolumeMenu;

  const avatarBody = src ? (
    <img
      src={src}
      alt={participant.name}
      className={`rounded-full object-cover ${sizeClass}`}
      draggable={false}
    />
  ) : (
    <div
      className={`flex items-center justify-center rounded-full bg-[#2f3136] text-white/70 ${sizeClass}`}
    >
      <User className="h-1/2 w-1/2 min-h-[1rem] min-w-[1rem]" />
    </div>
  );

  if (!interactive) {
    return (
      <div
        className={`rounded-full ${isSpeaking ? 'ring-2 ring-[#23a559]' : 'ring-1 ring-white/15'}`}
      >
        {avatarBody}
      </div>
    );
  }

  return (
    <button
      type="button"
      onContextMenu={
        !isMobile
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenVolumeMenu(event);
            }
          : undefined
      }
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (isMobile) onOpenVolumeMenu(event);
      }}
      className={`rounded-full ${
        isSpeaking ? 'ring-2 ring-[#23a559]' : 'ring-1 ring-white/15'
      } ${isMobile ? 'cursor-pointer' : 'cursor-context-menu'} hover:ring-white/25`}
      aria-label={`Volume for ${participant.name}`}
    >
      {avatarBody}
    </button>
  );
}

export function FloatingCallWidget({
  displayMode,
  hostAnchorEl = null,
  callPinned = false,
  activeCall,
  localIdentity,
  sessionId,
  inviteToken,
  callType,
  userId,
  mountKey = 0,
  connectionState,
  isMuted,
  isCameraEnabled,
  isScreenShareEnabled,
  remoteVideoActive,
  remoteScreenShareActive,
  stageParticipants,
  speakingParticipantId,
  participantVolumes,
  onParticipantVolumeChange,
  onJoinResolved,
  onJoinError,
  onReady,
  onConnectionEstablished,
  onReadyToClose,
  onParticipantCountChange,
  onAudioMuteChanged,
  onVideoMuteChanged,
  onScreenShareChanged,
  onScreenShareError,
  onDominantSpeakerChanged,
  onConferenceJoined,
  onRemoteParticipantJoined,
  onRemoteMediaChanged,
  onRemoteMediaSync,
  onRemoteSpeakingChanged,
  onHangUp,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare,
  onMinimizeFullscreen,
  onOpenInChat,
  onClosePip,
  onEnterFullscreen,
  onExpandedChange,
  onMinimizeToPip,
  onTogglePin,
}: FloatingCallWidgetProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [pipHovered, setPipHovered] = useState(false);
  const [volumeMenu, setVolumeMenu] = useState<{
    participantId: string;
    participantName: string;
    x: number;
    y: number;
  } | null>(null);
  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined') return { x: PIP_MARGIN, y: PIP_MARGIN };
    return clampPosition(
      window.innerWidth - PIP_SIZE - PIP_MARGIN,
      window.innerHeight - PIP_SIZE - 88
    );
  });
  const [remoteStreamActive, setRemoteStreamActive] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
    pointerId: number | null;
  } | null>(null);
  const pipContentRef = useRef<HTMLDivElement | null>(null);
  const jitsiSurfaceRef = useRef<HTMLDivElement | null>(null);
  const hasStreamRef = useRef(false);
  const lastPipOpenTapAtRef = useRef(0);
  const onEnterFullscreenRef = useRef(onEnterFullscreen);
  const onOpenInChatRef = useRef(onOpenInChat);
  const onClosePipRef = useRef(onClosePip);

  onEnterFullscreenRef.current = onEnterFullscreen;
  onOpenInChatRef.current = onOpenInChat;
  onClosePipRef.current = onClosePip;

  const openCallWindowFromPip = useCallback(() => {
    onOpenInChatRef.current();
  }, []);

  const displayParticipants = stageParticipants;

  const hasStream =
    isCameraEnabled ||
    isScreenShareEnabled ||
    remoteVideoActive ||
    remoteScreenShareActive ||
    remoteStreamActive;

  hasStreamRef.current = hasStream;

  const isEmbedded = displayMode === 'embedded';
  const isFullscreen = displayMode === 'fullscreen';
  const showPipChrome = !isEmbedded;
  const layout: JitsiCallLayout = isEmbedded ? 'embedded' : isFullscreen ? 'standalone' : 'pip';

  const syncJitsiSurfaceBounds = useCallback(() => {
    const surface = jitsiSurfaceRef.current;
    if (!surface) return;

    const target =
      isEmbedded && hostAnchorEl ? hostAnchorEl : showPipChrome ? pipContentRef.current : null;

    if (!target) {
      surface.style.visibility = 'hidden';
      return;
    }

    const rect = target.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      surface.style.visibility = 'hidden';
      return;
    }

    surface.style.visibility = 'visible';
    surface.style.left = `${rect.left}px`;
    surface.style.top = `${rect.top}px`;
    surface.style.width = `${rect.width}px`;
    surface.style.height = `${rect.height}px`;
    surface.style.zIndex = isEmbedded ? '120' : isFullscreen ? '9998' : '134';
    surface.style.pointerEvents =
      showPipChrome && !isFullscreen ? 'none' : 'auto';
  }, [hostAnchorEl, isEmbedded, isFullscreen, showPipChrome]);

  useLayoutEffect(() => {
    syncJitsiSurfaceBounds();

    const target =
      isEmbedded && hostAnchorEl ? hostAnchorEl : showPipChrome ? pipContentRef.current : null;
    if (!target) return undefined;

    const resizeObserver = new ResizeObserver(() => syncJitsiSurfaceBounds());
    resizeObserver.observe(target);

    window.addEventListener('scroll', syncJitsiSurfaceBounds, true);
    window.addEventListener('resize', syncJitsiSurfaceBounds);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('scroll', syncJitsiSurfaceBounds, true);
      window.removeEventListener('resize', syncJitsiSurfaceBounds);
    };
  }, [hostAnchorEl, isEmbedded, position, showPipChrome, syncJitsiSurfaceBounds]);

  useLayoutEffect(() => {
    syncJitsiSurfaceBounds();
  }, [position, syncJitsiSurfaceBounds]);

  const showVideoSurface =
    isCameraEnabled ||
    isScreenShareEnabled ||
    remoteVideoActive ||
    remoteScreenShareActive ||
    remoteStreamActive;
  const showAvatarStage = connectionState === 'connected' && !showVideoSurface;
  const showStreamAvatars = connectionState === 'connected' && showVideoSurface;

  const handleRemoteMediaChanged = useCallback(
    (state: { remoteVideoActive: boolean; remoteScreenShareActive: boolean }) => {
      if (state.remoteVideoActive || state.remoteScreenShareActive) {
        setRemoteStreamActive(true);
      }
      onRemoteMediaChanged?.(state);
    },
    [onRemoteMediaChanged]
  );

  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => clampPosition(prev.x, prev.y));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const registerPipOpenTap = useCallback(
    (event: React.MouseEvent | React.PointerEvent) => {
      if ((event.target as HTMLElement).closest('button, [data-call-controls], [data-pip-avatar]')) {
        return;
      }
      const now = Date.now();
      if (now - lastPipOpenTapAtRef.current < 360) {
        lastPipOpenTapAtRef.current = 0;
        event.preventDefault();
        event.stopPropagation();
        openCallWindowFromPip();
        return;
      }
      lastPipOpenTapAtRef.current = now;
    },
    [openCallWindowFromPip]
  );

  const openPipVolumeMenu = useCallback(
    (participant: CallStageParticipant, event: React.MouseEvent) => {
      if (participant.isLocal) return;
      event.preventDefault();
      event.stopPropagation();

      if (volumeMenu?.participantId === participant.id) {
        setVolumeMenu(null);
        return;
      }

      let x = event.clientX - VOLUME_MENU_WIDTH / 2;
      let y = event.clientY + 12;
      if (isMobile) {
        const target = event.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
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
    },
    [isMobile, volumeMenu?.participantId]
  );

  const handleDragPointerDown = (event: React.PointerEvent) => {
    if (isFullscreen) return;
    if ((event.target as HTMLElement).closest('button, [data-call-controls], [data-pip-avatar]')) {
      return;
    }
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      moved: false,
      pointerId: event.pointerId,
    };
  };

  const handleDragPointerMove = (event: React.PointerEvent) => {
    if (!dragRef.current || isFullscreen) return;
    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;
    if (!dragRef.current.moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      dragRef.current.moved = true;
      const handle = event.currentTarget as HTMLElement;
      if (dragRef.current.pointerId != null) {
        try {
          handle.setPointerCapture(dragRef.current.pointerId);
        } catch {
          // best effort
        }
      }
    }
    if (!dragRef.current.moved) return;
    setPosition(clampPosition(dragRef.current.originX + dx, dragRef.current.originY + dy));
  };

  const handleDragPointerUp = (event: React.PointerEvent) => {
    if (!dragRef.current) return;
    const wasDrag = dragRef.current.moved;
    dragRef.current = null;
    if (wasDrag) {
      event.stopPropagation();
      return;
    }
    registerPipOpenTap(event);
  };

  const handlePipDoubleClick = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest('button, [data-call-controls], [data-pip-avatar]')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    lastPipOpenTapAtRef.current = 0;
    onEnterFullscreenRef.current();
  };

  const avatarOverlay =
    !hasStream && displayParticipants.length > 0 ? (
      <div className="pointer-events-none absolute inset-0 z-[25] flex items-center justify-center gap-1.5 bg-[#0b0b0b] p-2">
        <div className="flex items-center justify-center gap-1.5">
          {displayParticipants.slice(0, 2).map((participant) => {
            const isSpeaking =
              speakingParticipantId === participant.id ||
              speakingParticipantId === participant.jitsiParticipantId;
            const solo = displayParticipants.length === 1;
            return (
              <div key={participant.id} data-pip-avatar>
                <PipAvatar
                  participant={participant}
                  isSpeaking={Boolean(isSpeaking)}
                  sizeClass={
                    isFullscreen
                      ? 'h-20 w-20 sm:h-24 sm:w-24'
                      : solo
                        ? 'h-16 w-16'
                        : 'h-9 w-9'
                  }
                  onOpenVolumeMenu={
                    participant.isLocal
                      ? undefined
                      : (event) => openPipVolumeMenu(participant, event)
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
    ) : null;

  const jitsiMeetingProps = {
    sessionId,
    inviteToken,
    callType,
    userId,
    mountKey,
    layout,
    mediaActive: isEmbedded ? showVideoSurface : hasStream,
    streamMode: isEmbedded ? showStreamAvatars : undefined,
    hideJitsiVideo: isEmbedded ? showAvatarStage : undefined,
    connectionState,
    isMuted,
    isCameraEnabled,
    isScreenShareEnabled,
    overlay: null,
    onRemoteStreamActiveChange: setRemoteStreamActive,
    onExpandedChange: isEmbedded ? onExpandedChange : undefined,
    onMinimizeToPip: isEmbedded ? onMinimizeToPip : undefined,
    onTogglePin: isEmbedded ? onTogglePin : undefined,
    callPinned: isEmbedded ? callPinned : undefined,
    onJoinResolved,
    onJoinError,
    onReady,
    onConnectionEstablished,
    onReadyToClose,
    onParticipantCountChange,
    onAudioMuteChanged,
    onVideoMuteChanged,
    onScreenShareChanged,
    onScreenShareError,
    onDominantSpeakerChanged,
    onConferenceJoined,
    onRemoteParticipantJoined,
    onRemoteMediaChanged: handleRemoteMediaChanged,
    onRemoteMediaSync,
    onRemoteSpeakingChanged,
    onHangUp,
    onToggleMute,
    onToggleCamera,
    onToggleScreenShare,
    compactControls: !isEmbedded,
    forceShowControls: !isEmbedded && (pipHovered || isMobile),
  };

  return (
    <>
      <div
        ref={jitsiSurfaceRef}
        className={`fixed overflow-hidden bg-[#0b0b0b] ${
          showPipChrome && !isFullscreen ? 'rounded-xl' : ''
        }`}
        style={{ visibility: 'hidden', left: 0, top: 0, width: 0, height: 0 }}
      >
        <PersistentJitsiMeeting {...jitsiMeetingProps} />
      </div>
      {showPipChrome ? (
        <div
          className={isFullscreen ? 'fixed inset-0 z-[9999] select-none' : 'group/pip fixed z-[135] select-none'}
          style={
            isFullscreen
              ? undefined
              : { left: position.x, top: position.y, width: PIP_SIZE, height: PIP_SIZE }
          }
          onMouseEnter={!isFullscreen ? () => setPipHovered(true) : undefined}
          onMouseLeave={!isFullscreen ? () => setPipHovered(false) : undefined}
        >
          <div
            ref={pipContentRef}
            className={
              isFullscreen
                ? 'relative h-full w-full'
                : 'relative h-full w-full overflow-hidden rounded-xl border border-white/15 bg-transparent shadow-2xl'
            }
          />
          {avatarOverlay}
          {!isFullscreen ? (
            <div
              data-pip-drag-handle
              className="absolute inset-0 z-[35] cursor-grab touch-manipulation active:cursor-grabbing"
              onPointerDown={handleDragPointerDown}
              onPointerMove={handleDragPointerMove}
              onPointerUp={handleDragPointerUp}
              onPointerCancel={handleDragPointerUp}
              onDoubleClick={handlePipDoubleClick}
            />
          ) : null}
          {!isFullscreen ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onClosePip();
              }}
              className="absolute right-1 top-1 z-[40] flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-black/70 text-white shadow-lg transition-colors hover:bg-black/90"
              aria-label={t('groups.modalClose', { defaultValue: 'Close' })}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
          {isFullscreen ? (
            <button
              type="button"
              onClick={onMinimizeFullscreen}
              className="fixed right-4 top-4 z-[10000] flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#1e1f22]/95 text-white shadow-lg transition-colors hover:bg-[#2f3136]"
              aria-label={t('call.minimizeVideo')}
            >
              <Minimize2 className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      ) : null}
      {volumeMenu ? (
        <CallParticipantVolumeMenu
          participantName={volumeMenu.participantName}
          volume={participantVolumes[volumeMenu.participantId] ?? 1}
          x={volumeMenu.x}
          y={volumeMenu.y}
          onVolumeChange={(volume) =>
            onParticipantVolumeChange(volumeMenu.participantId, volume)
          }
          onClose={() => setVolumeMenu(null)}
        />
      ) : null}
    </>
  );
}
