import { assertServerAuthorizedRoom } from './jitsiCall';
import { markJitsiMicGranted } from './jitsiMicStorage';
import { BLYVE_MEDIA_MESSAGE, BLYVE_SPEAKING_MESSAGE, parseBlyveMediaMessage, parseBlyveSpeakingMessage } from './callAudioLevels';

export interface JitsiRemoteMediaState {
  remoteVideoActive: boolean;
  remoteScreenShareActive: boolean;
}

export type CallMediaType = 'audio' | 'video' | 'screen';

export interface JitsiMountOptions {
  container: HTMLElement;
  /** Must match the authorized joinCall session — rejects client-derived room names. */
  sessionId: string;
  domain: string;
  roomName: string;
  displayName: string;
  callType: CallMediaType;
  userId?: string;
  jwt: string;
  jitsiAppId?: string;
  onConnectionEstablished?: () => void;
  onReadyToClose?: () => void;
  onParticipantJoined?: () => void;
  onParticipantLeft?: () => void;
  onAudioMuteChanged?: (muted: boolean) => void;
  onVideoMuteChanged?: (muted: boolean) => void;
  onScreenShareChanged?: (active: boolean) => void;
  onDominantSpeakerChanged?: (participantId: string | null) => void;
  onConferenceJoined?: (payload: { id?: string; displayName?: string }) => void;
  onRemoteParticipantJoined?: (payload: { id?: string; displayName?: string }) => void;
  onRemoteMediaChanged?: (state: JitsiRemoteMediaState) => void;
  onRemoteSpeakingChanged?: (payload: {
    participantId?: string;
    speaking: boolean;
    levelDb: number;
  }) => void;
  onRemoteMediaSync?: (payload: {
    participantId?: string;
    camera: boolean;
    screenShare: boolean;
  }) => void;
  onAuthError?: (message: string) => void;
}

export interface JitsiHandle {
  dispose: () => void;
  toggleAudio: () => void;
  toggleVideo: () => void;
  toggleScreenShare: () => void;
  isAudioMuted: () => boolean;
  isVideoMuted: () => boolean;
  ensureAudioUnmuted: () => void;
  setAudioMuted: (muted: boolean) => void;
  setUserRequestedAudioMute: (muted: boolean) => void;
  setParticipantVolume: (participantId: string, volume: number) => void;
  broadcastSpeakingState: (speaking: boolean, levelDb: number) => void;
  broadcastMediaState: (camera: boolean, screenShare: boolean) => void;
  focusRemoteDesktop: (participantId: string) => void;
  focusRemoteParticipant: (participantId: string, videoType?: 'camera' | 'desktop') => void;
  getRemoteParticipantIds: () => string[];
}

declare global {
  interface Window {
    JitsiMeetExternalAPI?: new (
      domain: string,
      options: Record<string, unknown>,
    ) => {
      dispose: () => void;
      executeCommand: (command: string, ...args: unknown[]) => void;
      isAudioMuted: () => boolean;
      isVideoMuted: () => boolean;
      addListener: (event: string, handler: (...args: unknown[]) => void) => void;
      getParticipantsInfo?: () => Array<{
        participantId?: string;
        displayName?: string;
        videoMuted?: boolean;
      }>;
      getContentSharingParticipants?: () => Promise<string[]>;
    };
  }
}

const scriptPromises = new Map<string, Promise<void>>();
let loadedExternalApiKey: string | null = null;

function externalApiCacheKey(domain: string, appId?: string): string {
  return appId ? `${domain}:${appId}` : domain;
}

const JITSI_IFRAME_ALLOW =
  'autoplay; camera; clipboard-write; compute-pressure; display-capture; encrypted-media; fullscreen; microphone; screen-wake-lock';

const JITSI_UNSUPPORTED_ALLOW_TOKENS = new Set([
  'speaker-selection',
  'hid',
  'serial',
  'usb',
  'bluetooth',
]);

function buildJitsiIframeAllow(domain?: string): string {
  const normalizedDomain = domain?.trim();
  if (!normalizedDomain) return JITSI_IFRAME_ALLOW;

  return [
    'autoplay',
    `camera https://${normalizedDomain}`,
    `microphone https://${normalizedDomain}`,
    `display-capture https://${normalizedDomain}`,
    'clipboard-write',
    'compute-pressure',
    'encrypted-media',
    'fullscreen',
    'screen-wake-lock',
  ].join('; ');
}

function sanitizeAllowTokens(value: string, fallback: string): string {
  const tokens = value
    .split(';')
    .map((token) => token.trim())
    .filter(Boolean)
    .filter((token) => {
      const feature = token.split(/\s+/)[0]?.toLowerCase();
      return feature && !JITSI_UNSUPPORTED_ALLOW_TOKENS.has(feature);
    });

  return tokens.length > 0 ? tokens.join('; ') : fallback;
}

let iframeAllowInterceptorInstalled = false;

/** Strip unsupported allow tokens before the iframe navigates to Jitsi. */
function installJitsiIframeAllowInterceptor(domain?: string) {
  if (iframeAllowInterceptorInstalled || typeof document === 'undefined') return;

  const fallbackAllow = buildJitsiIframeAllow(domain);
  const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'allow');
  const nativeGet = descriptor?.get;
  const nativeSet = descriptor?.set;
  if (!nativeGet || !nativeSet) return;

  Object.defineProperty(HTMLIFrameElement.prototype, 'allow', {
    configurable: true,
    enumerable: descriptor.enumerable ?? true,
    get() {
      return nativeGet.call(this);
    },
    set(value: string) {
      nativeSet.call(this, sanitizeAllowTokens(String(value || ''), fallbackAllow));
    },
  });

  iframeAllowInterceptorInstalled = true;
}

/** Jitsi external_api.js adds unsupported allow tokens — keep iframe permissions valid after mount too. */
function patchJitsiIframePermissions(container: HTMLElement, domain?: string) {
  const fallbackAllow = buildJitsiIframeAllow(domain);
  container.querySelectorAll('iframe').forEach((node) => {
    const iframe = node as HTMLIFrameElement;
    const cleaned = sanitizeAllowTokens(iframe.allow || '', fallbackAllow);
    if (iframe.allow !== cleaned) {
      iframe.allow = cleaned;
    }
  });
}

function observeJitsiIframePermissions(container: HTMLElement, domain?: string) {
  patchJitsiIframePermissions(container, domain);

  const observer = new MutationObserver(() => {
    patchJitsiIframePermissions(container, domain);
  });
  observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['allow'] });

  const intervalId = window.setInterval(() => {
    patchJitsiIframePermissions(container, domain);
  }, 100);

  return () => {
    observer.disconnect();
    window.clearInterval(intervalId);
  };
}

export function loadJitsiExternalApi(domain: string, appId?: string): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }

  installJitsiIframeAllowInterceptor(domain);

  const cacheKey = externalApiCacheKey(domain, appId?.trim() || undefined);
  const scriptSrc = appId?.trim()
    ? `https://${domain}/${appId.trim()}/external_api.js`
    : `https://${domain}/external_api.js`;

  if (window.JitsiMeetExternalAPI && loadedExternalApiKey === cacheKey) {
    return Promise.resolve();
  }

  if (window.JitsiMeetExternalAPI && loadedExternalApiKey !== cacheKey) {
    delete (window as Window & { JitsiMeetExternalAPI?: unknown }).JitsiMeetExternalAPI;
    loadedExternalApiKey = null;
    document
      .querySelectorAll('script[src*="external_api.js"]')
      .forEach((node) => node.parentElement?.removeChild(node));
  }

  const existing = scriptPromises.get(cacheKey);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = scriptSrc;
    script.async = true;
    script.onload = () => {
      loadedExternalApiKey = cacheKey;
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load Jitsi script from ${scriptSrc}`));
    document.head.appendChild(script);
  });

  scriptPromises.set(cacheKey, promise);
  return promise;
}

function readJitsiParticipantId(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.trim()) return raw;
  if (raw && typeof raw === 'object' && 'id' in raw) {
    const id = (raw as { id?: unknown }).id;
    return typeof id === 'string' && id.trim() ? id : null;
  }
  return null;
}

function readJitsiParticipantPayload(raw: unknown): { id?: string; displayName?: string } {
  if (!raw || typeof raw !== 'object') return {};
  const payload = raw as { id?: unknown; displayName?: unknown; formattedDisplayName?: unknown };
  return {
    id: typeof payload.id === 'string' ? payload.id : undefined,
    displayName:
      typeof payload.displayName === 'string'
        ? payload.displayName
        : typeof payload.formattedDisplayName === 'string'
          ? payload.formattedDisplayName
          : undefined,
  };
}

/** Mount Jitsi only with credentials returned by joinCall (via JitsiCallView). */
export async function mountJitsiMeetingFromServerJoin(
  options: JitsiMountOptions,
): Promise<JitsiHandle> {
  const { container, sessionId, domain, roomName, displayName, callType, userId, jwt, jitsiAppId } =
    options;
  const resolvedDomain = domain.trim();
  const resolvedRoom = roomName.trim();
  const resolvedSessionId = sessionId.trim();

  if (!resolvedSessionId) {
    throw new Error('Jitsi session id is required for authorized mount');
  }
  if (!resolvedDomain || !resolvedRoom) {
    throw new Error('Jitsi domain and room must come from authorized join response');
  }

  assertServerAuthorizedRoom(resolvedRoom, resolvedSessionId);
  const resolvedJwt = jwt.trim();
  if (!resolvedJwt) {
    throw new Error(
      'Jitsi JWT is required. Configure JITSI_APP_ID and JITSI_APP_SECRET on the server.',
    );
  }
  await loadJitsiExternalApi(resolvedDomain, jitsiAppId?.trim() || undefined);

  if (!window.JitsiMeetExternalAPI) {
    throw new Error('Jitsi External API unavailable');
  }

  const videoMuted = callType === 'audio';
  installJitsiIframeAllowInterceptor(resolvedDomain);
  let stopObservingIframe: (() => void) | null = null;
  stopObservingIframe = observeJitsiIframePermissions(container, resolvedDomain);

  const api = new window.JitsiMeetExternalAPI(resolvedDomain, {
    roomName: resolvedRoom,
    parentNode: container,
    width: '100%',
    height: '100%',
    jwt: resolvedJwt,
    userInfo: {
      displayName,
      ...(userId ? { id: userId } : {}),
    },
    configOverwrite: {
      prejoinPageEnabled: false,
      prejoinConfig: { enabled: false },
      requireDisplayName: false,
      enableLobbyChatSupport: false,
      hideLobbyButton: true,
      lobby: {
        autoKnock: false,
        enableChat: false,
      },
      startWithAudioMuted: false,
      startWithVideoMuted: videoMuted,
      ignoreStartMuted: true,
      startSilent: false,
      disableModeratorIndicator: true,
      enableWelcomePage: false,
      enableClosePage: false,
      disableDeepLinking: true,
      enableInsecureRoomNameWarning: false,
      disableThirdPartyRequests: true,
      enableBrowserWarningPage: false,
      disableInitialGUM: false,
      disableFilmstrip: true,
      disableTileView: true,
      disableSelfView: true,
      disableSelfViewSettings: true,
      disableTileEnlargement: true,
      // JaaS requires Jicofo focus to create the MUC — never disable on 8x8.vc.
      hideDominantSpeakerBadge: true,
      enableTalkWhileMuted: false,
      enableNoAudioDetection: false,
      disabledNotifications: [
        'toolbar.talkWhileMutedPopup',
        'notify.unmute',
        'notify.muted',
        'notify.mutedTitle',
        'notify.mutedRemotelyTitle',
        'notify.mutedRemotelyDescription',
      ],
      disabledSounds: ['TALK_WHILE_MUTED_SOUND', 'ASKED_TO_UNMUTE_SOUND'],
      flags: {
        'notifications.enabled': false,
      },
      faceLandmarks: {
        enableFaceExpressionsDetection: false,
        enableFaceCentering: false,
        enableDisplayFaceExpressions: false,
      },
      filmstrip: {
        disabled: true,
        disableStageFilmstrip: true,
        disableTopPanel: true,
        disableResizable: true,
      },
    },
    interfaceConfigOverwrite: {
      TOOLBAR_BUTTONS: [],
      SHOW_JITSI_WATERMARK: false,
      SHOW_WATERMARK_FOR_GUESTS: false,
      DISABLE_JOIN_LEAVE_NOTIFICATIONS: true,
      FILM_STRIP_MAX_HEIGHT: 0,
      VERTICAL_FILMSTRIP: false,
      DISABLE_VIDEO_BACKGROUND: true,
      HIDE_INVITE_MORE_HEADER: true,
      MOBILE_APP_PROMO: false,
      ENABLE_BROWSER_WARNING_PAGE: false,
    },
  });

  patchJitsiIframePermissions(container, resolvedDomain);
  window.requestAnimationFrame(() => patchJitsiIframePermissions(container, resolvedDomain));
  window.setTimeout(() => patchJitsiIframePermissions(container, resolvedDomain), 0);

  let localParticipantId: string | null = null;
  let remoteMediaPollId: number | null = null;
  let lastRemoteMedia: JitsiRemoteMediaState = {
    remoteVideoActive: false,
    remoteScreenShareActive: false,
  };
  let activeRemoteSharerIds: string[] = [];
  let userRequestedAudioMute = false;
  const ensureUnmuteTimeoutIds: number[] = [];
  let conferenceJoined = false;

  const setAudioMuted = (muted: boolean) => {
    try {
      if (api.isAudioMuted() === muted) return;
      api.executeCommand('toggleAudio', muted);
    } catch {
      // best effort
    }
  };

  const ensureAudioUnmuted = () => {
    if (userRequestedAudioMute) return;
    setAudioMuted(false);
  };

  const scheduleEnsureAudioUnmuted = () => {
    if (!conferenceJoined) return;
    for (const timeoutId of ensureUnmuteTimeoutIds) {
      window.clearTimeout(timeoutId);
    }
    ensureUnmuteTimeoutIds.length = 0;
    // After Jicofo grants moderator/unmute permissions.
    for (const delayMs of [800, 2000]) {
      ensureUnmuteTimeoutIds.push(window.setTimeout(ensureAudioUnmuted, delayMs));
    }
  };

  const focusRemoteParticipant = (participantId: string, videoType: 'camera' | 'desktop' = 'camera') => {
    if (!participantId || participantId === localParticipantId) return;
    try {
      if (videoType === 'desktop') {
        api.executeCommand('setLargeVideoParticipant', participantId, 'desktop');
      } else {
        api.executeCommand('setLargeVideoParticipant', participantId);
      }
    } catch {
      // best effort
    }
  };

  const emitRemoteMedia = (next: JitsiRemoteMediaState, opts?: { allowClear?: boolean }) => {
    const merged: JitsiRemoteMediaState = opts?.allowClear
      ? next
      : {
          remoteVideoActive: next.remoteVideoActive || lastRemoteMedia.remoteVideoActive,
          remoteScreenShareActive:
            next.remoteScreenShareActive || lastRemoteMedia.remoteScreenShareActive,
        };

    if (
      merged.remoteVideoActive === lastRemoteMedia.remoteVideoActive &&
      merged.remoteScreenShareActive === lastRemoteMedia.remoteScreenShareActive
    ) {
      return;
    }

    lastRemoteMedia = merged;
    options.onRemoteMediaChanged?.(merged);
  };

  const clearRemoteScreenShare = () => {
    const hadScreenShare = lastRemoteMedia.remoteScreenShareActive;
    if (!hadScreenShare) return;
    activeRemoteSharerIds = [];
    emitRemoteMedia(
      {
        remoteVideoActive: false,
        remoteScreenShareActive: false,
      },
      { allowClear: true }
    );
  };

  const readContentSharingIds = (raw: unknown): string[] => {
    if (Array.isArray(raw)) {
      return raw.filter((id): id is string => typeof id === 'string' && !!id.trim());
    }
    if (raw && typeof raw === 'object' && 'data' in raw) {
      const data = (raw as { data?: unknown }).data;
      if (Array.isArray(data)) {
        return data.filter((id): id is string => typeof id === 'string' && !!id.trim());
      }
    }
    return [];
  };

  const snapshotRemoteMedia = () => {
    let remoteVideoActive = false;
    let remoteScreenShareActive = false;

    if (typeof api.getParticipantsInfo === 'function') {
      try {
        const infos = api.getParticipantsInfo() as Array<{
          participantId?: string;
          videoMuted?: boolean;
          videoType?: string;
        }>;
        for (const info of infos) {
          if (!info.participantId || info.participantId === localParticipantId) continue;
          const videoType = String(info.videoType || '').toLowerCase();
          if (
            info.videoMuted === false ||
            videoType === 'desktop' ||
            videoType === 'camera'
          ) {
            remoteVideoActive = true;
          }
          if (videoType === 'desktop') {
            remoteScreenShareActive = true;
          }
        }
      } catch {
        // ignore polling failures
      }
    }

    if (typeof api.getContentSharingParticipants === 'function') {
      void api
        .getContentSharingParticipants()
        .then((ids) => {
          const remoteSharers = ids.filter((id) => id && id !== localParticipantId);
          activeRemoteSharerIds = remoteSharers;
          if (remoteSharers.length > 0) {
            remoteScreenShareActive = true;
            remoteVideoActive = true;
            focusRemoteParticipant(remoteSharers[0], 'desktop');
          }
          emitRemoteMedia({ remoteVideoActive, remoteScreenShareActive });
        })
        .catch(() => {
          if (remoteVideoActive || remoteScreenShareActive) {
            emitRemoteMedia({ remoteVideoActive, remoteScreenShareActive });
          }
        });
      return;
    }

    emitRemoteMedia({ remoteVideoActive, remoteScreenShareActive });
  };

  const scheduleRemoteMediaSnapshot = (delayMs = 400) => {
    window.setTimeout(snapshotRemoteMedia, delayMs);
  };

  api.addListener('videoConferenceJoined', (...args: unknown[]) => {
    markJitsiMicGranted();
    conferenceJoined = true;
    const payload = readJitsiParticipantPayload(args[0]);
    localParticipantId = payload.id ?? null;
    options.onConferenceJoined?.(payload);
    options.onConnectionEstablished?.();
    scheduleRemoteMediaSnapshot(800);
    scheduleEnsureAudioUnmuted();
  });
  api.addListener('errorOccurred', (...args: unknown[]) => {
    const payload = args[0] as { error?: { message?: string; name?: string } } | undefined;
    const message = String(payload?.error?.message || payload?.error?.name || '').trim();
    if (message) {
      console.error('Jitsi errorOccurred:', message, payload);
      const lower = message.toLowerCase();
      if (
        lower.includes('not allowed') ||
        lower.includes('room does not exist') ||
        lower.includes('connectionerror') ||
        lower.includes('authentication') ||
        lower.includes('jwt') ||
        lower.includes('token')
      ) {
        options.onAuthError?.(message);
      }
    }
  });
  api.addListener('readyToClose', () => {
    options.onReadyToClose?.();
  });
  api.addListener('participantJoined', (...args: unknown[]) => {
    const payload = readJitsiParticipantPayload(args[0]);
    options.onRemoteParticipantJoined?.(payload);
    options.onParticipantJoined?.();
    scheduleRemoteMediaSnapshot(800);
  });
  api.addListener('participantLeft', () => {
    options.onParticipantLeft?.();
    scheduleRemoteMediaSnapshot(300);
  });
  api.addListener('dominantSpeakerChanged', (...args: unknown[]) => {
    options.onDominantSpeakerChanged?.(readJitsiParticipantId(args[0]));
  });
  api.addListener('contentSharingParticipantsChanged', (...args: unknown[]) => {
    const sharers = readContentSharingIds(args[0]);
    activeRemoteSharerIds = sharers.filter((id) => id && id !== localParticipantId);
    const remoteScreenShareActive = activeRemoteSharerIds.length > 0;
    if (remoteScreenShareActive) {
      emitRemoteMedia({
        remoteVideoActive: true,
        remoteScreenShareActive: true,
      });
      focusRemoteParticipant(activeRemoteSharerIds[0], 'desktop');
      options.onRemoteMediaSync?.({
        participantId: activeRemoteSharerIds[0],
        camera: false,
        screenShare: true,
      });
    } else {
      clearRemoteScreenShare();
    }
    scheduleRemoteMediaSnapshot(200);
  });
  api.addListener('largeVideoChanged', (...args: unknown[]) => {
    const participantId =
      readJitsiParticipantId(args[0]) ??
      readJitsiParticipantId(args[1]) ??
      (typeof args[0] === 'string' ? args[0] : null);
    if (participantId && participantId !== localParticipantId) {
      const isScreenShare =
        activeRemoteSharerIds.includes(participantId) || lastRemoteMedia.remoteScreenShareActive;
      emitRemoteMedia({
        remoteVideoActive: true,
        remoteScreenShareActive: isScreenShare,
      });
      focusRemoteParticipant(participantId, isScreenShare ? 'desktop' : 'camera');
      options.onRemoteMediaSync?.({
        participantId,
        camera: !isScreenShare,
        screenShare: isScreenShare,
      });
    } else if (!participantId || participantId === localParticipantId) {
      scheduleRemoteMediaSnapshot(200);
    }
  });
  api.addListener('participantMuted', (...args: unknown[]) => {
    const payload = args[0] as
      | { participantId?: string; isMuted?: boolean; mediaType?: string }
      | undefined;
    if (!payload?.participantId || payload.participantId === localParticipantId) return;
    if (payload.mediaType === 'video' && payload.isMuted === false) {
      const isScreenShare =
        activeRemoteSharerIds.includes(payload.participantId) ||
        lastRemoteMedia.remoteScreenShareActive;
      emitRemoteMedia({
        remoteVideoActive: true,
        remoteScreenShareActive: isScreenShare,
      });
      focusRemoteParticipant(payload.participantId, isScreenShare ? 'desktop' : 'camera');
      options.onRemoteMediaSync?.({
        participantId: payload.participantId,
        camera: !isScreenShare,
        screenShare: isScreenShare,
      });
    } else if (payload.mediaType === 'video' && payload.isMuted === true) {
      if (activeRemoteSharerIds.includes(payload.participantId)) {
        clearRemoteScreenShare();
      }
    }
    scheduleRemoteMediaSnapshot(150);
  });
  api.addListener('endpointTextMessageReceived', (...args: unknown[]) => {
    const payload = args[0] as
      | {
          senderInfo?: { id?: string };
          eventData?: { text?: string };
        }
      | undefined;
    const text = String(payload?.eventData?.text || '');
    const speakingPayload = parseBlyveSpeakingMessage(text);
    if (speakingPayload) {
      options.onRemoteSpeakingChanged?.({
        participantId: payload?.senderInfo?.id,
        speaking: speakingPayload.speaking,
        levelDb: speakingPayload.levelDb,
      });
      return;
    }
    const mediaPayload = parseBlyveMediaMessage(text);
    if (mediaPayload) {
      if (mediaPayload.camera || mediaPayload.screenShare) {
        emitRemoteMedia({
          remoteVideoActive: true,
          remoteScreenShareActive: mediaPayload.screenShare,
        });
      } else {
        emitRemoteMedia(
          {
            remoteVideoActive: false,
            remoteScreenShareActive: false,
          },
          { allowClear: true }
        );
      }
      options.onRemoteMediaSync?.({
        participantId: payload?.senderInfo?.id,
        camera: mediaPayload.camera,
        screenShare: mediaPayload.screenShare,
      });
    }
  });
  api.addListener('videoAvailabilityChanged', (...args: unknown[]) => {
    const payload = args[0] as { available?: boolean; participantId?: string; id?: string } | undefined;
    const participantId = readJitsiParticipantId(payload) ?? payload?.participantId ?? null;
    if (payload?.available && participantId && participantId !== localParticipantId) {
      emitRemoteMedia({
        remoteVideoActive: true,
        remoteScreenShareActive: lastRemoteMedia.remoteScreenShareActive,
      });
      focusRemoteParticipant(participantId, 'camera');
      options.onRemoteMediaSync?.({
        participantId,
        camera: true,
        screenShare: false,
      });
    }
  });
  api.addListener('audioMuteStatusChanged', (...args: unknown[]) => {
    const payload = args[0] as { muted?: boolean } | undefined;
    options.onAudioMuteChanged?.(Boolean(payload?.muted));
  });
  api.addListener('videoMuteStatusChanged', (...args: unknown[]) => {
    const payload = args[0] as { muted?: boolean } | undefined;
    options.onVideoMuteChanged?.(Boolean(payload?.muted));
    scheduleRemoteMediaSnapshot(300);
  });
  api.addListener('screenSharingStatusChanged', (...args: unknown[]) => {
    const payload = args[0] as {
      on?: boolean;
      enabled?: boolean;
      participantId?: string;
      id?: string;
    } | undefined;
    const active = Boolean(payload?.on ?? payload?.enabled);
    const participantId =
      readJitsiParticipantId(payload) ?? payload?.participantId ?? null;
    options.onScreenShareChanged?.(active && (!participantId || participantId === localParticipantId));
    if (participantId && participantId !== localParticipantId && active) {
      activeRemoteSharerIds = [participantId];
      emitRemoteMedia({
        remoteVideoActive: true,
        remoteScreenShareActive: true,
      });
      focusRemoteParticipant(participantId, 'desktop');
      options.onRemoteMediaSync?.({
        participantId,
        camera: false,
        screenShare: true,
      });
    }
    scheduleRemoteMediaSnapshot(active ? 200 : 0);
  });

  remoteMediaPollId = window.setInterval(snapshotRemoteMedia, 500);
  scheduleRemoteMediaSnapshot(400);
  scheduleRemoteMediaSnapshot(900);
  scheduleRemoteMediaSnapshot(1500);
  scheduleRemoteMediaSnapshot(3000);

  const getRemoteParticipantIds = (): string[] => {
    if (typeof api.getParticipantsInfo !== 'function') return [];
    try {
      return api
        .getParticipantsInfo()
        .map((info) => info.participantId)
        .filter((id): id is string => !!id && id !== localParticipantId);
    } catch {
      return [];
    }
  };

  return {
    dispose: () => {
      for (const timeoutId of ensureUnmuteTimeoutIds) {
        window.clearTimeout(timeoutId);
      }
      ensureUnmuteTimeoutIds.length = 0;
      if (remoteMediaPollId) {
        window.clearInterval(remoteMediaPollId);
        remoteMediaPollId = null;
      }
      stopObservingIframe?.();
      stopObservingIframe = null;
      try {
        api.dispose();
      } catch {
        // ignore teardown races
      }
    },
    toggleAudio: () => {
      setAudioMuted(!api.isAudioMuted());
    },
    toggleVideo: () => api.executeCommand('toggleVideo'),
    toggleScreenShare: () => api.executeCommand('toggleShareScreen'),
    isAudioMuted: () => api.isAudioMuted(),
    isVideoMuted: () => api.isVideoMuted(),
    ensureAudioUnmuted,
    setAudioMuted,
    setUserRequestedAudioMute: (muted: boolean) => {
      userRequestedAudioMute = muted;
    },
    setParticipantVolume: (participantId: string, volume: number) => {
      const clamped = Math.max(0, Math.min(1, volume));
      api.executeCommand('setParticipantVolume', participantId, clamped);
    },
    broadcastSpeakingState: (speaking: boolean, levelDb: number) => {
      const message = JSON.stringify({
        type: BLYVE_SPEAKING_MESSAGE,
        speaking,
        levelDb,
      });
      for (const participantId of getRemoteParticipantIds()) {
        try {
          api.executeCommand('sendEndpointTextMessage', participantId, message);
        } catch {
          // best effort
        }
      }
    },
    broadcastMediaState: (camera: boolean, screenShare: boolean) => {
      const message = JSON.stringify({
        type: BLYVE_MEDIA_MESSAGE,
        camera,
        screenShare,
      });
      for (const participantId of getRemoteParticipantIds()) {
        try {
          api.executeCommand('sendEndpointTextMessage', participantId, message);
        } catch {
          // best effort
        }
      }
    },
    focusRemoteDesktop: (participantId: string) => {
      focusRemoteParticipant(participantId, 'desktop');
    },
    focusRemoteParticipant,
    getRemoteParticipantIds,
  };
}
