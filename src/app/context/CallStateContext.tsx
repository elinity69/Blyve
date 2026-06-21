import React, {
  createContext,
  Suspense,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { supabase } from '../lib/supabase';
import { getCachedUser, subscribeAuth } from '../lib/authSession';
import { api } from '../lib/api';
import { getOptimizedImageUrl } from '../lib/images';
import { toast } from '../lib/toast';
import { takeDomSnapshot } from '../lib/domSnapshot';
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
import { releaseVoiceMemoStream } from '../lib/voiceMemoMedia';

function isProfileUserId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

type CallUiState = 'idle' | 'calling' | 'incoming' | 'in_call' | 'ended';
export type CallDisplayMode = 'embedded' | 'pip' | 'fullscreen';
export type CallPresentationMode = 'pip' | 'embedded' | 'fullscreen';

export type CallHostTarget =
  | { type: 'pip' }
  | { type: 'chat'; conversationId: string }
  | { type: 'voice'; groupId: string; channelId: string }
  | { type: 'pinned-global' }
  | { type: 'fullscreen' };

export type CallSurfaceOwner =
  | { type: 'embedded'; conversationId: string; hostKey: `chat:${string}` }
  | { type: 'voice'; groupId: string; channelId: string; hostKey: `voice:${string}:${string}` }
  | { type: 'pip' }
  | { type: 'pinned-global' }
  | { type: 'fullscreen' };

export type CallInteractionLock =
  | { type: 'none' }
  | { type: 'pip-gesture'; pointerId: number; startedAt: number }
  | { type: 'surface-transition'; transitionId: string; reason: string };

export interface CallSurfaceState {
  owner: CallSurfaceOwner;
  pendingOwner: CallSurfaceOwner | null;
  interactionLock: CallInteractionLock;
  pinned: boolean;
  callConversationId: string | null;
}

function isSameOwner(a: CallSurfaceOwner | null, b: CallSurfaceOwner | null): boolean {
  if (!a || !b) return a === b;
  if (a.type !== b.type) return false;
  if (a.type === 'embedded' && b.type === 'embedded') {
    return a.conversationId === b.conversationId;
  }
  if (a.type === 'voice' && b.type === 'voice') {
    return a.groupId === b.groupId && a.channelId === b.channelId;
  }
  return true;
}
type TerminalCallStatus = 'ended' | 'cancelled' | 'declined' | 'missed';
type CallSelfRole = 'host' | 'participant' | 'unknown';
const RINGING_TIMEOUT_MS = 30_000;
/** Any call session older than this is treated as stale regardless of status. */
const CALL_SESSION_MAX_AGE_MS = 5 * 60_000;
/** Fallback poll when Realtime is quiet — not the primary incoming-call path. */
const INCOMING_POLL_INTERVAL_MS = 120_000;

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
  releaseVoiceMemoStream();
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
  isRestoreLockActive: boolean;
  callPresentationMode: CallPresentationMode;
  callHostTarget: CallHostTarget;
  desiredHostKey: string;
  registeredHosts: Record<string, HTMLElement | null>;
  activeHostKey: string;
  activeHostElement: HTMLElement | null;
  registerCallHost: (hostKey: string, element: HTMLElement | null) => void;
  requestOpenPip: () => void;
  requestOpenEmbeddedForConversation: (conversationId: string) => void;
  requestOpenEmbeddedForVoice: (groupId: string, channelId: string) => void;
  requestOpenFullscreen: () => void;
  requestPinEmbeddedGlobal: () => void;
  requestUnpinEmbeddedGlobal: () => void;
  transitionState: 'idle' | 'awaiting-host' | 'switching-to-pip' | 'switching-to-fullscreen';
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
  leaveCall: () => Promise<void>;
  isProfilePreviewOpen: boolean;
  setIsProfilePreviewOpen: (open: boolean) => void;
  transitionToPiP: (reason: string) => void;
  transitionToEmbeddedInConversation: (conversationId: string, reason: string) => void;
  transitionToEmbeddedIfPossible: (reason: string) => void;
  handleChatDismissWhileEmbedded: (conversationId: string, reason: string) => void;
  leaveEmbeddedCallToPiP: (params: {
    source: 'back-button' | 'back-swipe' | 'history-pop' | 'header-back' | 'programmatic-pop';
    conversationId?: string | null;
    groupId?: string | null;
    channelId?: string | null;
    navigate?: () => void;
  }) => void;
}

const CallContext = createContext<CallContextValue | undefined>(undefined);

// ─── Stable core: call lifecycle + all action callbacks ──────────────────────
interface CallCoreValue {
  state: CallUiState;
  activeCall: ActiveCall | null;
  incomingCall: IncomingCall | null;
  callDisplayMode: CallDisplayMode;
  isRestoreLockActive: boolean;
  callPresentationMode: CallPresentationMode;
  callHostTarget: CallHostTarget;
  desiredHostKey: string;
  registeredHosts: Record<string, HTMLElement | null>;
  activeHostKey: string;
  activeHostElement: HTMLElement | null;
  registerCallHost: (hostKey: string, element: HTMLElement | null) => void;
  requestOpenPip: () => void;
  requestOpenEmbeddedForConversation: (conversationId: string) => void;
  requestOpenEmbeddedForVoice: (groupId: string, channelId: string) => void;
  requestOpenFullscreen: () => void;
  requestPinEmbeddedGlobal: () => void;
  requestUnpinEmbeddedGlobal: () => void;
  transitionState: 'idle' | 'awaiting-host' | 'switching-to-pip' | 'switching-to-fullscreen';
  callPinned: boolean;
  pinnedCallHostActive: boolean;
  embeddedCallConversationId: string | null;
  embeddedVoiceGroupId: string | null;
  embeddedVoiceChannelId: string | null;
  selfRole: CallSelfRole;
  jitsiSession: CallContextValue['jitsiSession'];
  jitsiMountKey: number;
  jitsiHandlers: CallContextValue['jitsiHandlers'];
  mediaCaptureAvailable: boolean;
  debugTrail: string[];
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
  leaveEmbeddedCallToPiP: CallContextValue['leaveEmbeddedCallToPiP'];
}

// ─── Volatile media: high-frequency live-call ticks ──────────────────────────
interface CallMediaValue {
  connectionState: string;
  isMuted: boolean;
  isCameraEnabled: boolean;
  isScreenShareEnabled: boolean;
  errorMessage: string | null;
  canRetryConnection: boolean;
  retryAttempt: number;
  isAutoRetrying: boolean;
  localIdentity: string | null;
  remoteParticipantCount: number;
  remoteVideoActive: boolean;
  remoteScreenShareActive: boolean;
  participantVolumes: Record<string, number>;
  speakingParticipantId: string | null;
  setParticipantVolume: (participantId: string, volume: number) => void;
}

const CallCoreContext = createContext<CallCoreValue | undefined>(undefined);
const CallMediaContext = createContext<CallMediaValue | undefined>(undefined);

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

function isCallAlreadyEndedError(error: unknown): boolean {
  const message = String((error as Error)?.message || error || '').toLowerCase();
  return (
    message.includes('410') ||
    message.includes('already ended') ||
    message.includes('call expired') ||
    message.includes('expired')
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

/**
 * Returns true for any non-terminal call session that is older than
 * CALL_SESSION_MAX_AGE_MS (5 minutes). This catches ghost 'active' sessions
 * that were never cleaned up (e.g., after a re-deploy or tab crash).
 */
function isStaleCallSession(
  statusRaw: unknown,
  createdAtRaw?: string | null,
  updatedAtRaw?: string | null
): boolean {
  const status = String(statusRaw || '').toLowerCase();
  // Terminal sessions don't need a staleness check.
  if (['ended', 'cancelled', 'declined', 'missed'].includes(status)) return false;
  const basisIso = updatedAtRaw || createdAtRaw;
  if (!basisIso) return false;
  const basisTs = new Date(basisIso).getTime();
  if (!Number.isFinite(basisTs)) return false;
  return Date.now() - basisTs > CALL_SESSION_MAX_AGE_MS;
}

if (typeof window !== 'undefined') {
  (window as any).__lastGestureFlowId = 'none';
  (window as any).__gestureCounter = 0;
  (window as any).__createGestureFlowId = (source: string) => {
    const counter = ++(window as any).__gestureCounter;
    const flowId = `pip-gesture-${Date.now()}-${counter}`;
    (window as any).__lastGestureFlowId = flowId;
    console.log(`[CALL FLOW DEBUG] [CREATE FLOW] flowId=${flowId} source=${source} ts=${performance.now()}`);
    return flowId;
  };

  (window as any).__getCallStateDebugInfo = () => {
    const flowId = (window as any).__lastGestureFlowId || 'none';
    const navStack = (window as any).__navStack || [];
    const navStackDepth = navStack.length;
    const activeCall = (window as any).__activeCall;
    const conversationId = activeCall?.conversationId || 'none';
    const activeHostKey = (window as any).__activeHostKey || 'none';
    const desiredHostKey = (window as any).__desiredHostKey || 'none';
    const callDisplayMode = (window as any).__callDisplayMode || 'none';
    const openReason = (window as any).__chatOpenReason || 'none';

    return `[flowId=${flowId} convId=${conversationId} activeHost=${activeHostKey} desiredHost=${desiredHostKey} mode=${callDisplayMode} stackDepth=${navStackDepth} openReason=${openReason}]`;
  };

  (window as any).__logCallRace = (event: string, detail: any) => {
    const info = (window as any).__getCallStateDebugInfo();
    console.warn(`[CALL RACE DEBUG] ${info} ${event} details:`, detail);
  };

  (window as any).__traceCallPipRequest = (reason: string, source: string) => {
    const info = (window as any).__getCallStateDebugInfo();
    const isLockActive = !!(window as any).__restoreLockActive;
    const isDoubleTapActive = (window as any).__lastGestureFlowId?.includes('double-tap') || false;
    const err = new Error();
    console.log(`[CALL FLOW DEBUG] [CALL PIP REQUEST TRACE] ${info} reason=${reason} source=${source} isLockActive=${isLockActive} isDoubleTapActive=${isDoubleTapActive}\nStack Trace:\n${err.stack}`);
  };

  (window as any).__triggerDebugCall = (event: string, payload?: any, source = 'unknown') => {
    if ((window as any).__debugCall) {
      (window as any).__debugCall(event, payload, source);
    } else {
      if (process.env.NODE_ENV === 'development') {
        console.log(`[CALL DEBUG][PRE-MOUNT] ts=${performance.now()} event=${event} source=${source}`, payload);
      }
    }
  };
}

export function triggerDebugCall(event: string, payload?: any, source = 'unknown') {
  if (typeof window !== 'undefined' && (window as any).__triggerDebugCall) {
    (window as any).__triggerDebugCall(event, payload, source);
  }
}

export function CallProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CallUiState>('idle');
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [jitsiJoinRequest, rawSetJitsiJoinRequest] = useState<JitsiJoinRequest | null>(null);
  const setJitsiJoinRequest = useCallback((val: JitsiJoinRequest | null | ((prev: JitsiJoinRequest | null) => JitsiJoinRequest | null)) => {
    console.log('[DEBUG JITSI JOIN REQUEST SETTER] setJitsiJoinRequest called with:', typeof val === 'function' ? 'function' : JSON.stringify(val));
    if (val === null) {
      console.log('[DEBUG JITSI JOIN REQUEST SETTER] STACK TRACE FOR NULL:', new Error().stack);
    }
    rawSetJitsiJoinRequest(val);
  }, []);
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
  const callPinnedRef = useRef(false);
  const lastModeChangeAtRef = useRef<number>(0);
  const currentDisplayModeRef = useRef<CallDisplayMode>('pip');
  const transitionStateRef = useRef<'idle' | 'awaiting-host' | 'switching-to-pip' | 'switching-to-fullscreen'>('idle');
  const [transitionState, setTransitionState] = useState<'idle' | 'awaiting-host' | 'switching-to-pip' | 'switching-to-fullscreen'>('idle');
  const transitionIdRef = useRef<number>(0);

  const [isProfilePreviewOpen, setIsProfilePreviewOpen] = useState(false);
  const [registeredHosts, setRegisteredHosts] = useState<Record<string, HTMLElement | null>>({});
  const registeredHostsRef = useRef<Record<string, HTMLElement | null>>({});
  const handoverSeqRef = useRef<number>(0);

  const [surfaceState, setSurfaceState] = useState<CallSurfaceState>(() => ({
    owner: { type: 'pip' },
    pendingOwner: null,
    interactionLock: { type: 'none' },
    pinned: false,
    callConversationId: null,
  }));

  const callPinned = surfaceState.pinned;

  const activeOwner = surfaceState.pendingOwner || surfaceState.owner;

  const callDisplayMode = useMemo<CallDisplayMode>(() => {
    if (activeOwner.type === 'pip') return 'pip';
    if (activeOwner.type === 'fullscreen') return 'fullscreen';
    return 'embedded';
  }, [activeOwner]);

  const callPresentationMode = callDisplayMode;

  const callHostTarget = useMemo<CallHostTarget>(() => {
    switch (activeOwner.type) {
      case 'pip': return { type: 'pip' };
      case 'fullscreen': return { type: 'fullscreen' };
      case 'pinned-global': return { type: 'pinned-global' };
      case 'embedded': return { type: 'chat', conversationId: activeOwner.conversationId };
      case 'voice': return { type: 'voice', groupId: activeOwner.groupId, channelId: activeOwner.channelId };
    }
  }, [activeOwner]);

  const desiredHostKey = useMemo(() => {
    switch (activeOwner.type) {
      case 'pip': return 'pip';
      case 'fullscreen': return 'fullscreen';
      case 'pinned-global': return 'pinned-global';
      case 'embedded': return `chat:${activeOwner.conversationId}`;
      case 'voice': return `voice:${activeOwner.groupId}:${activeOwner.channelId}`;
    }
  }, [activeOwner]);

  const isRestoreLockActive = surfaceState.interactionLock.type === 'surface-transition';

  const [activeHostKey, setActiveHostKey] = useState<string>('pip');

  const activeHostElement = useMemo(() => {
    return registeredHosts[activeHostKey] || null;
  }, [registeredHosts, activeHostKey]);

  const resetSurfaceState = useCallback(() => {
    setSurfaceState({
      owner: { type: 'pip' },
      pendingOwner: null,
      interactionLock: { type: 'none' },
      pinned: false,
      callConversationId: null,
    });
  }, []);

  useEffect(() => {
    currentDisplayModeRef.current = callDisplayMode;
  }, [callDisplayMode]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__activeHostElement = activeHostElement;
      (window as any).__activeHostKey = activeHostKey;
      (window as any).__activeCall = activeCall;
      (window as any).__callDisplayMode = callDisplayMode;
      (window as any).__desiredHostKey = desiredHostKey;
      (window as any).__restoreLockActive = isRestoreLockActive;
      console.log(`[CALL STATE] Synchronized global activeHostKey: ${activeHostKey}, mode: ${callDisplayMode}, desired: ${desiredHostKey}, lock: ${isRestoreLockActive}`);
    }
  }, [activeHostElement, activeHostKey, activeCall, callDisplayMode, desiredHostKey, isRestoreLockActive]);

  useEffect(() => {
    if (activeHostElement && activeHostKey) {
      const seq = ++handoverSeqRef.current;
      import('../lib/jitsi').then(({ attachToHost }) => {
        if (seq !== handoverSeqRef.current) {
          console.log(`[CALL STATE] stale ensure-attach skipped for key=${activeHostKey}`);
          return;
        }
        try {
          console.log(`[CALL STATE] Ensure attached to active host: key=${activeHostKey}, seq=${seq}`);
          attachToHost(activeHostKey, activeHostElement);
        } catch (err) {
          console.error(err);
        }
      });
    }
  }, [activeHostElement, activeHostKey]);

  // Handover-System
  useEffect(() => {
    const targetElement = registeredHosts[desiredHostKey];
    const flowInfo = typeof window !== 'undefined' && (window as any).__getCallStateDebugInfo ? (window as any).__getCallStateDebugInfo() : '';
    const registryKeys = Object.keys(registeredHosts).filter(k => registeredHosts[k] !== null);
    
    console.log(`[HOST REGISTRY DEBUG] ${flowInfo} [HANDOVER EFF] checking handover: desiredHostKey=${desiredHostKey}, activeHostKey=${activeHostKey}, elementExists=${!!targetElement}, registeredKeys=${JSON.stringify(registryKeys)}`);
    
    if (desiredHostKey === activeHostKey) {
      if (surfaceState.pendingOwner) {
        console.log(`[CALL STATE MACHINE][HANDOVER] desiredHostKey matches activeHostKey (${activeHostKey}). Finalizing owner state.`);
        setSurfaceState((prev) => {
          if (!prev.pendingOwner) return prev;
          return {
            ...prev,
            owner: prev.pendingOwner,
            pendingOwner: null,
            interactionLock: { type: 'none' },
          };
        });
      }
      return;
    }

    if (desiredHostKey === 'pip' || desiredHostKey === 'fullscreen' || targetElement) {
      console.log(`[HOST REGISTRY DEBUG] ${flowInfo} [HANDOVER EFF] handover attaching to registered host: desiredHostKey=${desiredHostKey}`);
      
      const seq = ++handoverSeqRef.current;
      if (targetElement) {
        import('../lib/jitsi').then(({ attachToHost }) => {
          if (seq !== handoverSeqRef.current) {
            console.log(`[HOST REGISTRY DEBUG] ${flowInfo} stale handover skipped for key=${desiredHostKey}`);
            return;
          }
          try {
            console.log(`[HOST REGISTRY DEBUG] ${flowInfo} attach accepted for current token. key=${desiredHostKey}, seq=${seq}`);
            setActiveHostKey(desiredHostKey);
            (window as any).__activeHostKey = desiredHostKey;
            attachToHost(desiredHostKey, targetElement);
            
            setSurfaceState((prev) => {
              const nextOwner = prev.pendingOwner || prev.owner;
              return {
                ...prev,
                owner: nextOwner,
                pendingOwner: null,
                interactionLock: { type: 'none' },
              };
            });
          } catch (err) {
            console.error(`[HOST REGISTRY DEBUG] attachToHost failed:`, err);
          }
        });
      } else {
        setActiveHostKey(desiredHostKey);
        (window as any).__activeHostKey = desiredHostKey;
        console.log(`[HOST REGISTRY DEBUG] activeHostKey changed directly (no targetElement): ${desiredHostKey}`);
        
        setSurfaceState((prev) => {
          const nextOwner = prev.pendingOwner || prev.owner;
          return {
            ...prev,
            owner: nextOwner,
            pendingOwner: null,
            interactionLock: { type: 'none' },
          };
        });
      }
    } else {
      console.log(`[HOST REGISTRY DEBUG] handover waiting for host: desiredHostKey=${desiredHostKey}`);
    }
  }, [desiredHostKey, registeredHosts, activeHostKey, surfaceState.pendingOwner]);

  // DEV-ONLY Guard
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' && callDisplayMode === 'embedded') {
      const visibleCallHostsCount = Object.entries(registeredHosts).filter(
        ([key, el]) => el !== null && key !== 'pip' && key !== 'fullscreen'
      ).length;
      const visiblePipHostsCount = registeredHosts['pip'] ? 1 : 0;
      
      if (visibleCallHostsCount === 0 && visiblePipHostsCount === 0) {
        console.error(`[CALL STATE MACHINE][FATAL EMBED GAP] embedded mode without visible host!`, {
          activeHostKey,
          desiredHostKey,
          callPinned,
          registeredHostKeys: Object.keys(registeredHosts).filter(k => registeredHosts[k] !== null),
          reason: 'DEV-ONLY-GUARD-TRIGGERED'
        });
      }
    }
  }, [callDisplayMode, registeredHosts, activeHostKey, desiredHostKey, callPinned]);

  const dispatchTransition = useCallback((targetOwner: CallSurfaceOwner, reason: string) => {
    const now = performance.now();
    const transitionId = `t-${Math.floor(Math.random() * 1000000)}`;

    console.log(`[CALL STATE MACHINE][INTENT] Dispatch transition to: ${JSON.stringify(targetOwner)}, reason: ${reason}, ts=${now}`);

    setSurfaceState((prev) => {
      if (prev.interactionLock.type === 'surface-transition') {
        const lastTs = (window as any).__lastTransitionLockTs || 0;
        const lockAge = now - lastTs;
        if (lockAge > 5000) {
          console.log(`[CALL STATE MACHINE][LOCK] transition lock timed out (${lockAge.toFixed(1)}ms). Overriding lock.`);
        } else {
          if (isSameOwner(prev.pendingOwner || prev.owner, targetOwner)) {
            console.log(`[CALL STATE MACHINE][LOCK] transition to same target already in progress. Ignoring duplicate.`);
            return prev;
          }
          console.log(`[CALL STATE MACHINE][LOCK] transition blocked by active lock (age=${lockAge.toFixed(1)}ms). Dropping request.`);
          return prev;
        }
      }

      if (isSameOwner(prev.owner, targetOwner) && prev.pendingOwner === null) {
        console.log(`[CALL STATE MACHINE] Already at target state. Ignoring transition.`);
        return prev;
      }

      (window as any).__lastTransitionLockTs = now;
      const mode = targetOwner.type === 'pip' ? 'pip' : targetOwner.type === 'fullscreen' ? 'fullscreen' : 'embedded';
      console.log(`[CALL STATE MACHINE][COMMIT BEGIN] transitionId=${transitionId} target=${JSON.stringify(targetOwner)}, mode=${mode}, reason=${reason}, ts=${now}`);
      if (targetOwner.type === 'embedded' || targetOwner.type === 'voice') {
        console.log(`[CALL STATE MACHINE][LOCK] restore lock acquired for target=${targetOwner.type}`);
      }

      return {
        ...prev,
        pendingOwner: targetOwner,
        interactionLock: { type: 'surface-transition', transitionId, reason },
      };
    });
  }, []);

  const commitTransition = useCallback((
    newMode: 'pip' | 'embedded' | 'fullscreen',
    newTarget: CallHostTarget,
    reason: string
  ) => {
    // Kept for backward compatibility but mapped to the state machine
    let nextOwner: CallSurfaceOwner = { type: 'pip' };
    if (newMode === 'fullscreen') {
      nextOwner = { type: 'fullscreen' };
    } else if (newMode === 'embedded') {
      if (newTarget.type === 'pinned-global') {
        nextOwner = { type: 'pinned-global' };
      } else if (newTarget.type === 'chat') {
        nextOwner = { type: 'embedded', conversationId: newTarget.conversationId, hostKey: `chat:${newTarget.conversationId}` };
      } else if (newTarget.type === 'voice') {
        nextOwner = { type: 'voice', groupId: newTarget.groupId, channelId: newTarget.channelId, hostKey: `voice:${newTarget.groupId}:${newTarget.channelId}` };
      }
    }
    dispatchTransition(nextOwner, `commitTransition:${reason}`);
  }, [dispatchTransition]);

  const transitionToPiP = useCallback((reason: string) => {
    dispatchTransition({ type: 'pip' }, reason);
  }, [dispatchTransition]);

  const transitionToEmbeddedInConversation = useCallback((conversationId: string, reason: string) => {
    if (isProfilePreviewOpen) {
      console.log(`[CALL STATE MACHINE][BLOCKED] transitionToEmbeddedInConversation blocked because profile preview is open.`);
      return;
    }
    if (surfaceState.pinned && activeCall && activeCall.conversationId !== conversationId) {
      dispatchTransition({ type: 'pinned-global' }, reason);
      return;
    }
    dispatchTransition({ type: 'embedded', conversationId, hostKey: `chat:${conversationId}` }, reason);
  }, [dispatchTransition, isProfilePreviewOpen, surfaceState.pinned, activeCall]);

  const transitionToEmbeddedIfPossible = useCallback((reason: string) => {
    if (isProfilePreviewOpen) {
      console.log(`[CALL STATE MACHINE][BLOCKED] transitionToEmbeddedIfPossible blocked because profile preview is open.`);
      return;
    }
    if (!activeCall) return;

    if (activeCall.conversationId) {
      const convId = activeCall.conversationId;
      window.dispatchEvent(
        new CustomEvent('open-conversation', {
          detail: { conversationId: convId },
        })
      );
      dispatchTransition({ type: 'embedded', conversationId: convId, hostKey: `chat:${convId}` }, reason);
    } else if (activeCall.isVoiceChannel && activeCall.groupId && activeCall.channelId) {
      dispatchTransition({ type: 'voice', groupId: activeCall.groupId, channelId: activeCall.channelId, hostKey: `voice:${activeCall.groupId}:${activeCall.channelId}` }, reason);
    }
  }, [dispatchTransition, activeCall, isProfilePreviewOpen]);

  const handleChatDismissWhileEmbedded = useCallback((conversationId: string, reason: string) => {
    if (callHostTarget.type === 'chat' && callHostTarget.conversationId === conversationId) {
      transitionToPiP(reason);
    }
  }, [callHostTarget, transitionToPiP]);

  const registerCallHost = useCallback((hostKey: string, element: HTMLElement | null) => {
    const flowInfo = typeof window !== 'undefined' && (window as any).__getCallStateDebugInfo ? (window as any).__getCallStateDebugInfo() : '';
    const componentName = element ? element.getAttribute('data-component-name') || 'unknown' : 'none';
    const hasPreviewAttr = element ? element.hasAttribute('data-messages-preview-panel') || element.closest('[data-messages-preview-panel]') != null : false;

    console.log(`[HOST REGISTRY DEBUG] ${flowInfo} registerCallHost: key=${hostKey}, elementExists=${!!element}, componentName=${componentName}, isPreviewHost=${hasPreviewAttr}`);

    registeredHostsRef.current[hostKey] = element;
    
    if (element && typeof window !== 'undefined' && process.env.NODE_ENV !== 'production' && hostKey !== 'pip' && hostKey !== 'fullscreen') {
      const liveHosts = Object.entries(registeredHostsRef.current).filter(
        ([key, el]) => el && el !== element && key !== 'pip' && key !== 'fullscreen'
      );
      if (liveHosts.length > 0) {
        console.error(`[CALL HOST REGISTRY][HARD ERROR] Multiple active live host elements registered!`, {
          newHostKey: hostKey,
          existingHosts: liveHosts.map(([k]) => k)
        });
      }
    }

    setRegisteredHosts((prev) => {
      if (prev[hostKey] === element) return prev;
      return { ...prev, [hostKey]: element };
    });
  }, []);

  const leaveEmbeddedCallToPiP = useCallback((params: {
    source: 'back-button' | 'back-swipe' | 'history-pop' | 'header-back' | 'programmatic-pop';
    conversationId?: string | null;
    groupId?: string | null;
    channelId?: string | null;
    navigate?: () => void;
  }) => {
    const flowId = typeof window !== 'undefined' && (window as any).__createGestureFlowId ? (window as any).__createGestureFlowId() : `flow-${Math.floor(Math.random() * 100000)}`;
    console.log(`[BACK BUTTON DEBUG] leaveEmbeddedCallToPiP called. source=${params.source}, flowId=${flowId}`);

    const isVoice = activeCall?.isVoiceChannel;
    let matchesContext = false;
    if (isVoice) {
      matchesContext = !!(params.groupId && params.channelId && activeCall?.groupId === params.groupId && activeCall?.channelId === params.channelId);
    } else {
      matchesContext = !!(params.conversationId && activeCall?.conversationId === params.conversationId);
    }

    if (activeCall && matchesContext) {
      setSurfaceState((prev) => {
        const nextOwner: CallSurfaceOwner = { type: 'pip' };
        console.log(`[BACK BUTTON DEBUG] leaveEmbeddedCallToPiP: Transitioning to PiP. flowId=${flowId}, pinned=${prev.pinned}`);

        return {
          ...prev,
          pendingOwner: nextOwner,
          interactionLock: {
            type: 'surface-transition',
            transitionId: `back-${flowId}`,
            reason: `leaveEmbeddedCallToPiP:${params.source}:${flowId}`,
          },
        };
      });
    }

    if (params.navigate) {
      console.log(`[NAV CALL COORDINATION DEBUG] executing navigate callback for source=${params.source}, flowId=${flowId}`);
      params.navigate();
    }
  }, [activeCall]);

  const requestOpenPip = useCallback(() => {
    dispatchTransition({ type: 'pip' }, 'requestOpenPip');
  }, [dispatchTransition]);

  const requestOpenEmbeddedForConversation = useCallback((conversationId: string) => {
    dispatchTransition({ type: 'embedded', conversationId, hostKey: `chat:${conversationId}` }, 'requestOpenEmbeddedForConversation');
  }, [dispatchTransition]);

  const requestOpenEmbeddedForVoice = useCallback((groupId: string, channelId: string) => {
    dispatchTransition({ type: 'voice', groupId, channelId, hostKey: `voice:${groupId}:${channelId}` }, 'requestOpenEmbeddedForVoice');
  }, [dispatchTransition]);

  const requestOpenFullscreen = useCallback(() => {
    dispatchTransition({ type: 'fullscreen' }, 'requestOpenFullscreen');
  }, [dispatchTransition]);

  const requestPinEmbeddedGlobal = useCallback(() => {
    console.log(`[CALL TRANSITION] requestPinEmbeddedGlobal requested`);
    setSurfaceState((prev) => ({
      ...prev,
      pinned: true,
      pendingOwner: { type: 'pinned-global' },
      interactionLock: {
        type: 'surface-transition',
        transitionId: `pin-${Math.floor(Math.random() * 1000000)}`,
        reason: 'requestPinEmbeddedGlobal',
      },
    }));
  }, []);

  const requestUnpinEmbeddedGlobal = useCallback(() => {
    console.log(`[CALL TRANSITION] requestUnpinEmbeddedGlobal requested`);
    let nextOwner: CallSurfaceOwner = { type: 'pip' };
    if (activeCall?.conversationId) {
      nextOwner = { type: 'embedded', conversationId: activeCall.conversationId, hostKey: `chat:${activeCall.conversationId}` };
    } else if (activeCall?.isVoiceChannel && activeCall.groupId && activeCall.channelId) {
      nextOwner = { type: 'voice', groupId: activeCall.groupId, channelId: activeCall.channelId, hostKey: `voice:${activeCall.groupId}:${activeCall.channelId}` };
    }
    
    setSurfaceState((prev) => ({
      ...prev,
      pinned: false,
      pendingOwner: nextOwner,
      interactionLock: {
        type: 'surface-transition',
        transitionId: `unpin-${Math.floor(Math.random() * 1000000)}`,
        reason: 'requestUnpinEmbeddedGlobal',
      },
    }));
  }, [activeCall]);

  const setCallDisplayMode = useCallback((mode: CallDisplayMode | ((prev: CallDisplayMode) => CallDisplayMode)) => {
    const nextMode = typeof mode === 'function' ? mode(callDisplayMode) : mode;
    if (callDisplayMode === nextMode) return;

    let nextOwner: CallSurfaceOwner = { type: 'pip' };
    if (nextMode === 'fullscreen') {
      nextOwner = { type: 'fullscreen' };
    } else if (nextMode === 'embedded') {
      if (activeCall?.conversationId) {
        nextOwner = { type: 'embedded', conversationId: activeCall.conversationId, hostKey: `chat:${activeCall.conversationId}` };
      } else if (activeCall?.isVoiceChannel && activeCall.groupId && activeCall.channelId) {
        nextOwner = { type: 'voice', groupId: activeCall.groupId, channelId: activeCall.channelId, hostKey: `voice:${activeCall.groupId}:${activeCall.channelId}` };
      }
    }
    dispatchTransition(nextOwner, 'setCallDisplayMode');
  }, [callDisplayMode, activeCall, dispatchTransition]);
  const [participantVolumes, setParticipantVolumes] = useState<Record<string, number>>({});
  const [debugTrail, setDebugTrail] = useState<string[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const embeddedCallConversationId = callHostTarget.type === 'chat' ? callHostTarget.conversationId : null;
  const embeddedVoiceGroupId = callHostTarget.type === 'voice' ? callHostTarget.groupId : null;
  const embeddedVoiceChannelId = callHostTarget.type === 'voice' ? callHostTarget.channelId : null;
  const pinnedCallHostActive = callHostTarget.type === 'pinned-global';
  const callHostAnchorEl = activeHostElement;
  const [speakingParticipantId, setSpeakingParticipantId] = useState<string | null>(null);
  const embeddedHostRef = useRef<string | null>(null);
  const embeddedVoiceHostRef = useRef<{ groupId: string; channelId: string } | null>(null);
  const pinnedHostRef = useRef(false);

  const debugCall = useCallback((event: string, payload?: any, source = 'CallProvider') => {
    const ts = performance.now();
    const info = {
      ts,
      event,
      conversationId: activeCall?.conversationId || null,
      roomId: activeCall?.callSessionId || activeCallSessionIdRef.current || null,
      state,
      callDisplayMode,
      isCallOpen: state === 'in_call',
      isPiPOpen: callDisplayMode === 'pip',
      isJoining: state === 'calling' || joinInFlightRef.current,
      mountedChatConversationId: embeddedCallConversationId || null,
      source,
      ...(payload || {})
    };
    console.log(`[CALL DEBUG]`, info);
  }, [state, activeCall, callDisplayMode, embeddedCallConversationId]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__debugCall = debugCall;
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).__debugCall;
      }
    };
  }, [debugCall]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__triggerMockCall = (conversationId = 'mock-session-123', mode = 'embedded') => {
        console.log('[MOCK CALL] Triggering mock Jitsi call in mode:', mode, 'for conversationId:', conversationId);
        setIncomingCall(null);
        setErrorMessage(null);
        setState('in_call');
        setSelfRole('host');
        setSurfaceState({
          owner: mode === 'pip' ? { type: 'pip' } : { type: 'embedded', conversationId, hostKey: `chat:${conversationId}` },
          pendingOwner: null,
          interactionLock: { type: 'none' },
          pinned: false,
          callConversationId: conversationId,
        });
        setJitsiJoinRequest({
          sessionId: conversationId,
          callType: 'audio',
          conversationId: conversationId,
        });
        setActiveCall({
          callSessionId: conversationId,
          conversationId: conversationId,
          callType: 'audio',
          participants: [
            { id: 'f3e86e12-f8b3-4447-883f-2e41fc29b152', name: 'nami' }
          ]
        });
      };
      (window as any).__requestOpenPip = requestOpenPip;
      (window as any).__requestOpenEmbeddedForConversation = requestOpenEmbeddedForConversation;
      (window as any).__requestOpenFullscreen = requestOpenFullscreen;
      (window as any).__requestPinEmbeddedGlobal = requestPinEmbeddedGlobal;
      (window as any).__requestUnpinEmbeddedGlobal = requestUnpinEmbeddedGlobal;
      (window as any).__callStateMachine = {
        transitionToPiP,
        transitionToEmbeddedInConversation,
        transitionToEmbeddedIfPossible,
        handleChatDismissWhileEmbedded,
      };
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).__triggerMockCall;
        delete (window as any).__requestOpenPip;
        delete (window as any).__requestOpenEmbeddedForConversation;
        delete (window as any).__requestOpenFullscreen;
        delete (window as any).__requestPinEmbeddedGlobal;
        delete (window as any).__requestUnpinEmbeddedGlobal;
        delete (window as any).__callStateMachine;
      }
    };
  }, [
    setIncomingCall,
    setErrorMessage,
    setState,
    setSelfRole,
    setJitsiJoinRequest,
    setActiveCall,
    requestOpenPip,
    requestOpenEmbeddedForConversation,
    requestOpenFullscreen,
    requestPinEmbeddedGlobal,
    requestUnpinEmbeddedGlobal,
    transitionToPiP,
    transitionToEmbeddedInConversation,
    transitionToEmbeddedIfPossible,
    handleChatDismissWhileEmbedded,
  ]);

  useEffect(() => {
    triggerDebugCall('state_render_dependency_changed', {
      state,
      callDisplayMode,
      embeddedCallConversationId,
      embeddedVoiceGroupId,
      embeddedVoiceChannelId,
      callPinned,
      pinnedCallHostActive,
      hasAnchor: !!callHostAnchorEl
    }, 'CallProvider');
  }, [state, callDisplayMode, embeddedCallConversationId, embeddedVoiceGroupId, embeddedVoiceChannelId, callPinned, pinnedCallHostActive, callHostAnchorEl]);

  useEffect(() => {
    if (state === 'in_call' && callDisplayMode === 'embedded' && !embeddedCallConversationId && !embeddedVoiceGroupId && !pinnedCallHostActive) {
      console.warn(`[CALL DEBUG][ILLEGAL MOUNT] Call is in embedded display mode but no host (chat conversation, voice group, or pinned host) is active! ts=${performance.now()}`);
    }
  }, [state, callDisplayMode, embeddedCallConversationId, embeddedVoiceGroupId, pinnedCallHostActive]);

  const prevIsProfilePreviewOpenRef = useRef(false);

  // Canonical rule: If a profile preview or overlay is opened, temporarily transition to PiP.
  // When it is closed, if the call was embedded/pinned, restore the appropriate mode!
  useEffect(() => {
    if (state !== 'in_call') return;
    
    const wasOpen = prevIsProfilePreviewOpenRef.current;
    const isOpen = isProfilePreviewOpen;
    prevIsProfilePreviewOpenRef.current = isOpen;

    if (wasOpen === isOpen) return; // ONLY run if the overlay state ACTUALLY changed!

    if (isOpen) {
      console.log(`[CALL STATE MACHINE][OVERLAY] Profile preview opened. Transitioning to PiP temporarily.`);
      dispatchTransition({ type: 'pip' }, 'profile-preview-opened');
    } else {
      console.log(`[CALL STATE MACHINE][OVERLAY] Profile preview closed. Restoring canonical mode.`);
      if (callPinned) {
        if (activeCall?.conversationId) {
          dispatchTransition({ type: 'embedded', conversationId: activeCall.conversationId, hostKey: `chat:${activeCall.conversationId}` }, 'profile-preview-closed-pinned-chat');
        } else {
          dispatchTransition({ type: 'pinned-global' }, 'profile-preview-closed-pinned-global');
        }
      } else {
        if (activeCall?.conversationId) {
          const targetKey = `chat:${activeCall.conversationId}`;
          const hostElement = registeredHostsRef.current[targetKey];
          if (hostElement) {
            dispatchTransition({ type: 'embedded', conversationId: activeCall.conversationId, hostKey: `chat:${activeCall.conversationId}` }, 'profile-preview-closed-restore-chat');
          } else {
            dispatchTransition({ type: 'pip' }, 'profile-preview-closed-fallback-pip');
          }
        }
      }
    }
  }, [isProfilePreviewOpen, state, callPinned, activeCall, dispatchTransition]);

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
  const callTeardownRef = useRef(false);
  const incomingRingCountRef = useRef(0);
  const outgoingRingCountRef = useRef(0);
  const clearedStalePendingRef = useRef<Set<string>>(new Set());
  const incomingPollInFlightRef = useRef(false);
  const pendingHostTransitionRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingVoiceHostTransitionRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const shouldRunIncomingPoll = useCallback(() => {
    if (typeof document !== 'undefined' && document.hidden) return false;
    const uiState = stateRef.current;
    return uiState !== 'in_call' && uiState !== 'incoming' && uiState !== 'calling';
  }, []);

  /** Clears orphan pending rows when the session is already terminal (acceptCall returns 410). */
  const clearStalePendingParticipant = useCallback(
    async (sessionId: string): Promise<void> => {
      if (!currentUserId || !sessionId) return;
      if (clearedStalePendingRef.current.has(sessionId)) return;

      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from('call_participants')
        .update({
          invite_status: 'missed',
          left_at: nowIso,
          updated_at: nowIso,
        })
        .eq('call_session_id', sessionId)
        .eq('user_id', currentUserId)
        .eq('invite_status', 'pending')
        .is('left_at', null);

      clearedStalePendingRef.current.add(sessionId);
      if (clearedStalePendingRef.current.size > 200) {
        clearedStalePendingRef.current.clear();
      }

      if (error) {
        pushDebug(`stale pending cleanup failed session=${sessionId}`);
      }
    },
    [currentUserId, pushDebug]
  );

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
    resetSurfaceState();
    pinnedHostRef.current = false;
    callPinnedRef.current = false;
    setState('idle');
    pushDebug('state -> idle');
  }, [pushDebug, resetSurfaceState]);

  const moveToEnded = useCallback(() => {
    clearEndedState();
  }, [clearEndedState]);

  const resetMedia = useCallback(async () => {
    premiumCallAudio.release();
    jitsiHandleRef.current?.dispose();
    jitsiHandleRef.current = null;
    jitsiActiveSessionRef.current = null;
    flushSync(() => {
      setJitsiJoinRequest(null);
    });

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
    resetSurfaceState();
    pinnedHostRef.current = false;
    callPinnedRef.current = false;
    setParticipantVolumes({});
    setSpeakingParticipantId(null);
    userMutedManuallyRef.current = false;
    localJitsiParticipantIdRef.current = null;
    jitsiIdToDisplayNameRef.current.clear();
    localSpeakingBroadcastRef.current = false;
    if (dominantSpeakerClearTimeoutRef.current) {
      window.clearTimeout(dominantSpeakerClearTimeoutRef.current);
      dominantSpeakerClearTimeoutRef.current = null;
    }
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
      triggerDebugCall('joinCall requested', { callSessionId, conversationId, callType, inviteToken }, 'CallProvider');
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
      triggerDebugCall('startCall invoked', { input }, 'CallProvider');
      await ensureMicrophoneForCall();

      clearEndedState();
      setIncomingCall(null);
      setErrorMessage(null);
      setState('calling');
      setSelfRole('host');
      pushDebug(`outgoing call start conversation=${input.conversationId}`);
      startOutgoingSound();
      setCallDisplayMode('embedded');
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
              // The server returns existingSessionId in the 409 response payload — use it directly.
              const errPayload = (createError as { responsePayload?: Record<string, unknown> })
                ?.responsePayload;
              const existingId = errPayload?.existingSessionId
                ? String(errPayload.existingSessionId)
                : null;

              if (existingId) {
                if (outgoingCallTimeoutRef.current) {
                  window.clearTimeout(outgoingCallTimeoutRef.current);
                  outgoingCallTimeoutRef.current = null;
                }
                activeCallSessionIdRef.current = existingId;
                setActiveCall((prev) => (prev ? { ...prev, callSessionId: existingId } : prev));
                pushDebug(`join existing session=${existingId} (from 409 payload)`);
                // Delay Jitsi connection for host until accepted/active state (let Realtime do it)
                return;
              }

              // Fallback: query Supabase if payload didn't include existingSessionId.
              const { data: existing } = await supabase
                .from('call_sessions')
                .select('id')
                .eq('conversation_id', input.conversationId)
                .in('status', ['ringing', 'joining', 'active'])
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
              if (existing?.id) {
                const fallbackId = String(existing.id);
                if (outgoingCallTimeoutRef.current) {
                  window.clearTimeout(outgoingCallTimeoutRef.current);
                  outgoingCallTimeoutRef.current = null;
                }
                activeCallSessionIdRef.current = fallbackId;
                setActiveCall((prev) => (prev ? { ...prev, callSessionId: fallbackId } : prev));
                pushDebug(`join existing session=${fallbackId} (from DB fallback)`);
                // Delay Jitsi connection for host until accepted/active state (let Realtime do it)
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
          // Delay Jitsi connection for host until accepted/active state (let Realtime handle the accepted trigger)

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
        triggerDebugCall('joinCall failed (startDirectCall error)', { error: String(error) }, 'CallProvider');
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
      triggerDebugCall('joinCall requested (voice channel)', { input }, 'CallProvider');
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
        triggerDebugCall('joinCall failed (joinVoiceChannel error)', { error: String(error) }, 'CallProvider');
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
    console.log(`[CALL FLOW DEBUG] [enterCallPip] force=${force}, callPinned=${callPinned}`);
    if (typeof window !== 'undefined' && (window as any).__traceCallPipRequest) {
      (window as any).__traceCallPipRequest(`enterCallPip_force=${force}`, 'CallStateContext:enterCallPip');
    }

    // Gating: Block automated PiP entry during active restore or handover window unless forced
    if (!force) {
      const isLockActive = isRestoreLockActive;
      const diff = performance.now() - ((window as any).__lastTransitionLockTs || 0);
      const inRestoreWindow = diff < 1500;
      const isRestoreFlowActive = isLockActive || inRestoreWindow;

      if (isRestoreFlowActive) {
        console.log(`[CALL GUARD DEBUG] blocked enterCallPip because restore/handover is active. isLockActive=${isLockActive}, diff=${diff.toFixed(1)}ms`);
        return;
      }
    }

    if (callPinned && !force) return;
    requestOpenPip();
  }, [callPinned, requestOpenPip, isRestoreLockActive]);

  const toggleCallPinned = useCallback(() => {
    const next = !callPinned;
    if (next) {
      requestPinEmbeddedGlobal();
    } else {
      requestUnpinEmbeddedGlobal();
    }
  }, [callPinned, requestPinEmbeddedGlobal, requestUnpinEmbeddedGlobal]);

  useEffect(() => {
    callPinnedRef.current = callPinned;
  }, [callPinned]);

  const expandCallToFullscreen = useCallback(() => {
    requestOpenFullscreen();
  }, [requestOpenFullscreen]);

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

  const minimizeCallFromFullscreen = useCallback(() => {
    if (callPinned) {
      requestPinEmbeddedGlobal();
    } else if (activeCall?.conversationId) {
      requestOpenEmbeddedForConversation(activeCall.conversationId);
    } else if (activeCall?.isVoiceChannel && activeCall.groupId && activeCall.channelId) {
      requestOpenEmbeddedForVoice(activeCall.groupId, activeCall.channelId);
    } else {
      requestOpenPip();
    }
  }, [callPinned, activeCall, requestPinEmbeddedGlobal, requestOpenEmbeddedForConversation, requestOpenEmbeddedForVoice, requestOpenPip]);

  const openCallInChat = useCallback(() => {
    if (activeCall?.conversationId) {
      requestOpenEmbeddedForConversation(activeCall.conversationId);
    }
  }, [activeCall, requestOpenEmbeddedForConversation]);

  const openCallInGroupPanel = useCallback(() => {
    if (activeCall?.isVoiceChannel && activeCall.groupId && activeCall.channelId) {
      requestOpenEmbeddedForVoice(activeCall.groupId, activeCall.channelId);
    }
  }, [activeCall, requestOpenEmbeddedForVoice]);

  const openCallInPanel = useCallback(() => {
    transitionToEmbeddedIfPossible('double-tap');
  }, [transitionToEmbeddedIfPossible]);

  const acceptIncomingCall = useCallback(async () => {
    if (!incomingCall) return;
    triggerDebugCall('joinCall requested (accept incoming)', { incomingCall }, 'CallProvider');

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

    // Accept MUST complete before join — the server rejects joinCall with 409
    // when invite_status is still "pending". Mic request runs in parallel since
    // it doesn't depend on server state.
    try {
      await api.acceptCall(sessionId, 'accept');
    } catch (error) {
      if (!isStaleAcceptCallError(error)) {
        triggerDebugCall('joinCall failed (acceptCall api error)', { error: String(error) }, 'CallProvider');
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
        return;
      }
      pushDebug(`accept ignored stale state session=${sessionId}`);
    }

    const joinPromise = connectToCallMedia(sessionId, conversationId, 'audio');

    try {
      await Promise.all([micPromise, joinPromise]);
    } catch (error: unknown) {
      triggerDebugCall('joinCall failed (acceptIncomingCall join error)', { error: String(error) }, 'CallProvider');
      joinInFlightRef.current = false;
      console.error('Failed to join call after accept:', error);
      const uiError = toUserFacingCallError(error);
      toast.error('Accept failed', uiError);
      setErrorMessage(uiError);
      setIncomingCall(null);
      incomingSessionIdRef.current = null;
      stopIncomingSound();
      pushDebug(`join failed after accept: ${(error as Error)?.message || 'unknown'}`);
      moveToEnded();
    }
  }, [connectToCallMedia, incomingCall, moveToEnded, pushDebug, stopIncomingSound]);

  const declineIncomingCall = useCallback(async () => {
    if (!incomingCall) return;
    triggerDebugCall('leaveCall requested (declineIncomingCall)', { sessionId: incomingCall.callSessionId }, 'CallProvider');
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
    if (callTeardownRef.current) return;
    triggerDebugCall('leaveCall requested (hangUp)', {}, 'CallProvider');
    callTeardownRef.current = true;

    try {
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
        flushSync(() => {
          setIncomingCall(null);
          incomingSessionIdRef.current = null;
          setActiveCall(null);
          activeCallSessionIdRef.current = null;
          jitsiActiveSessionRef.current = null;
          setSelfRole('unknown');
          moveToEnded();
        });
        stopIncomingSound();
        stopOutgoingSound();
        setErrorMessage(null);
        setCanRetryConnection(false);
        pushDebug(`voice channel leave session=${sessionId || 'none'}`);
        triggerDebugCall('leaveCall success', {}, 'CallProvider');
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
      flushSync(() => {
        setIncomingCall(null);
        incomingSessionIdRef.current = null;
        setActiveCall(null);
        activeCallSessionIdRef.current = null;
        jitsiActiveSessionRef.current = null;
        setSelfRole('unknown');
        moveToEnded();
      });
      stopIncomingSound();
      stopOutgoingSound();
      setErrorMessage(null);
      setCanRetryConnection(false);
      pushDebug(`hangup session=${sessionId || 'none'} role=${selfRoleRef.current}`);
      triggerDebugCall('leaveCall success', {}, 'CallProvider');
    } finally {
      callTeardownRef.current = false;
    }
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
    triggerDebugCall('leaveCall requested (leaveVoiceChannel)', {}, 'CallProvider');
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
    triggerDebugCall('leaveCall success', {}, 'CallProvider');
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
        await clearStalePendingParticipant(callSessionId);
        return;
      }
      if (
        sessionRow &&
        (isExpiredRingingSession(
          sessionRow.status,
          sessionRow.created_at ?? null,
          sessionRow.updated_at ?? null
        ) ||
          isStaleCallSession(
            sessionRow.status,
            sessionRow.created_at ?? null,
            sessionRow.updated_at ?? null
          ))
      ) {
        try {
          await api.acceptCall(callSessionId, 'missed');
        } catch (error: unknown) {
          if (isCallAlreadyEndedError(error) || isStaleAcceptCallError(error)) {
            await clearStalePendingParticipant(callSessionId);
          }
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
    [
      clearStalePendingParticipant,
      incomingCall,
      isTerminalCallStatus,
      pushDebug,
      resolveCallerFromSession,
      startIncomingSound,
      state,
    ]
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
    takeDomSnapshot('after startCall');
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
      if (typeof window !== 'undefined' && (window as any).__isPlaywrightTest) {
        console.log('[MOCK JITSI] Ignoring join error in Playwright test environment:', error);
        return;
      }
      jitsiHandleRef.current?.dispose();
      jitsiHandleRef.current = null;
      flushSync(() => {
        setJitsiJoinRequest(null);
      });
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
    if (callTeardownRef.current || stateRef.current === 'idle') return;
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

  const broadcastSpeakingToRemotes = useCallback((speaking: boolean, levelDb = -35) => {
    if (isMutedRef.current) return;
    const handle = jitsiHandleRef.current;
    if (!handle) return;

    const now = Date.now();
    if (speaking) {
      if (!localSpeakingBroadcastRef.current || now - lastSpeakingBroadcastAtRef.current > 250) {
        localSpeakingBroadcastRef.current = true;
        lastSpeakingBroadcastAtRef.current = now;
        handle.broadcastSpeakingState(true, levelDb);
      }
      return;
    }

    if (localSpeakingBroadcastRef.current) {
      localSpeakingBroadcastRef.current = false;
      handle.broadcastSpeakingState(false, levelDb);
    }
  }, []);

  const markLocalSpeaking = useCallback(() => {
    setSpeakingParticipantId('__local__');

    const existing = remoteSpeakingTimeoutRef.current.get('__local__');
    if (existing) window.clearTimeout(existing);
    const timeoutId = window.setTimeout(() => {
      setSpeakingParticipantId((prev) => (prev === '__local__' ? null : prev));
      remoteSpeakingTimeoutRef.current.delete('__local__');
      broadcastSpeakingToRemotes(false);
    }, 900);
    remoteSpeakingTimeoutRef.current.set('__local__', timeoutId);
  }, [broadcastSpeakingToRemotes]);

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
          setSpeakingParticipantId((prev) => {
            if (prev === '__local__') {
              broadcastSpeakingToRemotes(false);
            }
            return prev === '__local__' ? null : prev;
          });
        }, 500);
        return;
      }

      if (jitsiParticipantId === localJitsiParticipantIdRef.current) {
        markLocalSpeaking();
        broadcastSpeakingToRemotes(true);
        return;
      }

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
    [broadcastSpeakingToRemotes, markLocalSpeaking, markRemoteSpeaking, resolveSpeakingParticipantId]
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

      if (
        payload.id &&
        localJitsiParticipantIdRef.current &&
        payload.id === localJitsiParticipantIdRef.current
      ) {
        return;
      }

      const localName = localIdentity?.trim().toLowerCase();
      if (localName && displayName && displayName.toLowerCase() === localName) {
        return;
      }

      if (payload.id) {
        jitsiIdToDisplayNameRef.current.set(
          payload.id,
          displayName || jitsiIdToDisplayNameRef.current.get(payload.id) || 'Participant',
        );
      }

      if (!displayName && !payload.id) return;

      setActiveCall((prev) => {
        if (!prev) return prev;

        const remotes = prev.participants;
        const fallbackName =
          displayName ||
          (remotes.length === 1 ? remotes[0].name : undefined) ||
          'Participant';

        const incoming: CallParty = {
          id:
            remotes.length === 1 && isProfileUserId(remotes[0].id)
              ? remotes[0].id
              : payload.id || fallbackName,
          name: fallbackName,
          avatarUrl: remotes.length === 1 ? remotes[0].avatarUrl : undefined,
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
    // Stubbed for backward compatibility, panels now call registerCallHost directly
  }, []);

  const registerEmbeddedVoiceHost = useCallback((groupId: string | null, channelId: string | null) => {
    // Stubbed for backward compatibility, panels now call registerCallHost directly
  }, []);

  const registerPinnedCallHost = useCallback((active: boolean) => {
    // Stubbed for backward compatibility, panels now call registerCallHost directly
  }, []);

  const registerCallHostAnchor = useCallback((element: HTMLElement | null) => {
    // Stubbed for backward compatibility
  }, []);

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
            return;
          }

          if (status !== 'pending' && status !== 'accepted') return;

          const { data: sessionRow } = await supabase
            .from('call_sessions')
            .select('id, conversation_id, creator_id, status')
            .eq('id', row.call_session_id)
            .maybeSingle();

          const sessionStatus = String(sessionRow?.status || '').toLowerCase();
          if (sessionRow && terminalStatuses.has(sessionStatus)) {
            if (status === 'pending' && row.user_id === currentUserId) {
              await clearStalePendingParticipant(row.call_session_id);
            }
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
  }, [
    clearStalePendingParticipant,
    currentUserId,
    moveToEnded,
    resetMedia,
    stopIncomingSound,
    stopOutgoingSound,
  ]);

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
    if (!currentUserId) return;

    const pollIncoming = async () => {
      if (!shouldRunIncomingPoll()) return;
      if (incomingPollInFlightRef.current) return;
      incomingPollInFlightRef.current = true;
      try {
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
        if (clearedStalePendingRef.current.has(sessionId)) return;

        const { data: sessionRow } = await supabase
          .from('call_sessions')
          .select('status, created_at, updated_at')
          .eq('id', sessionId)
          .maybeSingle();

        const sessionStatus = String(sessionRow?.status || '').toLowerCase();
        if (isTerminalCallStatus(sessionStatus)) {
          await clearStalePendingParticipant(sessionId);
          return;
        }

        if (
          sessionRow &&
          (isExpiredRingingSession(
            sessionRow.status,
            sessionRow.created_at ?? null,
            sessionRow.updated_at ?? null
          ) ||
            isStaleCallSession(
              sessionRow.status,
              sessionRow.created_at ?? null,
              sessionRow.updated_at ?? null
            ))
        ) {
          try {
            await api.acceptCall(sessionId, 'missed');
          } catch (error: unknown) {
            if (isCallAlreadyEndedError(error) || isStaleAcceptCallError(error)) {
              await clearStalePendingParticipant(sessionId);
            }
          }
          return;
        }

        await maybeShowIncomingRef.current(sessionId);
      } finally {
        incomingPollInFlightRef.current = false;
      }
    };

    const startPolling = () => {
      if (incomingPollRef.current) {
        window.clearInterval(incomingPollRef.current);
        incomingPollRef.current = null;
      }
      if (!shouldRunIncomingPoll()) return;
      void pollIncoming();
      incomingPollRef.current = window.setInterval(
        () => void pollIncoming(),
        INCOMING_POLL_INTERVAL_MS
      );
    };

    startPolling();

    const onVisibilityChange = () => {
      if (document.hidden) {
        if (incomingPollRef.current) {
          window.clearInterval(incomingPollRef.current);
          incomingPollRef.current = null;
        }
        return;
      }
      startPolling();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (incomingPollRef.current) {
        window.clearInterval(incomingPollRef.current);
        incomingPollRef.current = null;
      }
    };
  }, [
    clearStalePendingParticipant,
    currentUserId,
    isTerminalCallStatus,
    shouldRunIncomingPoll,
  ]);

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

  const embeddedJitsiActive = callPresentationMode === 'embedded' && !!activeHostElement;

  const showGlobalCallHost =
    isJitsiCallProvider() && !!jitsiJoinRequest && state === 'in_call';

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
      isRestoreLockActive,
      callPresentationMode,
      callHostTarget,
      desiredHostKey,
      registeredHosts,
      activeHostKey,
      activeHostElement,
      registerCallHost,
      requestOpenPip,
      requestOpenEmbeddedForConversation,
      requestOpenEmbeddedForVoice,
      requestOpenFullscreen,
      requestPinEmbeddedGlobal,
      requestUnpinEmbeddedGlobal,
      transitionState,
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
      leaveCall: hangUp,
      toggleMute,
      toggleCamera,
      toggleScreenShare,
      retryConnection,
      joinCallViaInvite,
      clearEndedState,
      isCallForConversation,
      isVoiceChannelActive,
      isProfilePreviewOpen,
      setIsProfilePreviewOpen,
      transitionToPiP,
      transitionToEmbeddedInConversation,
      transitionToEmbeddedIfPossible,
      handleChatDismissWhileEmbedded,
      leaveEmbeddedCallToPiP,
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
      isRestoreLockActive,
      callPresentationMode,
      callHostTarget,
      desiredHostKey,
      registeredHosts,
      activeHostKey,
      activeHostElement,
      registerCallHost,
      requestOpenPip,
      requestOpenEmbeddedForConversation,
      requestOpenEmbeddedForVoice,
      requestOpenFullscreen,
      requestPinEmbeddedGlobal,
      requestUnpinEmbeddedGlobal,
      transitionState,
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
      isProfilePreviewOpen,
      setIsProfilePreviewOpen,
      transitionToPiP,
      transitionToEmbeddedInConversation,
      transitionToEmbeddedIfPossible,
      handleChatDismissWhileEmbedded,
      leaveEmbeddedCallToPiP,
    ]
  );

  const coreValue = useMemo<CallCoreValue>(
    () => ({
      state,
      activeCall,
      incomingCall,
      callDisplayMode,
      isRestoreLockActive,
      callPresentationMode,
      callHostTarget,
      desiredHostKey,
      registeredHosts,
      activeHostKey,
      activeHostElement,
      registerCallHost,
      requestOpenPip,
      requestOpenEmbeddedForConversation,
      requestOpenEmbeddedForVoice,
      requestOpenFullscreen,
      requestPinEmbeddedGlobal,
      requestUnpinEmbeddedGlobal,
      transitionState,
      callPinned,
      pinnedCallHostActive,
      embeddedCallConversationId,
      embeddedVoiceGroupId,
      embeddedVoiceChannelId,
      selfRole,
      jitsiSession: isJitsiCallProvider() && state === 'in_call' ? jitsiJoinRequest : null,
      jitsiMountKey,
      jitsiHandlers,
      mediaCaptureAvailable: mediaCaptureSupported(),
      debugTrail,
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
      toggleCallPinned,
      registerPinnedCallHost,
      startDirectCall,
      joinVoiceChannel,
      leaveVoiceChannel,
      acceptIncomingCall,
      declineIncomingCall,
      hangUp,
      leaveCall: hangUp,
      toggleMute,
      toggleCamera,
      toggleScreenShare,
      retryConnection,
      joinCallViaInvite,
      clearEndedState,
      isCallForConversation,
      isVoiceChannelActive,
      leaveEmbeddedCallToPiP,
    }),
    [
      state, activeCall, incomingCall, callDisplayMode, isRestoreLockActive, callPresentationMode, callHostTarget, desiredHostKey,
      registeredHosts, activeHostKey, activeHostElement, registerCallHost,
      requestOpenPip, requestOpenEmbeddedForConversation, requestOpenEmbeddedForVoice,
      requestOpenFullscreen, requestPinEmbeddedGlobal, requestUnpinEmbeddedGlobal,
      transitionState, callPinned, pinnedCallHostActive,
      embeddedCallConversationId, embeddedVoiceGroupId, embeddedVoiceChannelId, selfRole,
      jitsiJoinRequest, jitsiMountKey, jitsiHandlers, debugTrail,
      setCallDisplayMode, enterCallPip, expandCallToFullscreen, minimizeCallFromFullscreen,
      openCallInChat, openCallInGroupPanel, openCallInPanel,
      registerEmbeddedCallHost, registerEmbeddedVoiceHost, registerCallHostAnchor,
      toggleCallPinned, registerPinnedCallHost, startDirectCall, joinVoiceChannel,
      leaveVoiceChannel, acceptIncomingCall, declineIncomingCall, hangUp,
      toggleMute, toggleCamera, toggleScreenShare, retryConnection,
      joinCallViaInvite, clearEndedState, isCallForConversation, isVoiceChannelActive,
      leaveEmbeddedCallToPiP,
    ]
  );

  const mediaValue = useMemo<CallMediaValue>(
    () => ({
      connectionState,
      isMuted,
      isCameraEnabled,
      isScreenShareEnabled,
      errorMessage,
      canRetryConnection,
      retryAttempt,
      isAutoRetrying,
      localIdentity,
      remoteParticipantCount,
      remoteVideoActive,
      remoteScreenShareActive,
      participantVolumes,
      speakingParticipantId,
      setParticipantVolume,
    }),
    [
      connectionState, isMuted, isCameraEnabled, isScreenShareEnabled, errorMessage,
      canRetryConnection, retryAttempt, isAutoRetrying, localIdentity,
      remoteParticipantCount, remoteVideoActive, remoteScreenShareActive,
      participantVolumes, speakingParticipantId, setParticipantVolume,
    ]
  );

  return (
    <CallCoreContext.Provider value={coreValue}>
      <CallMediaContext.Provider value={mediaValue}>
        <CallContext.Provider value={value}>
      {/* JitsiCallView */}
      {children}
      <Suspense fallback={null}>
        <IncomingCallPopup />
      </Suspense>
      {showGlobalCallHost ? (
        <FloatingCallWidget
          displayMode={callDisplayMode}
          hostAnchorEl={callDisplayMode === 'embedded' ? callHostAnchorEl : null}
          registerCallHost={registerCallHost}
          callHostTarget={callHostTarget}
          activeCall={activeCall}
          callPinned={callPinned}
          onExpandedChange={(expanded) => {
            console.log(`[CALL FLOW DEBUG] [onExpandedChange] expanded=${expanded}`);
            if (typeof window !== 'undefined' && (window as any).__traceCallPipRequest) {
              (window as any).__traceCallPipRequest(`onExpandedChange_expanded=${expanded}`, 'FloatingCallWidget:onExpandedChange');
            }

            // Gating: Block passive/automated minimize to PiP during active restore or handover window
            if (!expanded) {
              const isLockActive = isRestoreLockActive;
              const diff = performance.now() - ((window as any).__lastTransitionLockTs || 0);
              const inRestoreWindow = diff < 1500;
              const isRestoreFlowActive = isLockActive || inRestoreWindow;

              if (isRestoreFlowActive) {
                console.log(`[CALL GUARD DEBUG] blocked onExpandedChange(false) because restore/handover is active. isLockActive=${isLockActive}, diff=${diff.toFixed(1)}ms`);
                return;
              }
            }

            if (expanded) expandCallToFullscreen();
            else if (embeddedJitsiActive) setCallDisplayMode('embedded');
            else enterCallPip();
          }}
          onMinimizeToPip={() => {
            console.log(`[CALL FLOW DEBUG] [onMinimizeToPip] triggered`);
            if (typeof window !== 'undefined' && (window as any).__traceCallPipRequest) {
              (window as any).__traceCallPipRequest('onMinimizeToPip', 'FloatingCallWidget:onMinimizeToPip');
            }
            enterCallPip();
          }}
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
          onRestoreEmbedded={openCallInPanel}
          onClosePip={openCallInPanel}
          onEnterFullscreen={expandCallToFullscreen}
          isProfilePreviewOpen={isProfilePreviewOpen}
        />
      ) : null}
        </CallContext.Provider>
      </CallMediaContext.Provider>
    </CallCoreContext.Provider>
  );
}

export function useCall(): CallContextValue {
  const context = useContext(CallContext);
  if (!context) {
    throw new Error('useCall must be used within CallProvider');
  }
  return context;
}

export function useCallCore(): CallCoreValue {
  const context = useContext(CallCoreContext);
  if (!context) {
    throw new Error('useCallCore must be used within CallProvider');
  }
  return context;
}

export function useCallMedia(): CallMediaValue {
  const context = useContext(CallMediaContext);
  if (!context) {
    throw new Error('useCallMedia must be used within CallProvider');
  }
  return context;
}
