import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Mic, PhoneOff, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../context/AppDataContext';
import { useCall, useCallCore, useCallMedia } from '../context/CallStateContext';
import { isJitsiCallProvider } from '../lib/callProvider';
import { getOptimizedImageUrl } from '../lib/images';
import { shouldSkipJitsiPrejoin } from '../lib/jitsiMicStorage';
import { dedupeCallParticipants, filterJoinedStageParticipants } from '../lib/callParticipants';
import { checkMicrophonePermission } from '../lib/mediaPermissions';
import { CallParticipantStage } from './CallParticipantStage';

interface ChatCallPanelProps {
  conversationId: string;
  currentUserId: string;
}

function connectionLabel(state: string, t: (key: string) => string) {
  switch (state) {
    case 'connected':
      return t('call.connectionConnected');
    case 'connecting':
      return t('call.connectionConnecting');
    case 'reconnecting':
      return t('call.connectionReconnecting');
    default:
      return t('call.connectionDisconnected');
  }
}

export function ChatCallPanel({ conversationId }: ChatCallPanelProps) {
  const { t } = useTranslation();
  const { currentUserProfile } = useAppData();
  const {
    state,
    activeCall,
    toggleMute,
    hangUp,
    isCallForConversation,
    retryConnection,
    callDisplayMode,
    callHostTarget,
    registerCallHost,
    callPinned,
    desiredHostKey,
    activeHostKey,
    registeredHosts,
    isRestoreLockActive,
  } = useCallCore();
  const {
    connectionState,
    isMuted,
    isCameraEnabled,
    isScreenShareEnabled,
    remoteVideoActive,
    remoteScreenShareActive,
    participantVolumes,
    remoteParticipantCount,
    setParticipantVolume,
    errorMessage,
    canRetryConnection,
    retryAttempt,
    isAutoRetrying,
    speakingParticipantId,
    localIdentity,
  } = useCallMedia();

  const callHostAnchorRef = useRef<HTMLDivElement>(null);

  const [micPermissionGranted, setMicPermissionGranted] = useState(
    () => shouldSkipJitsiPrejoin()
  );

  useEffect(() => {
    let cancelled = false;
    void checkMicrophonePermission().then((permission) => {
      if (cancelled) return;
      if (permission === 'granted' || shouldSkipJitsiPrejoin()) {
        setMicPermissionGranted(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isMuted) {
      setMicPermissionGranted(true);
    }
  }, [isMuted]);

  const isActiveConversationCall =
    isCallForConversation(conversationId) && (state === 'calling' || state === 'in_call');
  const isTargetActiveHost = callHostTarget.type === 'chat' && callHostTarget.conversationId === conversationId;
  const isCurrentlyActiveHost = activeHostKey === `chat:${conversationId}`;
  
  const isRestoringThisChat = isRestoreLockActive && desiredHostKey === `chat:${conversationId}`;

  const isHostFallbackAllowed =
    callDisplayMode === 'embedded' &&
    (desiredHostKey !== activeHostKey || isRestoreLockActive) &&
    !registeredHosts[desiredHostKey] &&
    isCurrentlyActiveHost;

  const shouldRenderHost = isTargetActiveHost || isHostFallbackAllowed || isRestoringThisChat;

  useLayoutEffect(() => {
    if (shouldRenderHost) {
      console.log(`[CALL HOST REGISTRY] ChatCallPanel registering: key=chat:${conversationId}`);
      registerCallHost(`chat:${conversationId}`, callHostAnchorRef.current);
      return () => registerCallHost(`chat:${conversationId}`, null);
    }
    registerCallHost(`chat:${conversationId}`, null);
    return undefined;
  }, [shouldRenderHost, conversationId, registerCallHost]);

  const stageParticipants = useMemo(() => {
    const localName =
      localIdentity ||
      currentUserProfile?.display_name ||
      currentUserProfile?.name ||
      t('call.you', { defaultValue: 'Du' });
    const localAvatar = getOptimizedImageUrl(
      currentUserProfile?.avatar_url || currentUserProfile?.images?.[0] || '',
      240
    );

    const participants: Array<{ id: string; name: string; avatarUrl: string | undefined; jitsiParticipantId?: string; isLocal: boolean; }> = [
      {
        id: '__local__',
        name: localName,
        avatarUrl: localAvatar || undefined,
        isLocal: true,
      },
    ];

    const remoteParticipants = dedupeCallParticipants([...(activeCall?.participants ?? [])]);

    for (const participant of remoteParticipants) {
      participants.push({
        id: participant.id,
        name: participant.name,
        avatarUrl: participant.avatarUrl,
        jitsiParticipantId: participant.jitsiParticipantId,
        isLocal: false,
      });
    }

    return filterJoinedStageParticipants(participants, remoteParticipantCount);
  }, [activeCall?.participants, currentUserProfile, localIdentity, remoteParticipantCount, t]);

  if (!isActiveConversationCall) {
    console.log(`[CALL DEBUG] ChatCallPanel hidden because not active conversation call. conversationId=${conversationId}, isActiveConversationCall=false`);
    return null;
  }

  if (callPinned && !isActiveConversationCall) {
    console.log(`[CALL DEBUG] ChatCallPanel hidden because callPinned and not active conversation call. conversationId=${conversationId}`);
    return null;
  }

  if (!shouldRenderHost && state === 'in_call') {
    console.log(`[CALL DEBUG] ChatCallPanel hidden: shouldRenderHost=false, callDisplayMode=${callDisplayMode}, callPinned=${callPinned}, conversationId=${conversationId}, isActiveConversationCall=${isActiveConversationCall}, isHostFallbackAllowed=${isHostFallbackAllowed}, desiredHostKey=${desiredHostKey}, activeHostKey=${activeHostKey}`);
    return null;
  }

  console.log(`[CALL DEBUG] ChatCallPanel visible: shouldRenderHost=true, callDisplayMode=${callDisplayMode}, callPinned=${callPinned}, conversationId=${conversationId}, isActiveConversationCall=${isActiveConversationCall}, isHostFallbackAllowed=${isHostFallbackAllowed}, desiredHostKey=${desiredHostKey}, activeHostKey=${activeHostKey}`);

  const subtitle =
    state === 'calling'
      ? t('call.waitingForParticipant')
      : state === 'in_call'
        ? connectionLabel(connectionState, t)
        : t('call.waitingForParticipant');

  const showVideoSurface =
    isCameraEnabled ||
    isScreenShareEnabled ||
    remoteVideoActive ||
    remoteScreenShareActive;
  const showAvatarStage =
    state === 'in_call' && connectionState === 'connected' && !showVideoSurface;
  const showStreamAvatars =
    state === 'in_call' && connectionState === 'connected' && showVideoSurface;

  const showMicPrompt =
    state === 'in_call' &&
    connectionState === 'connected' &&
    isMuted &&
    isJitsiCallProvider() &&
    !micPermissionGranted;

  const showEmbeddedHost = state === 'in_call' && isJitsiCallProvider() && shouldRenderHost;

  return (
    <div
      className="relative shrink-0"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      {showEmbeddedHost ? (
          <div
            ref={callHostAnchorRef}
            className="relative h-[min(32vh,300px)] min-h-[200px] w-full shrink-0 overflow-hidden border-b border-white/10 bg-[#0b0b0b]"
          />
      ) : (
        <div className="flex h-[min(32vh,300px)] min-h-[200px] w-full items-center justify-center border-b border-white/10 bg-[#0b0b0b] px-4">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-blyve/20">
              <PhoneOff className="h-6 w-6 text-blyve" />
            </div>
            <p className="text-sm font-semibold text-white">
              {state === 'calling' ? t('call.calling') : t('call.inCall')}
            </p>
            <p className="mt-1 text-xs text-white/70">{subtitle}</p>
          </div>
        </div>
      )}

      {showEmbeddedHost && showAvatarStage ? (
        <div className="pointer-events-none absolute inset-0 z-[5]">
          <CallParticipantStage
            variant="center"
            participants={stageParticipants}
            speakingParticipantId={speakingParticipantId}
            participantVolumes={participantVolumes}
            onParticipantVolumeChange={setParticipantVolume}
          />
        </div>
      ) : null}

      {showEmbeddedHost && showStreamAvatars ? (
        <div className="pointer-events-none absolute inset-0 z-[5]">
          <CallParticipantStage
            variant="stream"
            participants={stageParticipants}
            speakingParticipantId={speakingParticipantId}
            participantVolumes={participantVolumes}
            onParticipantVolumeChange={setParticipantVolume}
          />
        </div>
      ) : null}

      {(errorMessage || canRetryConnection) && state === 'in_call' ? (
        <div className="absolute inset-x-3 top-3 z-30 space-y-2">
          {errorMessage ? (
            <div className="rounded-lg border border-red-400/40 bg-red-500/90 px-3 py-2 shadow-lg">
              <p className="text-xs text-white">{errorMessage}</p>
            </div>
          ) : null}
          {canRetryConnection ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-yellow-300/30 bg-[#1e1f22]/95 px-3 py-2 shadow-lg">
              <p className="text-xs text-yellow-100">
                {isAutoRetrying
                  ? t('call.reconnectAutoTrying', { attempt: retryAttempt + 1 })
                  : t('call.reconnectHint')}
              </p>
              <button
                type="button"
                onClick={() => void retryConnection()}
                className="rounded-md bg-yellow-400 px-2.5 py-1 text-xs font-semibold text-black hover:bg-yellow-300"
              >
                {t('call.retryConnection')}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {showMicPrompt ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 px-4">
          <div className="max-w-sm rounded-2xl border border-white/10 bg-[#1e1f22]/95 p-4 text-center shadow-2xl">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blyve/20">
              <Mic className="h-6 w-6 text-blyve" />
            </div>
            <p className="text-sm font-semibold text-white">{t('call.enableMicrophone')}</p>
            <p className="mt-2 text-xs leading-relaxed text-white/70">{t('call.microphoneIframeHint')}</p>
            <button
              type="button"
              onClick={() => void toggleMute()}
              className="mt-4 w-full rounded-xl bg-blyve px-4 py-2.5 text-sm font-semibold text-white hover:bg-blyve-hover"
            >
              {t('call.enableMicrophone')}
            </button>
          </div>
        </div>
      ) : null}

      {state === 'calling' ? (
        <div className="absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
          <button
            type="button"
            onClick={() => void hangUp()}
            className="flex items-center gap-2 rounded-full border border-white/10 bg-[#1e1f22]/95 px-4 py-2 text-sm text-white shadow-lg hover:bg-[#2f3136]"
          >
            <X className="h-4 w-4" />
            {t('call.decline')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
