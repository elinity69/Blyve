import React, { useEffect, useRef, useState } from 'react';
import {
  Expand,
  Loader2,
  Mic,
  MicOff,
  Minimize2,
  MonitorUp,
  PhoneOff,
  PictureInPicture2,
  Pin,
  ShieldAlert,
  Video,
  VideoOff,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { mountJitsiMeetingFromServerJoin, type CallMediaType, type JitsiHandle } from '../lib/jitsi';
import { fetchJitsiJoinCredentials, type JitsiJoinCredentials } from '../lib/jitsiCall';
import { applyJitsiNoiseSuppression } from '../lib/callAudio/jitsiAudioBridge';
import { premiumCallAudio } from '../lib/callAudio/ensurePremiumCallAudio';
import { isScreenShareSupported } from '../lib/screenShareSupport';
import { shouldSkipJitsiPrejoin } from '../lib/jitsiMicStorage';

export type JitsiCallLayout = 'embedded' | 'standalone' | 'pip';

interface JitsiCallViewProps {
  sessionId: string;
  inviteToken?: string;
  callType: CallMediaType;
  userId?: string;
  mountKey?: number;
  layout?: JitsiCallLayout;
  mediaActive?: boolean;
  connectionState?: string;
  isMuted?: boolean;
  isCameraEnabled?: boolean;
  isScreenShareEnabled?: boolean;
  overlay?: React.ReactNode;
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
  hideJitsiVideo?: boolean;
  streamMode?: boolean;
  onRemoteStreamActiveChange?: (active: boolean) => void;
  onExpandedChange?: (expanded: boolean) => void;
  onHangUp?: () => void;
  onToggleMute?: () => void;
  onToggleCamera?: () => void;
  onToggleScreenShare?: () => void;
  /** Embedded: collapse call into floating PiP */
  onMinimizeToPip?: () => void;
  /** Embedded: pin call so it stays visible across chats */
  onTogglePin?: () => void;
  callPinned?: boolean;
  /** PiP: expand to fullscreen (shows button when stream active) */
  onExpandRequest?: () => void;
  /** PiP: controls visible on tap (mobile) */
  forceShowControls?: boolean;
  compactControls?: boolean;
}

export function CallControlBar({
  live,
  isMuted,
  isCameraEnabled,
  isScreenShareEnabled,
  mediaActive,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare,
  onHangUp,
  forceShowControls = false,
  compact = false,
}: {
  live: boolean;
  isMuted: boolean;
  isCameraEnabled: boolean;
  isScreenShareEnabled: boolean;
  mediaActive: boolean;
  onToggleMute?: () => void;
  onToggleCamera?: () => void;
  onToggleScreenShare?: () => void;
  onHangUp?: () => void;
  forceShowControls?: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const canShareScreen = isScreenShareEnabled || isScreenShareSupported();

  return (
    <div
      className={`pointer-events-auto flex items-center gap-1.5 rounded-full border border-white/10 bg-[#1e1f22]/95 shadow-2xl backdrop-blur-sm transition-opacity ${
        compact ? 'px-1.5 py-1' : 'px-2.5 py-2'
      } ${forceShowControls ? 'opacity-100' : ''}`}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => onToggleMute?.()}
        disabled={!live}
        className={`flex items-center justify-center rounded-full transition-colors ${
          compact ? 'h-7 w-7' : 'h-9 w-9'
        } ${
          isMuted ? 'bg-[#faa61a] text-black' : 'bg-[#2f3136] text-white hover:bg-[#3a3d44]'
        } disabled:opacity-60`}
        aria-label={t('call.title')}
      >
        {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={() => onToggleCamera?.()}
        disabled={!live}
        className={`flex items-center justify-center rounded-full transition-colors ${
          compact ? 'h-7 w-7' : 'h-9 w-9'
        } ${
          isCameraEnabled ? 'bg-blyve text-white' : 'bg-[#2f3136] text-white hover:bg-[#3a3d44]'
        } disabled:opacity-60`}
        aria-label={t('call.title')}
      >
        {isCameraEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={() => onToggleScreenShare?.()}
        disabled={!live || !canShareScreen}
        className={`flex items-center justify-center rounded-full transition-colors ${
          compact ? 'h-7 w-7' : 'h-9 w-9'
        } ${
          isScreenShareEnabled ? 'bg-[#23a559] text-white' : 'bg-[#2f3136] text-white hover:bg-[#3a3d44]'
        } disabled:opacity-60`}
        aria-label={
          isScreenShareEnabled ? t('call.screenShareStop') : t('call.screenShare')
        }
        title={
          !canShareScreen ? t('call.screenShareUnsupported') : undefined
        }
      >
        <MonitorUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onHangUp?.()}
        className={`flex items-center justify-center rounded-full bg-[#ed4245] text-white transition-colors hover:bg-[#f15a5d] ${
          compact ? 'h-7 w-7' : 'h-9 w-9'
        }`}
        aria-label={t('call.decline')}
      >
        <PhoneOff className="h-4 w-4" />
      </button>
    </div>
  );
}

export function JitsiCallView({
  sessionId,
  inviteToken,
  callType,
  userId,
  mountKey = 0,
  layout = 'embedded',
  mediaActive = false,
  connectionState = 'connecting',
  isMuted = false,
  isCameraEnabled = false,
  isScreenShareEnabled = false,
  overlay = null,
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
  hideJitsiVideo = false,
  streamMode = false,
  onRemoteStreamActiveChange,
  onExpandedChange,
  onHangUp,
  onToggleMute,
  onToggleCamera,
  onToggleScreenShare,
  onMinimizeToPip,
  onTogglePin,
  callPinned = false,
  onExpandRequest,
  forceShowControls = false,
  compactControls = false,
}: JitsiCallViewProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<JitsiHandle | null>(null);
  const mountedSessionRef = useRef<string | null>(null);
  const mountInFlightRef = useRef<string | null>(null);
  const remoteCountRef = useRef(0);
  const callbacksRef = useRef({
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
  });
  const [credentials, setCredentials] = useState<JitsiJoinCredentials | null>(null);
  const [joining, setJoining] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [remoteStreamActive, setRemoteStreamActive] = useState(false);
  const [pipControlsVisible, setPipControlsVisible] = useState(false);

  callbacksRef.current = {
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
  };

  useEffect(() => {
    setRemoteStreamActive(false);
    onRemoteStreamActiveChange?.(false);
  }, [credentials, mountKey, onRemoteStreamActiveChange]);

  useEffect(() => {
    onRemoteStreamActiveChange?.(remoteStreamActive);
  }, [onRemoteStreamActiveChange, remoteStreamActive]);

  useEffect(() => {
    if (layout === 'standalone') {
      setExpanded(false);
    }
  }, [layout]);

  useEffect(() => {
    if (layout !== 'pip') {
      setPipControlsVisible(false);
    }
  }, [layout]);

  useEffect(() => {
    if (!credentials || connectionState !== 'connected') return;
    applyJitsiNoiseSuppression();
    premiumCallAudio.onJitsiConferenceJoined();
  }, [connectionState, credentials, layout]);

  const effectiveMediaActive = mediaActive || remoteStreamActive;

  useEffect(() => {
    onExpandedChange?.(layout === 'standalone' || expanded);
  }, [expanded, layout, onExpandedChange]);

  useEffect(() => {
    if (!mediaActive && !remoteStreamActive) {
      setExpanded(false);
    }
  }, [mediaActive, remoteStreamActive]);

  useEffect(() => {
    let cancelled = false;
    setJoining(true);
    setCredentials(null);
    setAuthError(null);

    void (async () => {
      try {
        const resolved = await fetchJitsiJoinCredentials(sessionId, inviteToken);
        if (cancelled) return;
        setCredentials(resolved);
        callbacksRef.current.onJoinResolved?.(resolved);
      } catch (error) {
        if (cancelled) return;
        callbacksRef.current.onJoinError?.(error);
      } finally {
        if (!cancelled) setJoining(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, inviteToken, mountKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !credentials) return;

    const sessionKey = `${credentials.sessionId}:${credentials.roomName}`;
    if (
      mountedSessionRef.current === sessionKey &&
      (handleRef.current || mountInFlightRef.current === sessionKey)
    ) {
      return undefined;
    }

    let disposed = false;
    remoteCountRef.current = 0;
    const previousHandle = handleRef.current;
    if (previousHandle && mountedSessionRef.current !== sessionKey) {
      previousHandle.dispose();
      handleRef.current = null;
      mountedSessionRef.current = null;
    }
    mountInFlightRef.current = sessionKey;

    void (async () => {
      try {
        await premiumCallAudio.prepareForCall();
        const handle = await mountJitsiMeetingFromServerJoin({
          container,
          sessionId: credentials.sessionId,
          domain: credentials.jitsiDomain,
          roomName: credentials.roomName,
          displayName: credentials.displayName,
          callType: credentials.callType || callType,
          userId,
          jwt: credentials.jwt,
          jitsiAppId: credentials.jitsiAppId,
          skipInitialGUM: shouldSkipJitsiPrejoin(),
          onConnectionEstablished: () => callbacksRef.current.onConnectionEstablished?.(),
          onReadyToClose: () => callbacksRef.current.onReadyToClose?.(),
          onAudioMuteChanged: (muted) => callbacksRef.current.onAudioMuteChanged?.(muted),
          onVideoMuteChanged: (muted) => callbacksRef.current.onVideoMuteChanged?.(muted),
          onScreenShareChanged: (active) => callbacksRef.current.onScreenShareChanged?.(active),
          onScreenShareError: (code) => callbacksRef.current.onScreenShareError?.(code),
          onDominantSpeakerChanged: (participantId) =>
            callbacksRef.current.onDominantSpeakerChanged?.(participantId),
          onConferenceJoined: (payload) => callbacksRef.current.onConferenceJoined?.(payload),
          onRemoteParticipantJoined: (payload) =>
            callbacksRef.current.onRemoteParticipantJoined?.(payload),
          onRemoteMediaChanged: (state) => {
            if (state.remoteVideoActive || state.remoteScreenShareActive) {
              setRemoteStreamActive(true);
            } else {
              setRemoteStreamActive(false);
            }
            callbacksRef.current.onRemoteMediaChanged?.(state);
          },
          onRemoteMediaSync: (payload) => {
            if (payload.camera || payload.screenShare) {
              setRemoteStreamActive(true);
            }
            callbacksRef.current.onRemoteMediaSync?.(payload);
          },
          onRemoteSpeakingChanged: (payload) =>
            callbacksRef.current.onRemoteSpeakingChanged?.(payload),
          onAuthError: (message) => {
            const err = message || 'Jitsi authentication failed';
            setAuthError(err);
            callbacksRef.current.onJoinError?.(
              new Error(err),
            );
          },
          onParticipantJoined: () => {
            remoteCountRef.current += 1;
            callbacksRef.current.onParticipantCountChange?.(remoteCountRef.current);
          },
          onParticipantLeft: () => {
            remoteCountRef.current = Math.max(0, remoteCountRef.current - 1);
            callbacksRef.current.onParticipantCountChange?.(remoteCountRef.current);
          },
        });

        if (disposed) {
          handle.dispose();
          return;
        }

        handleRef.current = handle;
        mountedSessionRef.current = sessionKey;
        mountInFlightRef.current = null;
        callbacksRef.current.onReady?.(handle);
      } catch (error) {
        if (mountInFlightRef.current === sessionKey) {
          mountInFlightRef.current = null;
        }
        console.error('Jitsi mount failed:', error);
        const msg = String((error as { message?: string })?.message || '');
        const lower = msg.toLowerCase();
        if (
          lower.includes('jwt') ||
          lower.includes('token') ||
          lower.includes('auth') ||
          lower.includes('unauthorized') ||
          lower.includes('tenant') ||
          lower.includes('kid')
        ) {
          setAuthError(msg || 'Jitsi authentication failed');
        }
        callbacksRef.current.onJoinError?.(error);
      }
    })();

    return () => {
      disposed = true;
      if (mountInFlightRef.current === sessionKey) {
        mountInFlightRef.current = null;
      }
      if (mountedSessionRef.current !== sessionKey) return;
      const handle = handleRef.current;
      handleRef.current = null;
      mountedSessionRef.current = null;
      remoteCountRef.current = 0;
      handle?.dispose();
    };
  }, [credentials, callType, userId]);

  const live = connectionState === 'connected';
  const isPip = layout === 'pip';
  const isEmbeddedExpanded = layout === 'embedded' && expanded;
  const isFullscreen = layout === 'standalone' || isEmbeddedExpanded;
  const canExpand = layout === 'embedded' && live && !!credentials && effectiveMediaActive && !expanded;
  const useCompactPanel = layout !== 'pip' && !effectiveMediaActive && !expanded;
  const hideVideo =
    (isPip && !effectiveMediaActive) || (!isPip && hideJitsiVideo && !remoteStreamActive);

  useEffect(() => {
    if (!isEmbeddedExpanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isEmbeddedExpanded]);

  const panelHeightClass = useCompactPanel
    ? 'relative h-[min(32vh,300px)] min-h-[200px] w-full shrink-0 overflow-hidden border-b border-white/10 bg-[#0b0b0b]'
    : 'relative h-[min(55vh,480px)] min-h-[320px] w-full shrink-0 overflow-hidden border-b border-white/10 bg-[#0b0b0b]';

  const shellClass = isPip
    ? 'group/pip pointer-events-none relative h-full w-full overflow-hidden rounded-xl bg-[#0b0b0b]'
    : layout === 'standalone'
      ? 'relative h-full w-full overflow-hidden bg-[#0b0b0b]'
      : isEmbeddedExpanded
        ? 'fixed inset-0 z-[9999] bg-[#0b0b0b]'
        : panelHeightClass;

  return (
    <div
      className={shellClass}
      onClick={
        isPip
          ? (event) => {
              if ((event.target as HTMLElement).closest('[data-call-controls], button')) return;
              setPipControlsVisible((visible) => !visible);
            }
          : undefined
      }
    >
      {authError && !joining ? (
        <div className={`flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center ${isPip ? 'text-xs' : ''}`}>
          <ShieldAlert className={`shrink-0 text-[#ed4245] ${isPip ? 'h-4 w-4' : 'h-6 w-6'}`} />
          {!isPip ? (
            <p className="max-w-[260px] text-sm text-white/70">
              {t('call.jitsiAuthError', { defaultValue: 'Call authentication failed. Please try again or contact support.' })}
            </p>
          ) : null}
        </div>
      ) : joining || !credentials ? (
        <div className={`flex h-full w-full items-center justify-center gap-3 text-white/90 ${isPip ? 'text-xs' : ''}`}>
          <Loader2 className={`animate-spin ${isPip ? 'h-4 w-4' : 'h-6 w-6'}`} />
          {!isPip ? <span>{t('call.connectionConnecting')}</span> : null}
        </div>
      ) : null}
      {credentials ? (
        <>
          <div
            ref={containerRef}
            className={`absolute inset-0 h-full w-full overflow-hidden ${
              hideVideo ? 'pointer-events-none opacity-0' : ''
            } ${isPip ? 'pointer-events-none' : ''}`}
          />
          {overlay}
          {layout === 'embedded' && !expanded && onMinimizeToPip ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onMinimizeToPip();
              }}
              className="absolute left-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-[#1e1f22]/95 text-white shadow-lg transition-colors hover:bg-[#2f3136]"
              aria-label={t('call.minimizeToPip')}
            >
              <PictureInPicture2 className="h-4 w-4" />
            </button>
          ) : null}
          {layout === 'embedded' && !expanded && onTogglePin ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onTogglePin();
              }}
              className={`absolute top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full border shadow-lg transition-colors hover:bg-[#2f3136] ${
                onMinimizeToPip ? 'left-14' : 'left-3'
              } ${
                callPinned
                  ? 'border-blyve/60 bg-blyve/90 text-white'
                  : 'border-white/10 bg-[#1e1f22]/95 text-white'
              }`}
              aria-label={callPinned ? t('call.unpinCall') : t('call.pinCall')}
            >
              <Pin className={`h-4 w-4 ${callPinned ? 'fill-current' : ''}`} />
            </button>
          ) : null}
          {canExpand && !expanded ? (
            <button
              type="button"
              onClick={() => {
                setExpanded(true);
                onExpandedChange?.(true);
              }}
              className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-[#1e1f22]/95 text-white shadow-lg transition-colors hover:bg-[#2f3136]"
              aria-label={t('call.expandVideo')}
            >
              <Expand className="h-4 w-4" />
            </button>
          ) : null}
          {expanded && layout === 'embedded' ? (
            <button
              type="button"
              onClick={() => {
                setExpanded(false);
                onExpandedChange?.(false);
              }}
              className="absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#1e1f22]/95 text-white shadow-lg transition-colors hover:bg-[#2f3136]"
              aria-label={t('call.minimizeVideo')}
            >
              <Minimize2 className="h-4 w-4" />
            </button>
          ) : null}
          {!isPip ? (
            <div
              data-call-controls
              className="pointer-events-none absolute inset-x-0 bottom-3 z-[30] flex justify-center px-3"
            >
              <CallControlBar
                live={live}
                isMuted={isMuted}
                isCameraEnabled={isCameraEnabled}
                isScreenShareEnabled={isScreenShareEnabled}
                mediaActive={false}
                onToggleMute={onToggleMute}
                onToggleCamera={onToggleCamera}
                onToggleScreenShare={onToggleScreenShare}
                onHangUp={onHangUp}
                forceShowControls={forceShowControls}
                compact={compactControls}
              />
            </div>
          ) : (
            <div
              data-call-controls
              className={`pointer-events-none absolute inset-x-0 bottom-1 z-[30] flex justify-center px-1 transition-opacity ${
                pipControlsVisible ? 'opacity-100' : 'opacity-0 group-hover/pip:opacity-100'
              }`}
            >
              <CallControlBar
                live={live}
                isMuted={isMuted}
                isCameraEnabled={isCameraEnabled}
                isScreenShareEnabled={isScreenShareEnabled}
                mediaActive={effectiveMediaActive}
                onToggleMute={onToggleMute}
                onToggleCamera={onToggleCamera}
                onToggleScreenShare={onToggleScreenShare}
                onHangUp={onHangUp}
                forceShowControls={pipControlsVisible}
                compact
              />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
