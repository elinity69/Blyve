import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GripHorizontal, Minimize2, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../context/AppDataContext';
import { useCall } from '../context/CallContext';
import { getOptimizedImageUrl } from '../lib/images';
import type { CallMediaType, JitsiHandle } from '../lib/jitsi';
import type { JitsiJoinCredentials } from '../lib/jitsiCall';
import type { CallStageParticipant } from './CallParticipantStage';
import { JitsiCallView, type JitsiCallLayout } from './JitsiCallView';

const PIP_WIDTH = 280;
const PIP_HEIGHT = 168;
const PIP_MARGIN = 16;

interface FloatingCallWidgetProps {
  displayMode: 'pip' | 'fullscreen';
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
  onEnterFullscreen: () => void;
}

function clampPosition(x: number, y: number) {
  if (typeof window === 'undefined') return { x, y };
  const maxX = Math.max(PIP_MARGIN, window.innerWidth - PIP_WIDTH - PIP_MARGIN);
  const maxY = Math.max(PIP_MARGIN, window.innerHeight - PIP_HEIGHT - PIP_MARGIN);
  return {
    x: Math.min(Math.max(PIP_MARGIN, x), maxX),
    y: Math.min(Math.max(PIP_MARGIN, y), maxY),
  };
}

function resolveProfileImage(
  images?: string[] | null,
  avatarUrl?: string | null,
  width = 240
): string | undefined {
  const raw = images?.[0] || avatarUrl;
  if (!raw) return undefined;
  const optimized = getOptimizedImageUrl(raw, width);
  return optimized || raw;
}

function PipAvatar({
  participant,
  isSpeaking,
  sizeClass,
}: {
  participant: CallStageParticipant;
  isSpeaking: boolean;
  sizeClass: string;
}) {
  const src = participant.avatarUrl
    ? getOptimizedImageUrl(participant.avatarUrl, 240) || participant.avatarUrl
    : undefined;

  return (
    <div
      className={`rounded-full ${isSpeaking ? 'ring-2 ring-[#23a559]' : 'ring-1 ring-white/15'}`}
    >
      {src ? (
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
      )}
    </div>
  );
}

export function FloatingCallWidget({
  displayMode,
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
  stageParticipants: _stageParticipants,
  speakingParticipantId,
  participantVolumes: _participantVolumes,
  onParticipantVolumeChange: _onParticipantVolumeChange,
  onJoinResolved,
  onJoinError,
  onReady,
  onConnectionEstablished,
  onReadyToClose,
  onParticipantCountChange,
  onAudioMuteChanged,
  onVideoMuteChanged,
  onScreenShareChanged,
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
  onEnterFullscreen,
}: FloatingCallWidgetProps) {
  const { t } = useTranslation();
  const { currentUserProfile, conversations } = useAppData();
  const { activeCall, localIdentity } = useCall();
  const [position, setPosition] = useState(() => {
    if (typeof window === 'undefined') return { x: PIP_MARGIN, y: PIP_MARGIN };
    return clampPosition(
      window.innerWidth - PIP_WIDTH - PIP_MARGIN,
      window.innerHeight - PIP_HEIGHT - 80
    );
  });
  const [controlsVisible, setControlsVisible] = useState(false);
  const [remoteStreamActive, setRemoteStreamActive] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const controlsTimeoutRef = useRef<number | null>(null);
  const pipContentRef = useRef<HTMLDivElement>(null);
  const hasStreamRef = useRef(false);
  const onEnterFullscreenRef = useRef(onEnterFullscreen);
  const onOpenInChatRef = useRef(onOpenInChat);

  onEnterFullscreenRef.current = onEnterFullscreen;
  onOpenInChatRef.current = onOpenInChat;

  const displayParticipants = useMemo((): CallStageParticipant[] => {
    const conversation = conversations.find((entry) => entry.id === activeCall?.conversationId);
    const peer = conversation?.other_user;
    const peerAvatar = peer?.imageUrl
      ? getOptimizedImageUrl(peer.imageUrl, 240) || peer.imageUrl
      : undefined;

    const localName =
      localIdentity ||
      currentUserProfile?.display_name ||
      currentUserProfile?.name ||
      t('call.you', { defaultValue: 'Du' });
    const localAvatar = resolveProfileImage(
      currentUserProfile?.images,
      currentUserProfile?.avatar_url
    );

    const participants: CallStageParticipant[] = [
      {
        id: '__local__',
        name: localName,
        avatarUrl: localAvatar,
        isLocal: true,
      },
    ];

    const remotes = [...(activeCall?.participants ?? [])];
    if (
      peer &&
      !remotes.some(
        (participant) =>
          participant.id === peer.id ||
          participant.name === (peer.display_name || peer.name)
      )
    ) {
      remotes.push({
        id: peer.id,
        name: peer.display_name || peer.name,
        avatarUrl: peerAvatar,
      });
    }

    for (const participant of remotes) {
      const resolvedAvatar =
        participant.avatarUrl ||
        (peer && participant.id === peer.id ? peerAvatar : undefined) ||
        (peer && participant.name === (peer.display_name || peer.name) ? peerAvatar : undefined);

      participants.push({
        id: participant.id,
        name: participant.name,
        avatarUrl: resolvedAvatar,
        jitsiParticipantId: participant.jitsiParticipantId,
      });
    }

    return participants;
  }, [activeCall?.conversationId, activeCall?.participants, conversations, currentUserProfile, localIdentity, t]);

  const hasStream =
    isCameraEnabled ||
    isScreenShareEnabled ||
    remoteVideoActive ||
    remoteScreenShareActive ||
    remoteStreamActive;

  hasStreamRef.current = hasStream;

  const isFullscreen = displayMode === 'fullscreen';
  const layout: JitsiCallLayout = isFullscreen ? 'standalone' : 'pip';

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

  const showControlsBriefly = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) window.clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = window.setTimeout(() => {
      setControlsVisible(false);
    }, 3500);
  }, []);

  useEffect(() => {
    return () => {
      if (controlsTimeoutRef.current) window.clearTimeout(controlsTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const element = pipContentRef.current;
    if (!element || isFullscreen) return;

    const handleDoubleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('button, [data-call-controls]')) return;
      event.preventDefault();
      event.stopPropagation();
      if (hasStreamRef.current) {
        onEnterFullscreenRef.current();
      } else {
        onOpenInChatRef.current();
      }
    };

    element.addEventListener('dblclick', handleDoubleClick, true);

    let lastTap = 0;
    const handleTouchEnd = (event: TouchEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('button, [data-call-controls]')) return;
      const now = Date.now();
      if (now - lastTap < 400) {
        lastTap = 0;
        event.preventDefault();
        if (hasStreamRef.current) {
          onEnterFullscreenRef.current();
        } else {
          onOpenInChatRef.current();
        }
        return;
      }
      lastTap = now;
    };

    element.addEventListener('touchend', handleTouchEnd, { capture: true });
    return () => {
      element.removeEventListener('dblclick', handleDoubleClick, true);
      element.removeEventListener('touchend', handleTouchEnd, { capture: true });
    };
  }, [isFullscreen]);

  const handleDoubleActivate = useCallback(
    (event: React.MouseEvent) => {
      if ((event.target as HTMLElement).closest('button')) return;
      event.preventDefault();
      event.stopPropagation();
      if (hasStream) {
        onEnterFullscreen();
      } else {
        onOpenInChat();
      }
    },
    [hasStream, onEnterFullscreen, onOpenInChat]
  );

  const handleHeaderPointerDown = (event: React.PointerEvent) => {
    if (isFullscreen) return;
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      moved: false,
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const handleHeaderPointerMove = (event: React.PointerEvent) => {
    if (!dragRef.current || isFullscreen) return;
    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      dragRef.current.moved = true;
    }
    setPosition(clampPosition(dragRef.current.originX + dx, dragRef.current.originY + dy));
  };

  const handleHeaderPointerUp = (event: React.PointerEvent) => {
    if (!dragRef.current) return;
    const wasTap = !dragRef.current.moved;
    dragRef.current = null;
    if (wasTap) {
      showControlsBriefly();
    }
    event.stopPropagation();
  };

  const avatarOverlay =
    !hasStream && displayParticipants.length > 0 ? (
      <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center gap-2 bg-[#0b0b0b] px-2">
        {displayParticipants.slice(0, 2).map((participant) => {
          const isSpeaking =
            speakingParticipantId === participant.id ||
            speakingParticipantId === participant.jitsiParticipantId;
          return (
            <PipAvatar
              key={participant.id}
              participant={participant}
              isSpeaking={Boolean(isSpeaking)}
              sizeClass={isFullscreen ? 'h-20 w-20 sm:h-24 sm:w-24' : 'h-12 w-12'}
            />
          );
        })}
      </div>
    ) : null;

  const jitsiView = (
    <JitsiCallView
      key={`${sessionId}:${mountKey}`}
      sessionId={sessionId}
      inviteToken={inviteToken}
      callType={callType}
      userId={userId}
      mountKey={mountKey}
      layout={layout}
      mediaActive={hasStream}
      connectionState={connectionState}
      isMuted={isMuted}
      isCameraEnabled={isCameraEnabled}
      isScreenShareEnabled={isScreenShareEnabled}
      overlay={avatarOverlay}
      forceShowControls={!isFullscreen && controlsVisible}
      compactControls={!isFullscreen}
      onExpandRequest={!isFullscreen && hasStream ? onEnterFullscreen : undefined}
      onRemoteStreamActiveChange={setRemoteStreamActive}
      onJoinResolved={onJoinResolved}
      onJoinError={onJoinError}
      onReady={onReady}
      onConnectionEstablished={onConnectionEstablished}
      onReadyToClose={onReadyToClose}
      onParticipantCountChange={onParticipantCountChange}
      onAudioMuteChanged={onAudioMuteChanged}
      onVideoMuteChanged={onVideoMuteChanged}
      onScreenShareChanged={onScreenShareChanged}
      onDominantSpeakerChanged={onDominantSpeakerChanged}
      onConferenceJoined={onConferenceJoined}
      onRemoteParticipantJoined={onRemoteParticipantJoined}
      onRemoteMediaChanged={handleRemoteMediaChanged}
      onRemoteMediaSync={onRemoteMediaSync}
      onRemoteSpeakingChanged={onRemoteSpeakingChanged}
      onHangUp={onHangUp}
      onToggleMute={onToggleMute}
      onToggleCamera={onToggleCamera}
      onToggleScreenShare={onToggleScreenShare}
    />
  );

  return (
    <div
      className={isFullscreen ? 'fixed inset-0 z-[9998]' : 'fixed z-[135] select-none'}
      style={
        isFullscreen
          ? undefined
          : { left: position.x, top: position.y, width: PIP_WIDTH, height: PIP_HEIGHT }
      }
    >
      <div
        className={
          isFullscreen
            ? 'h-full w-full'
            : 'flex h-full flex-col overflow-hidden rounded-xl border border-white/15 bg-[#18191c] shadow-2xl'
        }
      >
        {!isFullscreen ? (
          <div
            data-pip-drag-handle
            className="flex shrink-0 cursor-grab touch-none items-center justify-between bg-[#1e1f22] px-2 py-1 active:cursor-grabbing"
            onPointerDown={handleHeaderPointerDown}
            onPointerMove={handleHeaderPointerMove}
            onPointerUp={handleHeaderPointerUp}
            onPointerCancel={handleHeaderPointerUp}
            onDoubleClick={handleDoubleActivate}
          >
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-white/60">
              <GripHorizontal className="h-3.5 w-3.5" />
              {t('call.inCall')}
            </div>
            <span className="text-[10px] text-white/45">{t('call.pipHint')}</span>
          </div>
        ) : null}
        <div
          ref={pipContentRef}
          className={isFullscreen ? 'relative h-full w-full' : 'relative min-h-0 flex-1'}
          onClick={
            isFullscreen
              ? undefined
              : (event) => {
                  if (event.detail >= 2) return;
                  if ((event.target as HTMLElement).closest('button, [data-call-controls]')) return;
                  showControlsBriefly();
                }
          }
        >
          {jitsiView}
        </div>
      </div>
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
  );
}
