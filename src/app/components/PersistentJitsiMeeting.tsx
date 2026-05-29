import React, { useLayoutEffect, useRef } from 'react';
import { JitsiCallView, type JitsiCallLayout } from './JitsiCallView';
import type { CallMediaType, JitsiHandle } from '../lib/jitsi';
import type { JitsiJoinCredentials } from '../lib/jitsiCall';

interface PersistentJitsiMeetingProps {
  visualSlotEl: HTMLElement | null;
  sessionId: string;
  inviteToken?: string;
  callType: CallMediaType;
  userId?: string;
  mountKey?: number;
  layout: JitsiCallLayout;
  mediaActive?: boolean;
  streamMode?: boolean;
  hideJitsiVideo?: boolean;
  connectionState?: string;
  isMuted?: boolean;
  isCameraEnabled?: boolean;
  isScreenShareEnabled?: boolean;
  overlay?: React.ReactNode;
  callPinned?: boolean;
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
  onRemoteStreamActiveChange?: (active: boolean) => void;
  onExpandedChange?: (expanded: boolean) => void;
  onMinimizeToPip?: () => void;
  onTogglePin?: () => void;
  onHangUp?: () => void;
  onToggleMute?: () => void;
  onToggleCamera?: () => void;
  onToggleScreenShare?: () => void;
  compactControls?: boolean;
  forceShowControls?: boolean;
}

/**
 * Keeps a single Jitsi iframe mounted while reparenting its DOM host between PiP / embedded / fullscreen slots.
 */
export function PersistentJitsiMeeting({
  visualSlotEl,
  sessionId,
  inviteToken,
  callType,
  userId,
  mountKey = 0,
  layout,
  mediaActive,
  streamMode,
  hideJitsiVideo,
  connectionState,
  isMuted,
  isCameraEnabled,
  isScreenShareEnabled,
  overlay,
  callPinned,
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
  onRemoteStreamActiveChange,
  onExpandedChange,
  onMinimizeToPip,
  onTogglePin,
  onHangUp,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare,
  compactControls,
  forceShowControls,
}: PersistentJitsiMeetingProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const fallbackSlotRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const fallback = fallbackSlotRef.current;
    if (!host || !fallback) return;

    const target = visualSlotEl ?? fallback;

    if (host.parentElement !== target) {
      target.appendChild(host);
    }

    return () => {
      // Reparent back into React's tree before unmount — appendChild to chat anchors
      // moves nodes outside the fiber parent and causes removeChild NotFoundError.
      if (host.parentElement !== fallback) {
        fallback.appendChild(host);
      }
    };
  }, [visualSlotEl, layout, sessionId, mountKey]);

  return (
    <>
      <div
        ref={fallbackSlotRef}
        aria-hidden
        className="pointer-events-none fixed -left-[9999px] top-0 h-px w-px overflow-hidden opacity-0"
      />
      <div ref={hostRef} className="h-full w-full min-h-0 min-w-0">
        <JitsiCallView
          sessionId={sessionId}
          inviteToken={inviteToken}
          callType={callType}
          userId={userId}
          mountKey={mountKey}
          layout={layout}
          mediaActive={mediaActive}
          streamMode={streamMode}
          hideJitsiVideo={hideJitsiVideo}
          connectionState={connectionState}
          isMuted={isMuted}
          isCameraEnabled={isCameraEnabled}
          isScreenShareEnabled={isScreenShareEnabled}
          overlay={overlay}
          callPinned={callPinned}
          onJoinResolved={onJoinResolved}
          onJoinError={onJoinError}
          onReady={onReady}
          onConnectionEstablished={onConnectionEstablished}
          onReadyToClose={onReadyToClose}
          onParticipantCountChange={onParticipantCountChange}
          onAudioMuteChanged={onAudioMuteChanged}
          onVideoMuteChanged={onVideoMuteChanged}
          onScreenShareChanged={onScreenShareChanged}
          onScreenShareError={onScreenShareError}
          onDominantSpeakerChanged={onDominantSpeakerChanged}
          onConferenceJoined={onConferenceJoined}
          onRemoteParticipantJoined={onRemoteParticipantJoined}
          onRemoteMediaChanged={onRemoteMediaChanged}
          onRemoteMediaSync={onRemoteMediaSync}
          onRemoteSpeakingChanged={onRemoteSpeakingChanged}
          onRemoteStreamActiveChange={onRemoteStreamActiveChange}
          onExpandedChange={onExpandedChange}
          onMinimizeToPip={onMinimizeToPip}
          onTogglePin={onTogglePin}
          onHangUp={onHangUp}
          onToggleMute={onToggleMute}
          onToggleCamera={onToggleCamera}
          onToggleScreenShare={onToggleScreenShare}
          compactControls={compactControls}
          forceShowControls={forceShowControls}
        />
      </div>
    </>
  );
}
