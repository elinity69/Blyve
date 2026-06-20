import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minimize2, User, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getOptimizedImageUrl } from '../lib/images';
import { takeDomSnapshot } from '../lib/domSnapshot';
import type { CallMediaType, JitsiHandle } from '../lib/jitsi';
import type { JitsiJoinCredentials } from '../lib/jitsiCall';
import type { CallStageParticipant } from './CallParticipantStage';
import {
  CallParticipantVolumeMenu,
  VOLUME_MENU_HEIGHT,
  VOLUME_MENU_WIDTH,
} from './CallParticipantVolumeMenu';
import type { JitsiCallLayout } from './JitsiCallView';
import { CallControlBar } from './JitsiCallView';
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
  registerCallHost?: (hostKey: string, element: HTMLElement | null) => void;
  callHostTarget?: any;
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
  onRestoreEmbedded: () => void;
  onClosePip: () => void;
  onEnterFullscreen: () => void;
  onExpandedChange?: (expanded: boolean) => void;
  onMinimizeToPip?: () => void;
  onTogglePin?: () => void;
  isProfilePreviewOpen?: boolean;
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
  registerCallHost,
  callHostTarget,
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
  onRestoreEmbedded,
  onClosePip,
  onEnterFullscreen,
  onExpandedChange,
  onMinimizeToPip,
  onTogglePin,
  isProfilePreviewOpen = false,
}: FloatingCallWidgetProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const isEmbedded = displayMode === 'embedded';
  const isFullscreen = displayMode === 'fullscreen';
  const showPipChrome = !isEmbedded;
  const [pipHovered, setPipHovered] = useState(false);
  const [pipControlsVisible, setPipControlsVisible] = useState(false);
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

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__dragCallPip = (dx: number, dy: number) => {
        setPosition((prev) => clampPosition(prev.x + dx, prev.y + dy));
      };
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).__dragCallPip;
      }
    };
  }, []);
  const [remoteStreamActive, setRemoteStreamActive] = useState(false);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
    pointerId: number | null;
  } | null>(null);
  const pipContentRefVal = useRef<HTMLDivElement | null>(null);
  const pipContentRef = useCallback((node: HTMLDivElement | null) => {
    pipContentRefVal.current = node;
    if (node && registerCallHost && displayMode === 'pip') {
      registerCallHost('pip', node);
    }
  }, [displayMode, registerCallHost]);
  const pipContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = pipContainerRef.current;
    if (!el) return;

    const blockAndShield = (e: Event) => {
      const target = e.target as HTMLElement;
      if (el.contains(target)) {
        e.stopPropagation();
        if (e.stopImmediatePropagation) {
          e.stopImmediatePropagation();
        }
        if (!target.closest('button, [data-call-controls], [data-pip-avatar], [data-pip-drag-handle], select, input')) {
          e.preventDefault();
        }
      }
    };

    const events = [
      'pointerdown', 'pointerup', 'click', 'dblclick', 
      'touchstart', 'touchend', 'mousedown', 'mouseup', 
      'contextmenu', 'pointermove', 'touchmove', 'mousemove'
    ];

    events.forEach(name => {
      document.body.addEventListener(name, blockAndShield, { capture: false, passive: false });
    });

    return () => {
      events.forEach(name => {
        document.body.removeEventListener(name, blockAndShield, { capture: false });
      });
    };
  }, [showPipChrome, isFullscreen]);
  const jitsiSurfaceRef = useRef<HTMLDivElement | null>(null);
  const hasStreamRef = useRef(false);
  const lastPipOpenTapAtRef = useRef(0);
  const onEnterFullscreenRef = useRef(onEnterFullscreen);
  const onRestoreEmbeddedRef = useRef(onRestoreEmbedded);
  const onClosePipRef = useRef(onClosePip);

  onEnterFullscreenRef.current = onEnterFullscreen;
  onRestoreEmbeddedRef.current = onRestoreEmbedded;
  onClosePipRef.current = onClosePip;

  useLayoutEffect(() => {
    if (!registerCallHost) return;
    if (displayMode === 'pip') {
      registerCallHost('pip', pipContentRefVal.current);
      return () => registerCallHost('pip', null);
    } else if (displayMode === 'fullscreen') {
      registerCallHost('fullscreen', jitsiSurfaceRef.current);
      return () => registerCallHost('fullscreen', null);
    }
  }, [displayMode, registerCallHost]);

  const openCallWindowFromPip = useCallback(() => {
    onRestoreEmbeddedRef.current();
  }, []);

  const displayParticipants = stageParticipants;

  const hasStream =
    isCameraEnabled ||
    isScreenShareEnabled ||
    remoteVideoActive ||
    remoteScreenShareActive ||
    remoteStreamActive;

  hasStreamRef.current = hasStream;

  const layout: JitsiCallLayout = isEmbedded ? 'embedded' : isFullscreen ? 'standalone' : 'pip';

  const syncJitsiSurfaceBounds = useCallback(() => {
    const surface = jitsiSurfaceRef.current;
    if (!surface) return;

    // Fullscreen bounds are controlled by React via jitsiSurfaceStyle — skip imperative update.
    if (isFullscreen) return;

    const target =
      isEmbedded && hostAnchorEl ? hostAnchorEl : showPipChrome ? pipContentRefVal.current : null;

    if (!target) {
      surface.style.visibility = 'hidden';
      surface.style.width = '0px';
      surface.style.height = '0px';
      return;
    }

    const rect = target.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
      surface.style.visibility = 'hidden';
      surface.style.width = '0px';
      surface.style.height = '0px';
      return;
    }

    surface.style.visibility = 'visible';
    surface.style.left = `${rect.left}px`;
    surface.style.top = `${rect.top}px`;
    surface.style.width = `${rect.width}px`;
    surface.style.height = `${rect.height}px`;
    surface.style.zIndex = isEmbedded ? '120' : '134';
    surface.style.pointerEvents = showPipChrome ? 'none' : 'auto';
  }, [hostAnchorEl, isEmbedded, isFullscreen, showPipChrome]);

  useLayoutEffect(() => {
    // Sync immediately
    syncJitsiSurfaceBounds();

    // Sync on next animation frame to catch layout shifts
    const rafId = requestAnimationFrame(() => {
      syncJitsiSurfaceBounds();
    });

    const target =
      isEmbedded && hostAnchorEl ? hostAnchorEl : showPipChrome ? pipContentRefVal.current : null;

    // In fullscreen, React controls the surface style — no observers needed.
    if (isFullscreen) {
      return () => {
        cancelAnimationFrame(rafId);
      };
    }

    if (!target) {
      return () => {
        cancelAnimationFrame(rafId);
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      syncJitsiSurfaceBounds();
      // Ensure we catch it on layout changes as well
      requestAnimationFrame(() => syncJitsiSurfaceBounds());
    });
    resizeObserver.observe(target);

    const handleVisualViewportChange = () => {
      syncJitsiSurfaceBounds();
    };

    window.addEventListener('scroll', syncJitsiSurfaceBounds, true);
    window.addEventListener('resize', syncJitsiSurfaceBounds);
    window.addEventListener('orientationchange', syncJitsiSurfaceBounds);
    window.addEventListener('navigation-swipe', syncJitsiSurfaceBounds);
    
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleVisualViewportChange);
      window.visualViewport.addEventListener('scroll', handleVisualViewportChange);
    }

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      window.removeEventListener('scroll', syncJitsiSurfaceBounds, true);
      window.removeEventListener('resize', syncJitsiSurfaceBounds);
      window.removeEventListener('orientationchange', syncJitsiSurfaceBounds);
      window.removeEventListener('navigation-swipe', syncJitsiSurfaceBounds);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleVisualViewportChange);
        window.visualViewport.removeEventListener('scroll', handleVisualViewportChange);
      }
    };
  }, [hostAnchorEl, isEmbedded, isFullscreen, position, showPipChrome, syncJitsiSurfaceBounds]);

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
      setRemoteStreamActive(state.remoteVideoActive || state.remoteScreenShareActive);
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

  useEffect(() => {
    console.log(`[PIP DEBUG] pip mount. displayMode=${displayMode}, targetConversation=${activeCall?.conversationId || 'none'}`);
    takeDomSnapshot('after PiP mount');
    return () => {
      console.log(`[PIP DEBUG] pip unmount`);
    };
  }, []);

  const moveCountRef = useRef(0);

  const clickTimerRef = useRef<number | null>(null);
  const lastRestoreAttemptAtRef = useRef<number>(0);

  const handlePipSingleOrDoubleTap = useCallback((event: React.MouseEvent | React.PointerEvent, isDoubleClick = false) => {
    if ((event.target as HTMLElement).closest('button, [data-call-controls], [data-pip-avatar]')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }

    if (isDoubleClick) {
      const nowTs = Date.now();
      if (nowTs - lastRestoreAttemptAtRef.current < 500) {
        console.log(`[PIP DEBUG] Duplicate restore request ignored ts=${performance.now()}`);
        return;
      }
      lastRestoreAttemptAtRef.current = nowTs;

      const isPreviewOpen = isProfilePreviewOpen || (typeof document !== 'undefined' && !!document.querySelector('[data-profile-preview-root="true"]'));
      if (isPreviewOpen) {
        console.log(`[PIP DEBUG] PiP double tap IGNORED because profile preview is open! data-profile-preview-root or isProfilePreviewOpen active.`);
        return;
      }

      console.log(`[PIP DEBUG] PiP double tap intercepted -> restore embedded for active conversation if valid.`);
      onRestoreEmbeddedRef.current();
      takeDomSnapshot('after double tap on PiP');
    } else {
      console.log(`[PIP DEBUG] PiP single tap/click registered (ignored to prevent accidental trigger).`);
    }
  }, [isProfilePreviewOpen]);

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
    event.stopPropagation();
    console.log(`[PIP DEBUG] pip pointerdown ts=${performance.now()}`, { x: event.clientX, y: event.clientY });
    
    // PIP GESTURE TARGET DEBUG
    const nativeEv = event.nativeEvent;
    const path = nativeEv.composedPath ? nativeEv.composedPath() : [];
    const pathTags = path.map((el: any) => el.tagName || el.nodeName || 'unknown');
    const hasPreviewInPath = path.some((el: any) => el.hasAttribute && (el.hasAttribute('data-messages-preview-panel') || el.hasAttribute('data-profile-preview-root')));
    const elemAtPoint = typeof document !== 'undefined' ? document.elementFromPoint(event.clientX, event.clientY) : null;
    const elemAtPointTag = elemAtPoint ? `${elemAtPoint.tagName}#${elemAtPoint.id}.${elemAtPoint.className}` : 'none';

    console.log(`[PIP EVENT PATH DEBUG] pointerdown event details:`, {
      clientX: event.clientX,
      clientY: event.clientY,
      composedPath: pathTags,
      hasPreviewInPath,
      elementFromPoint: elemAtPointTag,
    });

    if (isFullscreen) return;
    if ((event.target as HTMLElement).closest('button, [data-call-controls], [data-pip-avatar]')) {
      return;
    }

    const handle = event.currentTarget as HTMLElement;
    if (event.pointerId != null) {
      try {
        handle.setPointerCapture(event.pointerId);
        console.log(`[PIP DEBUG] setPointerCapture successful on pointerdown ts=${performance.now()}`);
      } catch {
        console.log(`[PIP DEBUG] setPointerCapture failed on pointerdown ts=${performance.now()}`);
      }
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
    event.stopPropagation();
    if (!dragRef.current || isFullscreen) return;
    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;
    if (!dragRef.current.moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
      console.log(`[PIP DEBUG] pip drag threshold crossed ts=${performance.now()}`);
      dragRef.current.moved = true;
    }
    if (!dragRef.current.moved) return;
    
    // Prevent default scroll/pan behaviors only during active dragging
    event.preventDefault();
    
    moveCountRef.current++;
    if (moveCountRef.current % 10 === 0) {
      console.log(`[PIP DEBUG] pip pointermove throttled ts=${performance.now()} dx=${dx} dy=${dy} finalPos=`, clampPosition(dragRef.current.originX + dx, dragRef.current.originY + dy));
    }
    setPosition(clampPosition(dragRef.current.originX + dx, dragRef.current.originY + dy));
  };

  const handleDragPointerUp = (event: React.PointerEvent) => {
    event.stopPropagation();
    if (!dragRef.current) return;
    const wasDrag = dragRef.current.moved;
    console.log(`[PIP DEBUG] pip pointerup ts=${performance.now()}`, { wasDrag, finalPos: position });
    dragRef.current = null;
    if (wasDrag) {
      event.preventDefault();
      return;
    }
    console.log(`[PIP DEBUG] pip treated as click (tap)`);
    const now = Date.now();
    if (now - lastPipOpenTapAtRef.current < 250) {
      lastPipOpenTapAtRef.current = 0;
      if (typeof window !== 'undefined' && (window as any).__createGestureFlowId) {
        (window as any).__createGestureFlowId('pip-double-tap-pointerup');
      }
      handlePipSingleOrDoubleTap(event, true);
    } else {
      lastPipOpenTapAtRef.current = now;
      handlePipSingleOrDoubleTap(event, false);
    }
  };

  const handlePipDoubleClick = (event: React.MouseEvent) => {
    const isTargetPiPRoot = !((event.target as HTMLElement).closest('button, [data-call-controls], [data-pip-avatar]'));
    console.log(`[PIP DEBUG] pip dblclick event ts=${performance.now()} onPiPRoot=${isTargetPiPRoot}`);
    if (!isTargetPiPRoot) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (typeof window !== 'undefined' && (window as any).__createGestureFlowId) {
      (window as any).__createGestureFlowId('pip-double-tap-dblclick');
    }
    handlePipSingleOrDoubleTap(event, true);
  };

  const live = connectionState === 'connected';

  // Avatar overlay for PiP mode only (fullscreen uses fullscreenOverlay below).
  const avatarOverlay =
    !isFullscreen && !showVideoSurface ? (
      <div className="pointer-events-none absolute inset-0 z-[25] flex items-center justify-center gap-1.5 bg-[#0b0b0b] p-2">
        {displayParticipants.length > 0 ? (
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
                    sizeClass={solo ? 'h-16 w-16' : 'h-9 w-9'}
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
        ) : null}
      </div>
    ) : null;

  // Embedded overlay — rendered INSIDE jitsiSurface so it sits above the hidden Jitsi iframe
  // (z-index 120) without needing to pierce the stacking context from ChatCallPanel.
  const embeddedOverlay = isEmbedded && showAvatarStage ? (
    <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center bg-[#0b0b0b]">
      {displayParticipants.length > 0 && (
        <div className="flex items-center justify-center gap-3">
          {displayParticipants.slice(0, 4).map((participant) => {
            const isSpeaking =
              speakingParticipantId === participant.id ||
              speakingParticipantId === participant.jitsiParticipantId;
            const solo = displayParticipants.length === 1;
            return (
              <div key={participant.id} data-pip-avatar>
                <PipAvatar
                  participant={participant}
                  isSpeaking={Boolean(isSpeaking)}
                  sizeClass={solo ? 'h-20 w-20 sm:h-24 sm:w-24' : 'h-14 w-14 sm:h-16 sm:w-16'}
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
      )}
    </div>
  ) : null;

  // Fullscreen overlay — rendered INSIDE jitsiSurface via the overlay prop so everything
  // lives in a single stacking context (no cross-context z-index confusion).
  const fullscreenOverlay = isFullscreen ? (
    <>
      {!showVideoSurface && (
        <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center bg-[#0b0b0b]">
          {displayParticipants.length > 0 && (
            <div className="flex items-center justify-center gap-1.5">
              {displayParticipants.slice(0, 2).map((participant) => {
                const isSpeaking =
                  speakingParticipantId === participant.id ||
                  speakingParticipantId === participant.jitsiParticipantId;
                return (
                  <div key={participant.id} data-pip-avatar>
                    <PipAvatar
                      participant={participant}
                      isSpeaking={Boolean(isSpeaking)}
                      sizeClass="h-20 w-20 sm:h-24 sm:w-24"
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
          )}
        </div>
      )}
      <div
        data-call-controls
        className="pointer-events-none absolute inset-x-0 bottom-6 z-[2] flex justify-center px-4"
      >
        <CallControlBar
          live={live}
          isMuted={isMuted}
          isCameraEnabled={isCameraEnabled}
          isScreenShareEnabled={isScreenShareEnabled}
          mediaActive={hasStream}
          onToggleMute={onToggleMute}
          onToggleCamera={onToggleCamera}
          onToggleScreenShare={onToggleScreenShare}
          onHangUp={onHangUp}
        />
      </div>
      <button
        type="button"
        onClick={onMinimizeFullscreen}
        className="absolute right-4 top-4 z-[2] flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-[#1e1f22]/95 text-white shadow-lg transition-colors hover:bg-[#2f3136]"
        aria-label={t('call.minimizeVideo')}
      >
        <Minimize2 className="h-4 w-4" />
      </button>
    </>
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
    overlay: fullscreenOverlay ?? embeddedOverlay,
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
    compactControls: !isEmbedded && !isFullscreen,
    // Only embedded layout still uses JitsiCallView's own controls bar.
    forceShowControls: isEmbedded ? true : false,
  };

  // Fullscreen: let React control the surface style so it never flickers back to hidden.
  const jitsiSurfaceStyle: React.CSSProperties = isFullscreen
    ? {
        visibility: 'visible',
        left: 0,
        top: 0,
        width: '100dvw',
        height: '100dvh',
        zIndex: 9999,
        pointerEvents: 'auto',
      }
    : {
        zIndex: isEmbedded ? 120 : 134,
        pointerEvents: showPipChrome ? 'none' : 'auto',
      };

  const volumeMenuPortal = volumeMenu && typeof document !== 'undefined' ? createPortal(
    <CallParticipantVolumeMenu
      participantName={volumeMenu.participantName}
      volume={participantVolumes[volumeMenu.participantId] ?? 1}
      x={volumeMenu.x}
      y={volumeMenu.y}
      onVolumeChange={(volume) =>
        onParticipantVolumeChange(volumeMenu.participantId, volume)
      }
      onClose={() => setVolumeMenu(null)}
    />,
    document.body
  ) : null;

  const pipContainerPortal = showPipChrome && !isFullscreen && typeof document !== 'undefined' ? createPortal(
    <div
      ref={pipContainerRef}
      className="group/pip fixed z-[99999] select-none"
      style={{ left: position.x, top: position.y, width: PIP_SIZE, height: PIP_SIZE }}
      onMouseEnter={() => setPipHovered(true)}
      onMouseLeave={() => setPipHovered(false)}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
      onMouseUp={(event) => {
        event.stopPropagation();
      }}
      onTouchStart={(event) => {
        event.stopPropagation();
      }}
      onTouchEnd={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        if ((event.target as HTMLElement).closest('button, [data-call-controls], [data-pip-avatar]')) return;
        setPipControlsVisible((v) => !v);
      }}
      onDoubleClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
      }}
    >
      <div
        ref={pipContentRef}
        className="relative h-full w-full overflow-hidden rounded-xl border border-white/15 bg-transparent shadow-2xl"
      />
      {avatarOverlay}
      <div
        data-call-controls
        className={`pointer-events-none absolute inset-x-0 bottom-1 z-[50] flex justify-center px-1 transition-opacity ${
          pipControlsVisible || pipHovered || isMobile ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <CallControlBar
          live={live}
          isMuted={isMuted}
          isCameraEnabled={isCameraEnabled}
          isScreenShareEnabled={isScreenShareEnabled}
          mediaActive={hasStream}
          onToggleMute={onToggleMute}
          onToggleCamera={onToggleCamera}
          onToggleScreenShare={onToggleScreenShare}
          onHangUp={onHangUp}
          compact
        />
      </div>
      <div
        data-pip-drag-handle
        className="absolute inset-0 z-[35] cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={handleDragPointerUp}
        onPointerCancel={handleDragPointerUp}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        onMouseUp={(event) => {
          event.stopPropagation();
        }}
        onTouchStart={(event) => {
          event.stopPropagation();
        }}
        onTouchEnd={(event) => {
          event.stopPropagation();
        }}
        onDoubleClick={handlePipDoubleClick}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          console.log(`[PIP DEBUG] pip drag handle click intercepted and stopped propagation`);
        }}
      />
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
    </div>,
    document.body
  ) : null;

  return (
    <>
      <div
        id="floating-call-widget-root"
        ref={jitsiSurfaceRef}
        className={`fixed overflow-hidden ${
          isFullscreen ? 'bg-[#0b0b0b]' : 'bg-transparent'
        } ${showPipChrome && !isFullscreen ? 'rounded-xl' : ''}`}
        style={jitsiSurfaceStyle}
      >
        <PersistentJitsiMeeting {...jitsiMeetingProps} />
      </div>
      {pipContainerPortal}
      {volumeMenuPortal}
    </>
  );
}
