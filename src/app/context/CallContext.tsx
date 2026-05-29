import React, {
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { supabase } from '../lib/supabase';
import { getCachedUser, subscribeAuth } from '../lib/authSession';
import { api } from '../lib/api';
import { getOptimizedImageUrl } from '../lib/images';
import { toast } from '../lib/toast';
import i18n from '../../lib/i18n';
import { FloatingCallWidget } from '../components/FloatingCallWidget';

const IncomingCallPopup = lazy(() =>
  import('../components/IncomingCallPopup').then((module) => ({
    default: module.IncomingCallPopup,
  }))
);
import type { CallStageParticipant } from '../components/CallParticipantStage';
import { type CallMediaType, type JitsiHandle } from '../lib/jitsi';
import { isJitsiCallProvider } from '../lib/callProvider';
import { toJitsiCallError, type JitsiJoinCredentials } from '../lib/jitsiCall';
import { requestMicrophoneAccess, hasMicrophonePermission, type MicrophoneAccessResult } from '../lib/mediaPermissions';
import { markJitsiMicGranted, shouldSkipJitsiPrejoin } from '../lib/jitsiMicStorage';
import { premiumCallAudio } from '../lib/callAudio/ensurePremiumCallAudio';
import { isScreenShareSupported } from '../lib/screenShareSupport';
import { filterJoinedStageParticipants, mergeCallParticipants } from '../lib/callParticipants';

type CallUiState = 'idle' | 'calling' | 'incoming' | 'in_call' | 'ended';
export type CallDisplayMode = 'embedded' | 'pip' | 'fullscreen';
type TerminalCallStatus = 'ended' | 'cancelled' | 'declined' | 'missed';
type CallSelfRole = 'host' | 'participant' | 'unknown';
const RINGING_TIMEOUT_MS = 30_000;

function notifyMicrophoneAccessResult(micAccess: MicrophoneAccessResult) {
  if (micAccess.ok) {
    markJitsiMicGranted();
    return;
  }
  if (micAccess.reason === 'insecure') {
    toast.error(
      i18n.t('call.microphoneRequiresSecureContext'),
      micAccess.message === 'http-lan'
        ? i18n.t('call.microphoneRequiresHttpsLanHint')
        : i18n.t('call.microphoneRequiresHttpsHint'),
    );
    return;
  }
  if (micAccess.reason === 'denied') {
    toast.error(i18n.t('call.microphoneRequired'), i18n.t('call.microphoneDeniedHint'));
  }
}

async function ensureMicrophoneForCall(): Promise<void> {
  if (shouldSkipJitsiPrejoin()) {
    markJitsiMicGranted();
    await premiumCallAudio.prepareForCall();
    return;
  }
  if (await hasMicrophonePermission()) {
    markJitsiMicGranted();
    await premiumCallAudio.prepareForCall();
    return;
  }
  const micAccess = await requestMicrophoneAccess();
  notifyMicrophoneAccessResult(micAccess);
  if (micAccess.ok) {
    await premiumCallAudio.prepareForCall();
  }
}

interface CallParty {
  id: string;
  name: string;
  avatarUrl?: string;
  jitsiParticipantId?: string;
}

interface IncomingCall {
  callSessionId: string;
  conversationId?: string | null;
  caller: CallParty;
}

interface ActiveCall {
  callSessionId: string;
  conversationId?: string | null;
  groupId?: string | null;
  channelId?: string | null;
  channelName?: string | null;
  groupName?: string | null;
  isVoiceChannel?: boolean;
  callType: CallMediaType;
  participants: CallParty[];
}

interface JoinVoiceChannelInput {
  groupId: string;
  channelId: string;
  channelName: string;
  groupName: string;
}

interface JitsiJoinRequest {
  sessionId: string;
  inviteToken?: string;
  callType: CallMediaType;
  conversationId?: string | null;
}

interface StartDirectCallInput {
  conversationId: string;
  otherUserId: string;
  otherUserName: string;
  otherUserAvatar?: string;
}

interface CallContextValue {
  state: CallUiState;
  activeCall: ActiveCall | null;
  incomingCall: IncomingCall | null;
  connectionState: string;
  isMuted: boolean;
  isCameraEnabled: boolean;
  isScreenShareEnabled: boolean;
  errorMessage: string | null;
  canRetryConnection: boolean;
  retryAttempt: number;
  isAutoRetrying: boolean;
  selfRole: CallSelfRole;
  localIdentity: string | null;
  remoteParticipantCount: number;
  remoteVideoActive: boolean;
  remoteScreenShareActive: boolean;
  callDisplayMode: CallDisplayMode;
  participantVolumes: Record<string, number>;
  mediaCaptureAvailable: boolean;
  debugTrail: string[];
  jitsiSession: JitsiJoinRequest | null;
  jitsiMountKey: number;
  speakingParticipantId: string | null;
  jitsiHandlers: {
    onJoinResolved: (credentials: JitsiJoinCredentials) => void;
    onJoinError: (error: unknown) => void;
    onReady: (handle: JitsiHandle) => void;
    onConnectionEstablished: () => void;
    onReadyToClose: () => void;
    onParticipantCountChange: (count: number) => void;
    onAudioMuteChanged: (muted: boolean) => void;
    onVideoMuteChanged: (muted: boolean) => void;
    onScreenShareChanged: (active: boolean) => void;
    onScreenShareError: (code: string) => void;
    onDominantSpeakerChanged: (participantId: string | null) => void;
    onConferenceJoined: (payload: { id?: string; displayName?: string }) => void;
    onRemoteParticipantJoined: (payload: { id?: string; displayName?: string }) => void;
    onRemoteMediaChanged: (state: { remoteVideoActive: boolean; remoteScreenShareActive: boolean }) => void;
    onRemoteMediaSync: (payload: {
      participantId?: string;
      camera: boolean;
      screenShare: boolean;
    }) => void;
    onRemoteSpeakingChanged: (payload: {
      participantId?: string;
      speaking: boolean;
      levelDb: number;
    }) => void;
  };
  setParticipantVolume: (participantId: string, volume: number) => void;
  setCallDisplayMode: (mode: CallDisplayMode) => void;
  enterCallPip: (force?: boolean) => void;
  expandCallToFullscreen: () => void;
  minimizeCallFromFullscreen: () => void;
  openCallInChat: () => void;
  openCallInGroupPanel: () => void;
  openCallInPanel: () => void;
  registerEmbeddedCallHost: (conversationId: string | null) => void;
  registerEmbeddedVoiceHost: (groupId: string | null, channelId: string | null) => void;
  registerCallHostAnchor: (element: HTMLElement | null) => void;
  embeddedCallConversationId: string | null;
  embeddedVoiceGroupId: string | null;
  embeddedVoiceChannelId: string | null;
  callPinned: boolean;
  pinnedCallHostActive: boolean;
  toggleCallPinned: () => void;
  registerPinnedCallHost: (active: boolean) => void;
  startDirectCall: (input: StartDirectCallInput) => Promise<void>;
  joinVoiceChannel: (input: JoinVoiceChannelInput) => Promise<void>;
  leaveVoiceChannel: () => Promise<void>;
  acceptIncomingCall: () => Promise<void>;
  declineIncomingCall: () => Promise<void>;
  hangUp: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  toggleScreenShare: () => void;
  retryConnection: () => Promise<void>;
  joinCallViaInvite: (sessionId: string, inviteToken: string) => Promise<void>;
  clearEndedState: () => void;
  isCallForConversation: (conversationId: string) => boolean;
  isVoiceChannelActive: (groupId: string, channelId: string) => boolean;
}

const CallContext = createContext<CallContextValue | undefined>(undefined);

function createTone(frequency = 700, durationMs = 180, volume = 0.02) {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return null;
  const ctx = new AudioCtx();
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();
  oscillator.frequency.value = frequency;
  oscillator.type = 'sine';
  gainNode.gain.value = volume;
  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + durationMs / 1000);
  oscillator.onended = () => {
    void ctx.close();
  };
  return ctx;
}

function toUserFacingCallError(error: unknown): string {
  return toJitsiCallError(error);
}

function mediaCaptureSupported() {
  return (
    typeof window !== 'undefined' &&
    !!navigator?.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

function isStaleAcceptCallError(error: unknown): boolean {
  const message = String((error as Error)?.message || error || '').toLowerCase();
  return (
    message.includes('409') ||
    message.includes('current state') ||
    message.includes('cannot be accepted') ||
    message.includes('already accepted')
  );
}

function isExpiredRingingSession(
  statusRaw: unknown,
  createdAtRaw?: string | null,
  updatedAtRaw?: string | null
): boolean {
  const status = String(statusRaw || '').toLowerCase();
  if (status !== 'ringing') return false;
  const basisIso = updatedAtRaw || createdAtRaw;
  if (!basisIso) return false;
  const basisTs = new Date(basisIso).getTime();
  if (!Number.isFinite(basisTs)) return false;
  return Date.now() - basisTs > RINGING_TIMEOUT_MS;
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CallUiState>('idle');
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [jitsiJoinRequest, setJitsiJoinRequest] = useState<JitsiJoinRequest | null>(null);
  const [jitsiMountKey, setJitsiMountKey] = useState(0);
  const [connectionState, setConnectionState] = useState<string>('disconnected');
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);
  const [isScreenShareEnabled, setIsScreenShareEnabled] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [canRetryConnection, setCanRetryConnection] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [isAutoRetrying, setIsAutoRetrying] = useState(false);
  const [selfRole, setSelfRole] = useState<CallSelfRole>('unknown');
  const [localIdentity, setLocalIdentity] = useState<string | null>(null);
  const [remoteParticipantCount, setRemoteParticipantCount] = useState(0);
  const [remoteVideoActive, setRemoteVideoActive] = useState(false);
  const [remoteScreenShareActive, setRemoteScreenShareActive] = useState(false);
  const [callDisplayMode, setCallDisplayMode] = useState<CallDisplayMode>('pip');
  const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>({});
  const [debugTrail, setDebugTrail] = useState<string[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [embeddedCallConversationId, setEmbeddedCallConversationId] = useState<string | null>(null);
  const [embeddedVoiceGroupId, setEmbeddedVoiceGroupId] = useState<string | null>(null);
  const [embeddedVoiceChannelId, setEmbeddedVoiceChannelId] = useState<string | null>(null);
  const [callPinned, setCallPinned] = useState(false);
  const [pinnedCallHostActive, setPinnedCallHostActive] = useState(false);
  const [callHostAnchorEl, setCallHostAnchorEl] = useState<HTMLElement | null>(null);
  const [speakingParticipantId, setSpeakingParticipantId] = useState<string | null>(null);
  const embeddedHostRef = useRef<string | null>(null);
  const embeddedVoiceHostRef = useRef<{ groupId: string; channelId: string } | null>(null);
  const pinnedHostRef = useRef(false);
  const callPinnedRef = useRef(false);

  const jitsiHandleRef = useRef<JitsiHandle | null>(null);
  const jitsiActiveSessionRef = useRef<string | null>(null);
  const localJitsiParticipantIdRef = useRef<string | null>(null);
  const jitsiIdToDisplayNameRef = useRef<Map<string, string>>(new Map());
  const isMutedRef = useRef(false);
  const isCameraEnabledRef = useRef(false);
  const isScreenShareEnabledRef = useRef(false);
  const userMutedManuallyRef = useRef(false);
  const localSpeakingBroadcastRef = useRef(false);
  const lastSpeakingBroadcastAtRef = useRef(0);
  const remoteSpeakingTimeoutRef = useRef<Map<string, number>>(new Map());
  const dominantSpeakerClearTimeoutRef = useRef<number | null>(null);
  const pendingVolumeRef = useRef<Map<string, number>>(new Map());
  const volumeDebounceRef = useRef<Map<string, number>>(new Map());
  const activeCallSessionIdRef = useRef<string | null>(null);
  const endedTimeoutRef = useRef<number | null>(null);
  const participantChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const stateRef = useRef<CallUiState>(state);
  const activeCallRef = useRef<ActiveCall | null>(activeCall);
  const incomingCallRef = useRef<IncomingCall | null>(incomingCall);
  const selfRoleRef = useRef<CallSelfRole>(selfRole);
  const incomingSoundRef = useRef<number | null>(null);
  const outgoingSoundRef = useRef<number | null>(null);
  const retryTimeoutRef = useRef<number | null>(null);
  const incomingPollRef = useRef<number | null>(null);
  const outgoingCallTimeoutRef = useRef<number | null>(null);
  const incomingSessionIdRef = useRef<string | null>(null);
  const lastProcessedEventRef = useRef<Set<string>>(new Set());
  const joinInFlightRef = useRef(false);
  const incomingRingCountRef = useRef(0);
  const outgoingRingCountRef = useRef(0);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);
  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);
  useEffect(() => {
    selfRoleRef.current = selfRole;
  }, [selfRole]);

  const pushDebug = useCallback((message: string) => {
    if (process.env.NODE_ENV !== 'development') return;
    const stamp = new Date().toLocaleTimeString();
    setDebugTrail((prev) => [`${stamp} ${message}`, ...prev].slice(0, 10));
  }, []);

  const isTerminalCallStatus = useCallback((status: string): status is TerminalCallStatus => {
    return ['ended', 'cancelled', 'declined', 'missed'].includes(status);
  }, []);

  const clearEndedState = useCallback(() => {
    if (endedTimeoutRef.current) {
      window.clearTimeout(endedTimeoutRef.current);
      endedTimeoutRef.current = null;
    }
    setErrorMessage(null);
    setCanRetryConnection(false);
    setRetryAttempt(0);
    setIsAutoRetrying(false);
    setSelfRole('unknown');
    setLocalIdentity(null);
    setRemoteParticipantCount(0);
    setCallPinned(false);
    setPinnedCallHostActive(false);
    pinnedHostRef.current = false;
    callPinnedRef.current = false;
    setState('idle');
    pushDebug('state -> idle');
  }, [pushDebug]);

  const moveToEnded = useCallback(() => {
    clearEndedState();
  }, [clearEndedState]);

  const resetMedia = useCallback(async () => {
    premiumCallAudio.release();
    jitsiHandleRef.current?.dispose();
    jitsiHandleRef.current = null;
    jitsiActiveSessionRef.current = null;
    setJitsiJoinRequest(null);

    setConnectionState('disconnected');
    setIsMuted(false);
    setIsCameraEnabled(false);
    setIsScreenShareEnabled(false);
    setCanRetryConnection(false);
    if (retryTimeoutRef.current) {
      window.clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    if (outgoingCallTimeoutRef.current) {
      window.clearTimeout(outgoingCallTimeoutRef.current);
      outgoingCallTimeoutRef.current = null;
    }
    setRetryAttempt(0);
    setIsAutoRetrying(false);
    setLocalIdentity(null);
    setRemoteParticipantCount(0);
    setRemoteVideoActive(false);
    setRemoteScreenShareActive(false);
    setCallDisplayMode('pip');
    setCallPinned(false);
    setPinnedCallHostActive(false);
    pinnedHostRef.current = false;
    callPinnedRef.current = false;
    setParticipantVolumes({});
    setSpeakingParticipantId(null);
    userMutedManuallyRef.current = false;
    localJitsiParticipantIdRef.current = null;
    jitsiIdToDisplayNameRef.current.clear();
    localSpeakingBroadcastRef.current = false;
    for (const timeoutId of remoteSpeakingTimeoutRef.current.values()) {
      window.clearTimeout(timeoutId);
    }
    remoteSpeakingTimeoutRef.current.clear();
    pushDebug('media reset');
  }, [pushDebug]);

  const stopIncomingSound = useCallback(() => {
    if (incomingSoundRef.current) {
      window.clearInterval(incomingSoundRef.current);
      incomingSoundRef.current = null;
    }
    incomingRingCountRef.current = 0;
  }, []);

  const stopOutgoingSound = useCallback(() => {
    if (outgoingSoundRef.current) {
      window.clearInterval(outgoingSoundRef.current);
      outgoingSoundRef.current = null;
    }
    outgoingRingCountRef.current = 0;
  }, []);

  const startIncomingSound = useCallback(() => {
    stopIncomingSound();
    incomingRingCountRef.current = 0;
    incomingSoundRef.current = window.setInterval(() => {
      incomingRingCountRef.current += 1;
      createTone(880, 140, 0.02);
      window.setTimeout(() => createTone(660, 140, 0.02), 170);
      if (incomingRingCountRef.current >= 3) stopIncomingSound();
    }, 1800);
  }, [stopIncomingSound]);

  const startOutgoingSound = useCallback(() => {
    stopOutgoingSound();
    outgoingRingCountRef.current = 0;
    outgoingSoundRef.current = window.setInterval(() => {
      outgoingRingCountRef.current += 1;
      createTone(640, 130, 0.018);
      if (outgoingRingCountRef.current >= 3) stopOutgoingSound();
    }, 900);
  }, [stopOutgoingSound]);

  const connectToJitsi = useCallback(
    async (
      callSessionId: string,
      conversationId?: string | null,
      callType: CallMediaType = 'audio',
      inviteToken?: string,
    ) => {
      if (jitsiActiveSessionRef.current === callSessionId) {
        pushDebug(`join skipped (already active) session=${callSessionId}`);
        return;
      }
      if (joinInFlightRef.current) {
        pushDebug(`join skipped (in-flight) session=${callSessionId}`);
        return;
      }
      joinInFlightRef.current = true;
      try {
        if (jitsiActiveSessionRef.current !== callSessionId) {
          await resetMedia();
        }
        setConnectionState('connecting');
        setErrorMessage(null);
        setCanRetryConnection(false);

        activeCallSessionIdRef.current = callSessionId;
        setJitsiJoinRequest({
          sessionId: callSessionId,
          inviteToken,
          callType,
          conversationId: conversationId ?? null,
        });
        setActiveCall((prev) =>
          prev
            ? {
                ...prev,
                callSessionId,
                conversationId: conversationId ?? prev.conversationId,
                callType,
              }
            : {
                callSessionId,
                conversationId: conversationId ?? null,
                callType,
                participants: [],
              }
        );
        stopIncomingSound();
        stopOutgoingSound();
        pushDebug(`jitsi join pending session=${callSessionId}`);
        jitsiActiveSessionRef.current = callSessionId;
        setState('in_call');
      } finally {
        joinInFlightRef.current = false;
      }
    },
    [pushDebug, resetMedia, stopIncomingSound, stopOutgoingSound]
  );

  const connectToCallMedia = useCallback(
    async (callSessionId: string, conversationId?: string | null, callType: CallMediaType = 'audio') => {
      await connectToJitsi(callSessionId, conversationId, callType);
    },
    [connectToJitsi]
  );

  const startDirectCall = useCallback(
    async (input: StartDirectCallInput) => {
      await ensureMicrophoneForCall();

      clearEndedState();
      setIncomingCall(null);
      setErrorMessage(null);
      setState('calling');
      setSelfRole('host');
      pushDebug(`outgoing call start conversation=${input.conversationId}`);
      startOutgoingSound();
      setActiveCall({
        callSessionId: '',
        conversationId: input.conversationId,
        callType: 'audio',
        participants: [
          { id: input.otherUserId, name: input.otherUserName, avatarUrl: input.otherUserAvatar },
        ],
      });

      try {
          const createPayload = {
            callType: 'audio' as const,
            contextType: 'direct' as const,
            conversationId: input.conversationId,
            participantIds: [input.otherUserId],
          };
          let createResponse: Record<string, unknown> | null = null;
          try {
            createResponse = await api.createCallSession(createPayload);
          } catch (createError: unknown) {
            const createMsg = String((createError as Error)?.message || '');
            if (/409|active call already exists/i.test(createMsg)) {
              const { data: existing } = await supabase
                .from('call_sessions')
                .select('id')
                .eq('conversation_id', input.conversationId)
                .in('status', ['ringing', 'joining', 'active'])
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
              if (existing?.id) {
                const existingId = String(existing.id);
                if (outgoingCallTimeoutRef.current) {
                  window.clearTimeout(outgoingCallTimeoutRef.current);
                  outgoingCallTimeoutRef.current = null;
                }
                activeCallSessionIdRef.current = existingId;
                setActiveCall((prev) => (prev ? { ...prev, callSessionId: existingId } : prev));
                pushDebug(`join existing session=${existingId}`);
                await connectToJitsi(existingId, input.conversationId, 'audio');
                return;
              }
              pushDebug('jitsi create 409 — retry after server cleanup');
              await new Promise((r) => window.setTimeout(r, 400));
              createResponse = await api.createCallSession(createPayload);
            } else {
              throw createError;
            }
          }
          const callSessionId = String(
            createResponse?.sessionId || createResponse?.callSessionId || '',
          );
          if (!callSessionId) throw new Error('Call session id missing in create response');
          activeCallSessionIdRef.current = callSessionId;
          pushDebug(`jitsi outgoing created session=${callSessionId}`);
          setActiveCall((prev) => (prev ? { ...prev, callSessionId } : prev));

          outgoingCallTimeoutRef.current = window.setTimeout(async () => {
            if (activeCallSessionIdRef.current !== callSessionId) return;
            try {
              await api.endCallSession(callSessionId);
            } catch {
              // best effort
            } finally {
              await resetMedia();
              setIncomingCall(null);
              incomingSessionIdRef.current = null;
              setActiveCall(null);
              activeCallSessionIdRef.current = null;
              stopIncomingSound();
              stopOutgoingSound();
              setErrorMessage(i18n.t('call.noAnswerEnded'));
              moveToEnded();
            }
          }, RINGING_TIMEOUT_MS);
      } catch (error: unknown) {
        joinInFlightRef.current = false;
        const staleSessionId = activeCallSessionIdRef.current;
        if (staleSessionId) {
          try {
            await api.endCallSession(staleSessionId);
          } catch {
            // best effort — server may already have cleared it
          }
        }
        console.error('Failed to create call:', error);
        const uiError = toUserFacingCallError(error);
        toast.error('Call failed', uiError);
        setErrorMessage(uiError);
        setActiveCall(null);
        stopOutgoingSound();
        pushDebug(`outgoing call failed: ${(error as Error)?.message || 'unknown'}`);
        moveToEnded();
      }
    },
    [
      clearEndedState,
      connectToJitsi,
      moveToEnded,
      pushDebug,
      resetMedia,
      startOutgoingSound,
      stopIncomingSound,
      stopOutgoingSound,
    ]
  );

  const joinVoiceChannel = useCallback(
    async (input: JoinVoiceChannelInput) => {
      await ensureMicrophoneForCall();

      clearEndedState();
      setIncomingCall(null);
      setErrorMessage(null);
      stopIncomingSound();
      stopOutgoingSound();

      if (
        activeCall?.isVoiceChannel &&
        activeCall.channelId &&
        activeCall.channelId !== input.channelId
      ) {
        try {
          await api.leaveVoiceChannel(activeCall.groupId!, activeCall.channelId);
        } catch {
          // best effort
        }
        await resetMedia();
      }

      try {
        const response = await api.joinVoiceChannel(input.groupId, input.channelId, 'audio');
        const sessionId = String(response?.sessionId || response?.callSessionId || '');
        if (!sessionId) throw new Error('Voice session id missing');

        setSelfRole('participant');
        setCallDisplayMode('embedded');
        setActiveCall({
          callSessionId: sessionId,
          groupId: input.groupId,
          channelId: input.channelId,
          channelName: input.channelName,
          groupName: input.groupName,
          isVoiceChannel: true,
          callType: 'audio',
          participants: [],
        });
        activeCallSessionIdRef.current = sessionId;
        pushDebug(`voice channel join session=${sessionId} channel=${input.channelId}`);
        await connectToJitsi(sessionId, null, 'audio');
      } catch (error: unknown) {
        console.error('Failed to join voice channel:', error);
        toast.error('Voice channel', toUserFacingCallError(error));
        setErrorMessage(toUserFacingCallError(error));
        moveToEnded();
      }
    },
    [
      activeCall?.channelId,
      activeCall?.groupId,
      activeCall?.isVoiceChannel,
      clearEndedState,
      connectToJitsi,
      moveToEnded,
      pushDebug,
      resetMedia,
      stopIncomingSound,
      stopOutgoingSound,
    ]
  );

  const navigateToConversation = useCallback((conversationId: string) => {
    window.dispatchEvent(
      new CustomEvent('navigate-to-conversation', { detail: { conversationId } })
    );
  }, []);

  const enterCallPip = useCallback((force = false) => {
    if (callPinnedRef.current && !force) return;
    setCallDisplayMode('pip');
  }, []);

  const toggleCallPinned = useCallback(() => {
    const next = !callPinnedRef.current;
    callPinnedRef.current = next;
    setCallPinned(next);
    if (next && state === 'in_call') {
      embeddedHostRef.current = null;
      embeddedVoiceHostRef.current = null;
      setEmbeddedCallConversationId(null);
      setEmbeddedVoiceGroupId(null);
      setEmbeddedVoiceChannelId(null);
      pinnedHostRef.current = true;
      setPinnedCallHostActive(true);
      setCallDisplayMode('embedded');
      return;
    }
    if (!next && state === 'in_call') {
      pinnedHostRef.current = false;
      setPinnedCallHostActive(false);
    }
  }, [state]);

  useEffect(() => {
    callPinnedRef.current = callPinned;
  }, [callPinned]);

  useLayoutEffect(() => {
    if (callPinned && state === 'in_call' && callDisplayMode === 'pip') {
      setCallDisplayMode('embedded');
    }
  }, [callDisplayMode, callPinned, state]);

  useEffect(() => {
    if (
      callPinnedRef.current ||
      callPinned ||
      state !== 'in_call' ||
      callDisplayMode !== 'embedded'
    ) {
      return;
    }

    const hasNativeDm =
      !!activeCall?.conversationId &&
      embeddedCallConversationId === activeCall.conversationId;
    const hasNativeVoice =
      !!activeCall?.isVoiceChannel &&
      embeddedVoiceGroupId === activeCall.groupId &&
      embeddedVoiceChannelId === activeCall.channelId;

    if (!hasNativeDm && !hasNativeVoice && !pinnedCallHostActive) {
      setCallDisplayMode('pip');
    }
  }, [
    activeCall?.channelId,
    activeCall?.conversationId,
    activeCall?.groupId,
    activeCall?.isVoiceChannel,
    callDisplayMode,
    callPinned,
    embeddedCallConversationId,
    embeddedVoiceChannelId,
    embeddedVoiceGroupId,
    pinnedCallHostActive,
    state,
  ]);

  const expandCallToFullscreen = useCallback(() => {
    setCallDisplayMode('fullscreen');
  }, []);

  const minimizeCallFromFullscreen = useCallback(() => {
    if (embeddedCallConversationId === activeCall?.conversationId) {
      setCallDisplayMode('embedded');
    } else if (
      callPinned ||
      pinnedCallHostActive ||
      (activeCall?.isVoiceChannel &&
        embeddedVoiceGroupId === activeCall.groupId &&
        embeddedVoiceChannelId === activeCall.channelId)
    ) {
      setCallDisplayMode('embedded');
    } else {
      setCallDisplayMode('pip');
    }
  }, [
    activeCall?.channelId,
    activeCall?.conversationId,
    activeCall?.groupId,
    activeCall?.isVoiceChannel,
    callPinned,
    embeddedCallConversationId,
    embeddedVoiceChannelId,
    embeddedVoiceGroupId,
    pinnedCallHostActive,
  ]);

  const navigateToGroupVoice = useCallback(
    (
      groupId: string,
      channelId: string,
      channelName?: string | null,
      groupName?: string | null
    ) => {
      window.dispatchEvent(
        new CustomEvent('navigate-to-group-voice', {
          detail: { groupId, channelId, channelName, groupName },
        })
      );
    },
    []
  );

  const openCallInChat = useCallback(() => {
    const conversationId = activeCall?.conversationId;
    if (!conversationId) return;
    navigateToConversation(conversationId);
    setCallDisplayMode('embedded');
  }, [activeCall?.conversationId, navigateToConversation]);

  const openCallInGroupPanel = useCallback(() => {
    const groupId = activeCall?.groupId;
    const channelId = activeCall?.channelId;
    if (!activeCall?.isVoiceChannel || !groupId || !channelId) return;
    navigateToGroupVoice(
      groupId,
      channelId,
      activeCall.channelName,
      activeCall.groupName
    );
    setCallDisplayMode('embedded');
  }, [
    activeCall?.channelId,
    activeCall?.channelName,
    activeCall?.groupId,
    activeCall?.groupName,
    activeCall?.isVoiceChannel,
    navigateToGroupVoice,
  ]);

  const openCallInPanel = useCallback(() => {
    if (callPinnedRef.current) {
      setCallDisplayMode('embedded');
      return;
    }
    if (activeCall?.isVoiceChannel) {
      openCallInGroupPanel();
      return;
    }
    openCallInChat();
  }, [activeCall?.isVoiceChannel, openCallInChat, openCallInGroupPanel]);

  const acceptIncomingCall = useCallback(async () => {
    if (!incomingCall) return;

    const sessionId = incomingCall.callSessionId;
    const conversationId = incomingCall.conversationId;
    const caller = incomingCall.caller;

    stopIncomingSound();
    setIncomingCall(null);
    incomingSessionIdRef.current = null;
    setSelfRole('participant');
    setActiveCall({
      callSessionId: sessionId,
      conversationId,
      callType: 'audio',
      participants: [
        {
          id: caller.id,
          name: caller.name,
          avatarUrl: caller.avatarUrl,
        },
      ],
    });
    setState('in_call');
    if (conversationId && embeddedHostRef.current === conversationId) {
      setCallDisplayMode('embedded');
    } else {
      setCallDisplayMode('pip');
    }
    pushDebug(`incoming accepted session=${sessionId}`);

    const micPromise = ensureMicrophoneForCall();
    const joinPromise = connectToCallMedia(sessionId, conversationId, 'audio');
    const acceptPromise = api
      .acceptCall(sessionId, 'accept')
      .catch((error) => {
        if (!isStaleAcceptCallError(error)) throw error;
        pushDebug(`accept ignored stale state session=${sessionId}`);
      });

    try {
      await Promise.all([micPromise, joinPromise, acceptPromise]);
    } catch (error: unknown) {
      joinInFlightRef.current = false;
      console.error('Failed to accept call:', error);
      const uiError = toUserFacingCallError(error);
      toast.error('Accept failed', uiError);
      setErrorMessage(uiError);
      setIncomingCall(null);
      incomingSessionIdRef.current = null;
      stopIncomingSound();
      pushDebug(`accept failed: ${(error as Error)?.message || 'unknown'}`);
      moveToEnded();
    }
  }, [connectToCallMedia, incomingCall, moveToEnded, pushDebug, stopIncomingSound]);

  const declineIncomingCall = useCallback(async () => {
    if (!incomingCall) return;
    try {
      await api.acceptCall(incomingCall.callSessionId, 'decline');
    } catch (error) {
      console.warn('Decline call failed:', error);
    } finally {
      setIncomingCall(null);
      incomingSessionIdRef.current = null;
      stopIncomingSound();
      pushDebug(`incoming declined session=${incomingCall.callSessionId}`);
      moveToEnded();
    }
  }, [incomingCall, moveToEnded, pushDebug, stopIncomingSound]);
  const hangUp = useCallback(async () => {
    const sessionId = activeCall?.callSessionId || activeCallSessionIdRef.current;
    const voiceChannelLeave =
      activeCall?.isVoiceChannel && activeCall.groupId && activeCall.channelId
        ? { groupId: activeCall.groupId, channelId: activeCall.channelId }
        : null;

    if (voiceChannelLeave) {
      try {
        await api.leaveVoiceChannel(voiceChannelLeave.groupId, voiceChannelLeave.channelId);
      } catch (error) {
        console.warn('Leave voice channel failed:', error);
      }
      await resetMedia();
      setIncomingCall(null);
      incomingSessionIdRef.current = null;
      setActiveCall(null);
      activeCallSessionIdRef.current = null;
      jitsiActiveSessionRef.current = null;
      setJitsiJoinRequest(null);
      setSelfRole('unknown');
      stopIncomingSound();
      stopOutgoingSound();
      setErrorMessage(null);
      setCanRetryConnection(false);
      pushDebug(`voice channel leave session=${sessionId || 'none'}`);
      moveToEnded();
      return;
    }

    if (sessionId) {
      const isDirectConversation =
        Boolean(activeCall?.conversationId) &&
        !activeCall?.isVoiceChannel &&
        !activeCall?.groupId;
      try {
        if (isDirectConversation) {
          await api.leaveCallParticipant(sessionId);
        } else if (selfRoleRef.current === 'host') {
          await api.endCallSession(sessionId);
        } else {
          await api.leaveCallParticipant(sessionId);
        }
      } catch (error) {
        console.warn('Leave/end call failed:', error);
      }
    }

    await resetMedia();
    setIncomingCall(null);
    incomingSessionIdRef.current = null;
    setActiveCall(null);
    activeCallSessionIdRef.current = null;
    jitsiActiveSessionRef.current = null;
    setJitsiJoinRequest(null);
    setSelfRole('unknown');
    stopIncomingSound();
    stopOutgoingSound();
    setErrorMessage(null);
    setCanRetryConnection(false);
    pushDebug(`hangup session=${sessionId || 'none'} role=${selfRoleRef.current}`);
    moveToEnded();
  }, [
    activeCall?.callSessionId,
    activeCall?.channelId,
    activeCall?.groupId,
    activeCall?.isVoiceChannel,
    moveToEnded,
    pushDebug,
    resetMedia,
    stopIncomingSound,
    stopOutgoingSound,
  ]);

  const leaveVoiceChannel = useCallback(async () => {
    if (!activeCall?.isVoiceChannel || !activeCall.groupId || !activeCall.channelId) return;
    try {
      await api.leaveVoiceChannel(activeCall.groupId, activeCall.channelId);
    } catch (error) {
      console.warn('Leave voice channel failed:', error);
    }
    await resetMedia();
    setActiveCall(null);
    activeCallSessionIdRef.current = null;
    jitsiActiveSessionRef.current = null;
    setJitsiJoinRequest(null);
    setSelfRole('unknown');
    stopIncomingSound();
    stopOutgoingSound();
    moveToEnded();
  }, [activeCall, moveToEnded, resetMedia, stopIncomingSound, stopOutgoingSound]);

  const toggleMute = useCallback(async () => {
    const handle = jitsiHandleRef.current;
    if (!handle) return;
    const nextMuted = !handle.isAudioMuted();
    userMutedManuallyRef.current = nextMuted;
    handle.setUserRequestedAudioMute(nextMuted);
    handle.setAudioMuted(nextMuted);
    setIsMuted(nextMuted);
  }, [isMuted]);

  const toggleCamera = useCallback(async () => {
    const handle = jitsiHandleRef.current;
    if (!handle) return;
    handle.toggleVideo();
    setIsCameraEnabled(!handle.isVideoMuted());
  }, [isCameraEnabled]);

  const toggleScreenShare = useCallback(() => {
    const handle = jitsiHandleRef.current;
    if (!handle) return;
    if (!isScreenShareEnabled && !isScreenShareSupported()) {
      toast.error(i18n.t('call.screenShareUnsupported'));
      return;
    }
    handle.toggleScreenShare();
  }, [isScreenShareEnabled]);

  const joinCallViaInvite = useCallback(
    async (sessionId: string, inviteToken: string) => {
      clearEndedState();
      setErrorMessage(null);
      setSelfRole('participant');
      await connectToJitsi(sessionId, null, 'audio', inviteToken);
    },
    [clearEndedState, connectToJitsi]
  );

  const retryConnection = useCallback(async () => {
    const sessionId = activeCallSessionIdRef.current || activeCall?.callSessionId;
    if (!sessionId) return;
    try {
      setIsAutoRetrying(false);
      setErrorMessage(null);
      pushDebug(`manual retry session=${sessionId}`);
      setConnectionState('connecting');
      setCanRetryConnection(false);
      setJitsiMountKey((prev) => prev + 1);
    } catch (error: unknown) {
      setCanRetryConnection(true);
      setErrorMessage(toUserFacingCallError(error));
      pushDebug(`manual retry failed: ${(error as Error)?.message || 'unknown'}`);
    }
  }, [
    activeCall?.callSessionId,
    pushDebug,
  ]);

  const resolveCallerFromSession = useCallback(async (sessionRow: { creator_id?: string }) => {
    const callerId = sessionRow?.creator_id;
    if (!callerId) return { id: 'unknown', name: 'Incoming caller' };

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, display_name, name, avatar_url, images')
      .eq('id', callerId)
      .maybeSingle();

    return {
      id: callerId,
      name: profile?.display_name || profile?.name || 'Incoming caller',
      avatarUrl: getOptimizedImageUrl(profile?.avatar_url || profile?.images?.[0] || '', 200),
    };
  }, []);

  const maybeShowIncoming = useCallback(
    async (callSessionId: string) => {
      if (!callSessionId) return;
      if (activeCallSessionIdRef.current === callSessionId || state === 'in_call') return;
      if (incomingSessionIdRef.current === callSessionId && incomingCall) return;

      const { data: sessionRow } = await supabase
        .from('call_sessions')
        .select('id, conversation_id, creator_id, status, created_at, updated_at')
        .eq('id', callSessionId)
        .maybeSingle();

      if (sessionRow && isTerminalCallStatus(String(sessionRow.status || '').toLowerCase())) {
        return;
      }
      if (
        sessionRow &&
        isExpiredRingingSession(
          sessionRow.status,
          sessionRow.created_at ?? null,
          sessionRow.updated_at ?? null
        )
      ) {
        try {
          await api.acceptCall(callSessionId, 'missed');
        } catch {
          // best effort
        }
        return;
      }

      const caller = sessionRow
        ? await resolveCallerFromSession(sessionRow)
        : { id: 'unknown', name: 'Incoming caller' };

      setIncomingCall({
        callSessionId,
        conversationId: sessionRow?.conversation_id ?? null,
        caller,
      });
      incomingSessionIdRef.current = callSessionId;
      startIncomingSound();
      setState('incoming');
      pushDebug(`incoming surfaced session=${callSessionId}`);
    },
    [incomingCall, isTerminalCallStatus, pushDebug, resolveCallerFromSession, startIncomingSound, state]
  );

  const handleJitsiReady = useCallback((handle: JitsiHandle) => {
    if (jitsiHandleRef.current === handle) {
      return;
    }
    if (jitsiHandleRef.current && jitsiHandleRef.current !== handle) {
      jitsiHandleRef.current.dispose();
    }
    jitsiHandleRef.current = handle;
    userMutedManuallyRef.current = false;
    handle.setUserRequestedAudioMute(false);
    setIsCameraEnabled(!handle.isVideoMuted());
    setConnectionState('connected');
    setCanRetryConnection(false);
    setErrorMessage(null);
  }, []);

  const handleJitsiJoinResolved = useCallback(
    (credentials: JitsiJoinCredentials) => {
      setLocalIdentity(credentials.displayName);
      setActiveCall((prev) =>
        prev
          ? {
              ...prev,
              callSessionId: credentials.sessionId,
              callType: credentials.callType || prev.callType,
            }
          : prev
      );
      pushDebug(`jitsi join authorized session=${credentials.sessionId}`);
    },
    [pushDebug]
  );

  const handleJitsiJoinError = useCallback(
    (error: unknown) => {
      jitsiHandleRef.current?.dispose();
      jitsiHandleRef.current = null;
      setJitsiJoinRequest(null);
      const uiError = toUserFacingCallError(error);
      toast.error('Join failed', uiError);
      setErrorMessage(uiError);
      setCanRetryConnection(true);
      setConnectionState('disconnected');
      stopOutgoingSound();
      pushDebug(`jitsi join failed: ${(error as Error)?.message || 'unknown'}`);
      moveToEnded();
    },
    [moveToEnded, pushDebug, stopOutgoingSound]
  );

  const handleJitsiConnectionEstablished = useCallback(() => {
    userMutedManuallyRef.current = false;
    jitsiHandleRef.current?.setUserRequestedAudioMute(false);
    setConnectionState('connected');
    setCanRetryConnection(false);
    setErrorMessage(null);
    if (outgoingCallTimeoutRef.current) {
      window.clearTimeout(outgoingCallTimeoutRef.current);
      outgoingCallTimeoutRef.current = null;
    }
  }, []);

  const handleJitsiReadyToClose = useCallback(() => {
    void hangUp();
  }, [hangUp]);

  const handleJitsiScreenShareChanged = useCallback((active: boolean) => {
    setIsScreenShareEnabled(active);
    isScreenShareEnabledRef.current = active;
    jitsiHandleRef.current?.broadcastMediaState(isCameraEnabledRef.current, active);
  }, []);

  const handleJitsiScreenShareError = useCallback((code: string) => {
    if (code === 'SCREEN_SHARE_UNSUPPORTED') {
      toast.error(i18n.t('call.screenShareUnsupported'));
      return;
    }
    if (code === 'SCREEN_SHARE_DENIED') {
      toast.error(i18n.t('call.screenShareDenied'));
      return;
    }
    toast.error(i18n.t('call.screenShareFailed'));
  }, []);

  const resolveSpeakingParticipantId = useCallback(
    (jitsiParticipantId: string | null): string | null => {
      if (!jitsiParticipantId) return null;
      if (jitsiParticipantId === localJitsiParticipantIdRef.current) return '__local__';

      const remotes = activeCall?.participants ?? [];
      const byJitsiId = remotes.find(
        (participant) => participant.jitsiParticipantId === jitsiParticipantId,
      );
      if (byJitsiId) return byJitsiId.id;

      const displayName = jitsiIdToDisplayNameRef.current.get(jitsiParticipantId);
      if (displayName) {
        const byName = remotes.find(
          (participant) =>
            participant.name === displayName ||
            participant.name.toLowerCase() === displayName.toLowerCase(),
        );
        if (byName) return byName.id;
      }

      // 1:1 calls: any remote Jitsi id is the single callee/caller.
      if (remotes.length === 1) return remotes[0].id;

      return null;
    },
    [activeCall?.participants]
  );

  const markRemoteSpeaking = useCallback(
    (partyId: string) => {
      setSpeakingParticipantId(partyId);

      const existing = remoteSpeakingTimeoutRef.current.get(partyId);
      if (existing) window.clearTimeout(existing);
      const timeoutId = window.setTimeout(() => {
        setSpeakingParticipantId((prev) => (prev === partyId ? null : prev));
        remoteSpeakingTimeoutRef.current.delete(partyId);
      }, 900);
      remoteSpeakingTimeoutRef.current.set(partyId, timeoutId);
    },
    []
  );

  const handleJitsiDominantSpeakerChanged = useCallback(
    (jitsiParticipantId: string | null) => {
      if (dominantSpeakerClearTimeoutRef.current) {
        window.clearTimeout(dominantSpeakerClearTimeoutRef.current);
        dominantSpeakerClearTimeoutRef.current = null;
      }

      if (!jitsiParticipantId) {
        dominantSpeakerClearTimeoutRef.current = window.setTimeout(() => {
          setSpeakingParticipantId((prev) => (prev === '__local__' ? prev : null));
        }, 500);
        return;
      }

      if (jitsiParticipantId === localJitsiParticipantIdRef.current) return;

      const partyId = resolveSpeakingParticipantId(jitsiParticipantId);
      if (!partyId || partyId === '__local__') return;

      markRemoteSpeaking(partyId);

      setActiveCall((prev) => {
        if (!prev) return prev;
        const nextParticipants = prev.participants.map((participant) =>
          participant.id === partyId
            ? { ...participant, jitsiParticipantId: jitsiParticipantId }
            : participant,
        );
        return { ...prev, participants: nextParticipants };
      });
    },
    [markRemoteSpeaking, resolveSpeakingParticipantId]
  );

  const handleJitsiRemoteSpeakingChanged = useCallback(
    (payload: { participantId?: string; speaking: boolean; levelDb: number }) => {
      const partyId = resolveSpeakingParticipantId(payload.participantId ?? null);
      if (!partyId || partyId === '__local__') return;

      if (payload.speaking) {
        markRemoteSpeaking(partyId);
        return;
      }

      setSpeakingParticipantId((prev) => (prev === partyId ? null : prev));
      const existing = remoteSpeakingTimeoutRef.current.get(partyId);
      if (existing) {
        window.clearTimeout(existing);
        remoteSpeakingTimeoutRef.current.delete(partyId);
      }
    },
    [markRemoteSpeaking, resolveSpeakingParticipantId]
  );

  const handleJitsiConferenceJoined = useCallback(
    (payload: { id?: string; displayName?: string }) => {
      if (payload.id) {
        localJitsiParticipantIdRef.current = payload.id;
        if (payload.displayName) {
          jitsiIdToDisplayNameRef.current.set(payload.id, payload.displayName);
        }
      }
    },
    []
  );

  const handleJitsiRemoteParticipantJoined = useCallback(
    (payload: { id?: string; displayName?: string }) => {
      const displayName = payload.displayName?.trim();
      if (!displayName) return;

      if (
        payload.id &&
        localJitsiParticipantIdRef.current &&
        payload.id === localJitsiParticipantIdRef.current
      ) {
        return;
      }

      const localName = localIdentity?.trim().toLowerCase();
      if (localName && displayName.toLowerCase() === localName) {
        return;
      }

      if (payload.id) {
        jitsiIdToDisplayNameRef.current.set(payload.id, displayName);
      }

      setActiveCall((prev) => {
        if (!prev) return prev;

        const incoming: CallParty = {
          id: payload.id || displayName,
          name: displayName,
          jitsiParticipantId: payload.id,
        };

        return {
          ...prev,
          participants: mergeCallParticipants(prev.participants, incoming),
        };
      });

      if (isCameraEnabledRef.current || isScreenShareEnabledRef.current) {
        jitsiHandleRef.current?.broadcastMediaState(
          isCameraEnabledRef.current,
          isScreenShareEnabledRef.current
        );
      }
    },
    [localIdentity]
  );

  const handleJitsiRemoteMediaChanged = useCallback(
    (state: { remoteVideoActive: boolean; remoteScreenShareActive: boolean }) => {
      if (state.remoteVideoActive) {
        setRemoteVideoActive(true);
      }
      if (state.remoteScreenShareActive) {
        setRemoteScreenShareActive(true);
      }
      if (!state.remoteVideoActive && !state.remoteScreenShareActive) {
        setRemoteVideoActive(false);
        setRemoteScreenShareActive(false);
      }
      if (!state.remoteVideoActive && !state.remoteScreenShareActive) return;
      const remoteIds = jitsiHandleRef.current?.getRemoteParticipantIds() ?? [];
      const participantId = remoteIds[0];
      if (!participantId) return;
      if (state.remoteScreenShareActive) {
        jitsiHandleRef.current?.focusRemoteParticipant(participantId, 'desktop');
      } else {
        jitsiHandleRef.current?.focusRemoteParticipant(participantId, 'camera');
      }
    },
    []
  );

  const handleJitsiRemoteMediaSync = useCallback(
    (payload: { participantId?: string; camera: boolean; screenShare: boolean }) => {
      if (payload.camera || payload.screenShare) {
        setRemoteVideoActive(true);
        if (payload.screenShare) {
          setRemoteScreenShareActive(true);
        }
      }
      if (!payload.participantId) return;
      if (payload.screenShare) {
        jitsiHandleRef.current?.focusRemoteParticipant(payload.participantId, 'desktop');
      } else if (payload.camera) {
        jitsiHandleRef.current?.focusRemoteParticipant(payload.participantId, 'camera');
      }
    },
    []
  );

  const applyParticipantVolumeToJitsi = useCallback(
    (participantId: string, volume: number) => {
      const party = activeCall?.participants.find((participant) => participant.id === participantId);
      const jitsiParticipantId =
        party?.jitsiParticipantId ||
        [...jitsiIdToDisplayNameRef.current.entries()].find(
          ([, displayName]) => displayName === party?.name
        )?.[0];

      if (jitsiParticipantId) {
        jitsiHandleRef.current?.setParticipantVolume(jitsiParticipantId, volume);
      }
    },
    [activeCall?.participants]
  );

  const setParticipantVolume = useCallback(
    (participantId: string, volume: number) => {
      const clamped = Math.max(0, Math.min(1, volume));
      pendingVolumeRef.current.set(participantId, clamped);
      setParticipantVolumes((prev) => ({ ...prev, [participantId]: clamped }));

      const existing = volumeDebounceRef.current.get(participantId);
      if (existing) window.clearTimeout(existing);

      const timeoutId = window.setTimeout(() => {
        volumeDebounceRef.current.delete(participantId);
        const pending = pendingVolumeRef.current.get(participantId);
        if (pending === undefined) return;
        applyParticipantVolumeToJitsi(participantId, pending);
      }, 80);
      volumeDebounceRef.current.set(participantId, timeoutId);
    },
    [applyParticipantVolumeToJitsi]
  );

  const registerEmbeddedCallHost = useCallback((conversationId: string | null) => {
    if (callPinnedRef.current) return;

    embeddedHostRef.current = conversationId;
    setEmbeddedCallConversationId(conversationId);
    if (
      conversationId &&
      activeCall?.conversationId === conversationId &&
      state === 'in_call'
    ) {
      setCallDisplayMode((mode) => (mode === 'pip' || mode === 'fullscreen' ? mode : 'embedded'));
      return;
    }
    if (
      !conversationId &&
      state === 'in_call' &&
      !activeCall?.isVoiceChannel &&
      !callPinnedRef.current
    ) {
      setCallDisplayMode((mode) => (mode === 'fullscreen' ? mode : 'pip'));
    }
  }, [activeCall?.conversationId, activeCall?.isVoiceChannel, state]);

  const registerEmbeddedVoiceHost = useCallback(
    (groupId: string | null, channelId: string | null) => {
      if (callPinnedRef.current) return;

      embeddedVoiceHostRef.current =
        groupId && channelId ? { groupId, channelId } : null;
      setEmbeddedVoiceGroupId(groupId);
      setEmbeddedVoiceChannelId(channelId);
      if (
        groupId &&
        channelId &&
        activeCall?.isVoiceChannel &&
        activeCall.groupId === groupId &&
        activeCall.channelId === channelId &&
        state === 'in_call'
      ) {
        setCallDisplayMode((mode) => (mode === 'pip' || mode === 'fullscreen' ? mode : 'embedded'));
        return;
      }
      if (
        (!groupId || !channelId) &&
        state === 'in_call' &&
        activeCall?.isVoiceChannel &&
        !callPinnedRef.current
      ) {
        setCallDisplayMode((mode) => (mode === 'fullscreen' ? mode : 'pip'));
      }
    },
    [activeCall?.channelId, activeCall?.groupId, activeCall?.isVoiceChannel, state]
  );

  const registerPinnedCallHost = useCallback(
    (active: boolean) => {
      if (!active && callPinnedRef.current) return;
      pinnedHostRef.current = active;
      setPinnedCallHostActive(active);
      if (active && state === 'in_call' && callPinnedRef.current) {
        setCallDisplayMode('embedded');
      }
    },
    [state]
  );

  const registerCallHostAnchor = useCallback((element: HTMLElement | null) => {
    setCallHostAnchorEl(element);
  }, []);

  useEffect(() => {
    if (state !== 'in_call') {
      setCallHostAnchorEl(null);
    }
  }, [state]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    isCameraEnabledRef.current = isCameraEnabled;
  }, [isCameraEnabled]);

  useEffect(() => {
    isScreenShareEnabledRef.current = isScreenShareEnabled;
  }, [isScreenShareEnabled]);

  useEffect(() => {
    if (state !== 'in_call' || (!isCameraEnabled && !isScreenShareEnabled)) return;
    jitsiHandleRef.current?.broadcastMediaState(
      isCameraEnabledRef.current,
      isScreenShareEnabledRef.current
    );
    const intervalId = window.setInterval(() => {
      jitsiHandleRef.current?.broadcastMediaState(
        isCameraEnabledRef.current,
        isScreenShareEnabledRef.current
      );
    }, 2500);
    return () => window.clearInterval(intervalId);
  }, [isCameraEnabled, isScreenShareEnabled, state]);

  useEffect(() => {
    let mounted = true;
    if (mounted) {
      setCurrentUserId(getCachedUser()?.id ?? null);
    }

    const unsubscribe = subscribeAuth((_event, session) => {
      if (!mounted) return;
      setCurrentUserId(session?.user?.id ?? null);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const maybeShowIncomingRef = useRef(maybeShowIncoming);
  maybeShowIncomingRef.current = maybeShowIncoming;
  const connectToJitsiRef = useRef(connectToJitsi);
  connectToJitsiRef.current = connectToJitsi;
  const handleJitsiJoinErrorRef = useRef(handleJitsiJoinError);
  handleJitsiJoinErrorRef.current = handleJitsiJoinError;

  useEffect(() => {
    if (!currentUserId) return;

    const terminalStatuses = new Set(['ended', 'cancelled', 'declined', 'missed']);

    participantChannelRef.current = supabase
      .channel(`call-participants:${currentUserId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'call_participants',
          filter: `user_id=eq.${currentUserId}`,
        },
        async (payload) => {
          const row = (payload.new || payload.old) as {
            call_session_id?: string;
            invite_status?: string;
            role?: string;
            user_id?: string;
            updated_at?: string;
          };
          if (!row?.call_session_id) return;

          const status = String(row.invite_status || '').toLowerCase();
          const eventKey = `${payload.eventType}:${row.call_session_id}:${status}:${row.updated_at || ''}`;
          if (lastProcessedEventRef.current.has(eventKey)) return;
          lastProcessedEventRef.current.add(eventKey);
          if (lastProcessedEventRef.current.size > 200) {
            lastProcessedEventRef.current.clear();
          }

          const { data: sessionRow } = await supabase
            .from('call_sessions')
            .select('id, conversation_id, creator_id, status')
            .eq('id', row.call_session_id)
            .maybeSingle();

          const sessionStatus = String(sessionRow?.status || '').toLowerCase();
          if (sessionRow && terminalStatuses.has(sessionStatus)) {
            if (incomingSessionIdRef.current === row.call_session_id) {
              setIncomingCall(null);
              incomingSessionIdRef.current = null;
              stopIncomingSound();
            }
            if (activeCallSessionIdRef.current === row.call_session_id) {
              await resetMedia();
              setActiveCall(null);
              activeCallSessionIdRef.current = null;
              moveToEnded();
            }
            return;
          }

          if (status === 'pending' && row.user_id === currentUserId) {
            await maybeShowIncomingRef.current(row.call_session_id);
            return;
          }

          if (
            status === 'accepted' &&
            isJitsiCallProvider() &&
            activeCallSessionIdRef.current === row.call_session_id &&
            stateRef.current === 'calling' &&
            sessionRow?.creator_id === currentUserId
          ) {
            try {
              await connectToJitsiRef.current(
                row.call_session_id,
                sessionRow.conversation_id ?? activeCallRef.current?.conversationId,
                activeCallRef.current?.callType || 'audio'
              );
            } catch (error: unknown) {
              handleJitsiJoinErrorRef.current(error);
            }
            return;
          }

          if (['declined', 'missed', 'left', 'removed'].includes(status)) {
            if (
              activeCallSessionIdRef.current === row.call_session_id ||
              incomingCallRef.current?.callSessionId === row.call_session_id
            ) {
              setIncomingCall(null);
              incomingSessionIdRef.current = null;
              setActiveCall(null);
              activeCallSessionIdRef.current = null;
              await resetMedia();
              stopIncomingSound();
              stopOutgoingSound();
              moveToEnded();
            }
          }
        }
      )
      .subscribe();

    return () => {
      if (participantChannelRef.current) {
        supabase.removeChannel(participantChannelRef.current);
        participantChannelRef.current = null;
      }
    };
  }, [currentUserId, moveToEnded, resetMedia, stopIncomingSound, stopOutgoingSound]);

  const sessionChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    const sessionId = activeCall?.callSessionId || activeCallSessionIdRef.current;
    if (!sessionId || !currentUserId) return;
    if (!['calling', 'incoming', 'in_call'].includes(state)) return;

    const terminalStatuses = new Set(['ended', 'cancelled', 'declined', 'missed']);

    const cleanupLocalCall = async () => {
      if (
        activeCallSessionIdRef.current !== sessionId &&
        incomingSessionIdRef.current !== sessionId
      ) {
        return;
      }
      setIncomingCall(null);
      incomingSessionIdRef.current = null;
      setActiveCall(null);
      activeCallSessionIdRef.current = null;
      await resetMedia();
      stopIncomingSound();
      stopOutgoingSound();
      clearEndedState();
    };

    sessionChannelRef.current = supabase
      .channel(`call-session-active:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'call_sessions',
          filter: `id=eq.${sessionId}`,
        },
        async (payload) => {
          const status = String(
            (payload.new as { status?: string } | undefined)?.status || ''
          ).toLowerCase();
          if (terminalStatuses.has(status)) {
            await cleanupLocalCall();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'call_participants',
          filter: `call_session_id=eq.${sessionId}`,
        },
        async (payload) => {
          const row = payload.new as {
            user_id?: string;
            invite_status?: string;
            left_at?: string | null;
          };
          if (!row?.user_id || row.user_id === currentUserId) return;
          const inviteStatus = String(row.invite_status || '').toLowerCase();
          if (row.left_at || ['declined', 'missed', 'left', 'removed'].includes(inviteStatus)) {
            await cleanupLocalCall();
          }
        }
      )
      .subscribe();

    return () => {
      if (sessionChannelRef.current) {
        supabase.removeChannel(sessionChannelRef.current);
        sessionChannelRef.current = null;
      }
    };
  }, [
    activeCall?.callSessionId,
    clearEndedState,
    currentUserId,
    resetMedia,
    state,
    stopIncomingSound,
    stopOutgoingSound,
  ]);

  useEffect(() => {
    if (!currentUserId || state === 'in_call') return;

    const pollIncoming = async () => {
      if (stateRef.current === 'in_call' || stateRef.current === 'incoming') return;

      const { data: pendingRows, error } = await supabase
        .from('call_participants')
        .select('call_session_id, invite_status, left_at')
        .eq('user_id', currentUserId)
        .eq('invite_status', 'pending')
        .is('left_at', null)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (error || !pendingRows?.length) return;

      const sessionId = pendingRows[0].call_session_id;
      const { data: sessionRow } = await supabase
        .from('call_sessions')
        .select('status, created_at, updated_at')
        .eq('id', sessionId)
        .maybeSingle();

      const sessionStatus = String(sessionRow?.status || '').toLowerCase();
      if (isTerminalCallStatus(sessionStatus)) {
        try {
          await api.acceptCall(sessionId, 'missed');
        } catch {
          // best effort — clear stale pending row
        }
        return;
      }

      if (
        sessionRow &&
        isExpiredRingingSession(
          sessionRow.status,
          sessionRow.created_at ?? null,
          sessionRow.updated_at ?? null
        )
      ) {
        try {
          await api.acceptCall(sessionId, 'missed');
        } catch {
          // best effort
        }
        return;
      }

      await maybeShowIncomingRef.current(sessionId);
    };

    void pollIncoming();
    incomingPollRef.current = window.setInterval(() => void pollIncoming(), 30000);

    return () => {
      if (incomingPollRef.current) {
        window.clearInterval(incomingPollRef.current);
        incomingPollRef.current = null;
      }
    };
  }, [currentUserId, isTerminalCallStatus, state]);

  useEffect(() => {
    return () => {
      const sessionId = activeCallSessionIdRef.current;
      const call = activeCallRef.current;
      if (sessionId && call) {
        void (async () => {
          try {
            if (call.isVoiceChannel && call.groupId && call.channelId) {
              await api.leaveVoiceChannel(call.groupId, call.channelId);
            } else if (call.conversationId && !call.groupId) {
              await api.leaveCallParticipant(sessionId);
            } else if (selfRoleRef.current === 'host') {
              await api.endCallSession(sessionId);
            } else {
              await api.leaveCallParticipant(sessionId);
            }
          } catch {
            // best effort — avoid orphaned server sessions on tab close
          }
        })();
      }
      void resetMedia();
      stopIncomingSound();
      stopOutgoingSound();
      incomingSessionIdRef.current = null;
      joinInFlightRef.current = false;
      if (retryTimeoutRef.current) window.clearTimeout(retryTimeoutRef.current);
      if (incomingPollRef.current) window.clearInterval(incomingPollRef.current);
      if (outgoingCallTimeoutRef.current) window.clearTimeout(outgoingCallTimeoutRef.current);
      if (endedTimeoutRef.current) window.clearTimeout(endedTimeoutRef.current);
    };
  }, [resetMedia, stopIncomingSound, stopOutgoingSound]);

  const isCallForConversation = useCallback(
    (conversationId: string) =>
      !!activeCall?.conversationId &&
      activeCall.conversationId === conversationId &&
      (state === 'calling' || state === 'in_call' || state === 'ended'),
    [activeCall?.conversationId, state]
  );

  const isVoiceChannelActive = useCallback(
    (groupId: string, channelId: string) =>
      !!activeCall?.isVoiceChannel &&
      activeCall.groupId === groupId &&
      activeCall.channelId === channelId &&
      state === 'in_call',
    [activeCall?.channelId, activeCall?.groupId, activeCall?.isVoiceChannel, state]
  );

  const jitsiHandlers = useMemo(
    () => ({
      onJoinResolved: handleJitsiJoinResolved,
      onJoinError: handleJitsiJoinError,
      onReady: handleJitsiReady,
      onConnectionEstablished: handleJitsiConnectionEstablished,
      onReadyToClose: handleJitsiReadyToClose,
      onParticipantCountChange: setRemoteParticipantCount,
      onAudioMuteChanged: (muted: boolean) => {
        setIsMuted(muted);
        if (!muted) {
          markJitsiMicGranted();
          premiumCallAudio.onJitsiAudioUnmuted();
        }
      },
      onVideoMuteChanged: (muted: boolean) => {
        const camera = !muted;
        setIsCameraEnabled(camera);
        isCameraEnabledRef.current = camera;
        jitsiHandleRef.current?.broadcastMediaState(camera, isScreenShareEnabledRef.current);
      },
      onScreenShareChanged: handleJitsiScreenShareChanged,
      onScreenShareError: handleJitsiScreenShareError,
      onDominantSpeakerChanged: handleJitsiDominantSpeakerChanged,
      onConferenceJoined: handleJitsiConferenceJoined,
      onRemoteParticipantJoined: handleJitsiRemoteParticipantJoined,
      onRemoteMediaChanged: handleJitsiRemoteMediaChanged,
      onRemoteMediaSync: handleJitsiRemoteMediaSync,
      onRemoteSpeakingChanged: handleJitsiRemoteSpeakingChanged,
    }),
    [
      handleJitsiConferenceJoined,
      handleJitsiConnectionEstablished,
      handleJitsiDominantSpeakerChanged,
      handleJitsiJoinError,
      handleJitsiJoinResolved,
      handleJitsiReady,
      handleJitsiReadyToClose,
      handleJitsiRemoteMediaChanged,
      handleJitsiRemoteMediaSync,
      handleJitsiRemoteParticipantJoined,
      handleJitsiRemoteSpeakingChanged,
      handleJitsiScreenShareChanged,
      handleJitsiScreenShareError,
    ]
  );

  const embeddedDmJitsiActive =
    !callPinned &&
    callDisplayMode === 'embedded' &&
    embeddedCallConversationId != null &&
    jitsiJoinRequest?.conversationId != null &&
    embeddedCallConversationId === jitsiJoinRequest.conversationId;

  const embeddedVoiceJitsiActive =
    !callPinned &&
    callDisplayMode === 'embedded' &&
    embeddedVoiceGroupId != null &&
    embeddedVoiceChannelId != null &&
    activeCall?.isVoiceChannel === true &&
    activeCall.groupId === embeddedVoiceGroupId &&
    activeCall.channelId === embeddedVoiceChannelId &&
    jitsiJoinRequest?.conversationId == null;

  const embeddedPinnedJitsiActive =
    callPinned &&
    callDisplayMode === 'embedded' &&
    state === 'in_call' &&
    !!jitsiJoinRequest;

  const embeddedJitsiActive =
    embeddedDmJitsiActive || embeddedVoiceJitsiActive || embeddedPinnedJitsiActive;

  const showGlobalCallHost =
    isJitsiCallProvider() && !!jitsiJoinRequest && state === 'in_call';

  const globalCallDisplayMode: 'pip' | 'fullscreen' | 'embedded' =
    callDisplayMode === 'fullscreen'
      ? 'fullscreen'
      : callDisplayMode === 'embedded' && embeddedJitsiActive && callHostAnchorEl
        ? 'embedded'
        : 'pip';

  const floatingStageParticipants = useMemo((): CallStageParticipant[] => {
    const remotes = activeCall?.participants ?? [];
    const localName = localIdentity || 'Du';
    const participants: CallStageParticipant[] = [
      {
        id: '__local__',
        name: localName,
        isLocal: true,
      },
      ...remotes.map((participant) => ({
        id: participant.id,
        name: participant.name,
        avatarUrl: participant.avatarUrl,
        jitsiParticipantId: participant.jitsiParticipantId,
      })),
    ];
    return filterJoinedStageParticipants(participants, remoteParticipantCount);
  }, [activeCall?.participants, localIdentity, remoteParticipantCount]);

  const value = useMemo<CallContextValue>(
    () => ({
      state,
      activeCall,
      incomingCall,
      connectionState,
      isMuted,
      isCameraEnabled,
      isScreenShareEnabled,
      errorMessage,
      canRetryConnection,
      retryAttempt,
      isAutoRetrying,
      selfRole,
      localIdentity,
      remoteParticipantCount,
      remoteVideoActive,
      remoteScreenShareActive,
      callDisplayMode,
      participantVolumes,
      mediaCaptureAvailable: mediaCaptureSupported(),
      debugTrail,
      jitsiSession: isJitsiCallProvider() && state === 'in_call' ? jitsiJoinRequest : null,
      jitsiMountKey,
      speakingParticipantId,
      jitsiHandlers,
      setParticipantVolume,
      setCallDisplayMode,
      enterCallPip,
      expandCallToFullscreen,
      minimizeCallFromFullscreen,
      openCallInChat,
      openCallInGroupPanel,
      openCallInPanel,
      registerEmbeddedCallHost,
      registerEmbeddedVoiceHost,
      registerCallHostAnchor,
      embeddedCallConversationId,
      embeddedVoiceGroupId,
      embeddedVoiceChannelId,
      callPinned,
      pinnedCallHostActive,
      toggleCallPinned,
      registerPinnedCallHost,
      startDirectCall,
      joinVoiceChannel,
      leaveVoiceChannel,
      acceptIncomingCall,
      declineIncomingCall,
      hangUp,
      toggleMute,
      toggleCamera,
      toggleScreenShare,
      retryConnection,
      joinCallViaInvite,
      clearEndedState,
      isCallForConversation,
      isVoiceChannelActive,
    }),
    [
      state,
      activeCall,
      incomingCall,
      connectionState,
      isMuted,
      isCameraEnabled,
      isScreenShareEnabled,
      errorMessage,
      canRetryConnection,
      retryAttempt,
      isAutoRetrying,
      selfRole,
      localIdentity,
      remoteParticipantCount,
      remoteVideoActive,
      remoteScreenShareActive,
      callDisplayMode,
      participantVolumes,
      debugTrail,
      jitsiJoinRequest,
      jitsiMountKey,
      speakingParticipantId,
      jitsiHandlers,
      setParticipantVolume,
      setCallDisplayMode,
      enterCallPip,
      expandCallToFullscreen,
      minimizeCallFromFullscreen,
      openCallInChat,
      openCallInGroupPanel,
      openCallInPanel,
      registerEmbeddedCallHost,
      registerEmbeddedVoiceHost,
      registerCallHostAnchor,
      embeddedCallConversationId,
      embeddedVoiceGroupId,
      embeddedVoiceChannelId,
      callPinned,
      pinnedCallHostActive,
      toggleCallPinned,
      registerPinnedCallHost,
      startDirectCall,
      joinVoiceChannel,
      leaveVoiceChannel,
      acceptIncomingCall,
      declineIncomingCall,
      hangUp,
      toggleMute,
      toggleCamera,
      toggleScreenShare,
      retryConnection,
      joinCallViaInvite,
      clearEndedState,
      isCallForConversation,
      isVoiceChannelActive,
    ]
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      <Suspense fallback={null}>
        <IncomingCallPopup />
      </Suspense>
      {showGlobalCallHost ? (
        <FloatingCallWidget
          displayMode={globalCallDisplayMode}
          hostAnchorEl={globalCallDisplayMode === 'embedded' ? callHostAnchorEl : null}
          activeCall={activeCall}
          callPinned={callPinned}
          onExpandedChange={(expanded) => {
            if (expanded) expandCallToFullscreen();
            else if (embeddedJitsiActive) setCallDisplayMode('embedded');
            else enterCallPip();
          }}
          onMinimizeToPip={enterCallPip}
          onTogglePin={toggleCallPinned}
          localIdentity={localIdentity}
          sessionId={jitsiJoinRequest!.sessionId}
          inviteToken={jitsiJoinRequest!.inviteToken}
          callType={jitsiJoinRequest!.callType}
          userId={currentUserId ?? undefined}
          mountKey={jitsiMountKey}
          connectionState={connectionState}
          isMuted={isMuted}
          isCameraEnabled={isCameraEnabled}
          isScreenShareEnabled={isScreenShareEnabled}
          remoteVideoActive={remoteVideoActive}
          remoteScreenShareActive={remoteScreenShareActive}
          stageParticipants={floatingStageParticipants}
          speakingParticipantId={speakingParticipantId}
          participantVolumes={participantVolumes}
          onParticipantVolumeChange={setParticipantVolume}
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
          onMinimizeFullscreen={minimizeCallFromFullscreen}
          onOpenInChat={openCallInPanel}
          onClosePip={openCallInPanel}
          onEnterFullscreen={expandCallToFullscreen}
        />
      ) : null}
    </CallContext.Provider>
  );
}

export function useCall() {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error('useCall must be used within CallProvider');
  }
  return context;
}
