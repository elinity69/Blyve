import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Mic, PhoneOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppData } from '../context/AppDataContext';
import { useCall } from '../context/CallContext';
import { isJitsiCallProvider } from '../lib/callProvider';
import { getOptimizedImageUrl } from '../lib/images';
import { shouldSkipJitsiPrejoin } from '../lib/jitsiMicStorage';
import { dedupeCallParticipants, filterJoinedStageParticipants } from '../lib/callParticipants';
import { checkMicrophonePermission } from '../lib/mediaPermissions';
import { CallParticipantStage } from './CallParticipantStage';
import { JitsiCallView } from './JitsiCallView';

interface GroupVoiceCallPanelProps {
  groupId: string;
  channelId: string;
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

export function GroupVoiceCallPanel({ groupId, channelId, currentUserId }: GroupVoiceCallPanelProps) {
  const { t } = useTranslation();
  const { currentUserProfile } = useAppData();
  const {
    state,
    activeCall,
    connectionState,
    isMuted,
    isCameraEnabled,
    isScreenShareEnabled,
    remoteVideoActive,
    remoteScreenShareActive,
    participantVolumes,
    remoteParticipantCount,
    setParticipantVolume,
    toggleMute,
    toggleCamera,
    toggleScreenShare,
    hangUp,
    isVoiceChannelActive,
    errorMessage,
    canRetryConnection,
    retryAttempt,
    isAutoRetrying,
    retryConnection,
    registerEmbeddedVoiceHost,
    embeddedVoiceGroupId,
    embeddedVoiceChannelId,
    callDisplayMode,
    setCallDisplayMode,
    expandCallToFullscreen,
    enterCallPip,
    callPinned,
    toggleCallPinned,
    jitsiSession,
    jitsiMountKey,
    jitsiHandlers,
    speakingParticipantId,
    localIdentity,
  } = useCall();

  const [micPermissionGranted, setMicPermissionGranted] = useState(
    () => shouldSkipJitsiPrejoin()
  );
  const [remoteStreamDetected, setRemoteStreamDetected] = useState(false);

  useEffect(() => {
    if (state !== 'in_call') {
      setRemoteStreamDetected(false);
    }
  }, [state]);

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

  const isActiveVoiceCall = isVoiceChannelActive(groupId, channelId);
  const isEmbeddedVoiceHost =
    embeddedVoiceGroupId === groupId &&
    embeddedVoiceChannelId === channelId &&
    callDisplayMode === 'embedded';

  useLayoutEffect(() => {
    if (callPinned) return undefined;
    if (isActiveVoiceCall && state === 'in_call') {
      registerEmbeddedVoiceHost(groupId, channelId);
      return () => registerEmbeddedVoiceHost(null, null);
    }
    registerEmbeddedVoiceHost(null, null);
    return undefined;
  }, [callPinned, channelId, groupId, isActiveVoiceCall, registerEmbeddedVoiceHost, state]);

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

    const participants = [
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

  if (!isActiveVoiceCall) return null;

  if (callPinned) return null;

  if (callDisplayMode === 'pip' && state === 'in_call') return null;

  const subtitle =
    state === 'in_call' ? connectionLabel(connectionState, t) : t('call.connectionConnecting');

  const showVideoSurface =
    isCameraEnabled ||
    isScreenShareEnabled ||
    remoteVideoActive ||
    remoteScreenShareActive ||
    remoteStreamDetected;
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

  return (
    <div className="relative shrink-0">
      {state === 'in_call' && isJitsiCallProvider() && jitsiSession && isEmbeddedVoiceHost ? (
        <JitsiCallView
          key={`${jitsiSession.sessionId}:${jitsiMountKey}`}
          sessionId={jitsiSession.sessionId}
          inviteToken={jitsiSession.inviteToken}
          callType={jitsiSession.callType}
          userId={currentUserId}
          mountKey={jitsiMountKey}
          layout="embedded"
          mediaActive={showVideoSurface}
          streamMode={showStreamAvatars}
          connectionState={connectionState}
          isMuted={isMuted}
          isCameraEnabled={isCameraEnabled}
          isScreenShareEnabled={isScreenShareEnabled}
          hideJitsiVideo={showAvatarStage}
          onRemoteStreamActiveChange={setRemoteStreamDetected}
          onExpandedChange={(expanded) => {
            if (expanded) expandCallToFullscreen();
            else if (
              embeddedVoiceGroupId === groupId &&
              embeddedVoiceChannelId === channelId
            ) {
              setCallDisplayMode('embedded');
            } else {
              enterCallPip();
            }
          }}
          onJoinResolved={jitsiHandlers.onJoinResolved}
          onJoinError={jitsiHandlers.onJoinError}
          onReady={jitsiHandlers.onReady}
          onConnectionEstablished={jitsiHandlers.onConnectionEstablished}
          onReadyToClose={jitsiHandlers.onReadyToClose}
          onParticipantCountChange={jitsiHandlers.onParticipantCountChange}
          onAudioMuteChanged={jitsiHandlers.onAudioMuteChanged}
          onVideoMuteChanged={jitsiHandlers.onVideoMuteChanged}
          onScreenShareChanged={jitsiHandlers.onScreenShareChanged}
          onScreenShareError={jitsiHandlers.onScreenShareError}
          onDominantSpeakerChanged={jitsiHandlers.onDominantSpeakerChanged}
          onConferenceJoined={jitsiHandlers.onConferenceJoined}
          onRemoteParticipantJoined={jitsiHandlers.onRemoteParticipantJoined}
          onRemoteMediaChanged={jitsiHandlers.onRemoteMediaChanged}
          onRemoteMediaSync={jitsiHandlers.onRemoteMediaSync}
          onRemoteSpeakingChanged={jitsiHandlers.onRemoteSpeakingChanged}
          onHangUp={() => void hangUp()}
          onToggleMute={() => void toggleMute()}
          onToggleCamera={() => void toggleCamera()}
          onToggleScreenShare={toggleScreenShare}
          onMinimizeToPip={enterCallPip}
          onTogglePin={toggleCallPinned}
          callPinned={callPinned}
          overlay={
            showAvatarStage ? (
              <CallParticipantStage
                variant="center"
                participants={stageParticipants}
                speakingParticipantId={speakingParticipantId}
                participantVolumes={participantVolumes}
                onParticipantVolumeChange={setParticipantVolume}
              />
            ) : showStreamAvatars ? (
              <CallParticipantStage
                variant="stream"
                participants={stageParticipants}
                speakingParticipantId={speakingParticipantId}
                participantVolumes={participantVolumes}
                onParticipantVolumeChange={setParticipantVolume}
              />
            ) : null
          }
        />
      ) : (
        <div className="flex h-[min(32vh,300px)] min-h-[200px] w-full items-center justify-center border-b border-white/10 bg-[#0b0b0b] px-4">
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#5865f2]/20">
              <PhoneOff className="h-6 w-6 text-[#5865f2]" />
            </div>
            <p className="text-sm font-semibold text-white">{t('groups.voiceChannelsHeading')}</p>
            <p className="mt-1 text-xs text-white/70">{subtitle}</p>
          </div>
        </div>
      )}

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
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#5865f2]/20">
              <Mic className="h-6 w-6 text-[#5865f2]" />
            </div>
            <p className="text-sm font-semibold text-white">{t('call.enableMicrophone')}</p>
            <p className="mt-2 text-xs leading-relaxed text-white/70">{t('call.microphoneIframeHint')}</p>
            <button
              type="button"
              onClick={() => void toggleMute()}
              className="mt-4 w-full rounded-xl bg-[#5865f2] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#4752c4]"
            >
              {t('call.enableMicrophone')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
