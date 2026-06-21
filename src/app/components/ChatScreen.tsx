import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';

let chatScreenRenderCount = 0; // Global for simplicity in dev

export interface CachedScrollState {
  scrollTop: number;
  scrollHeight: number;
  wasNearBottom: boolean;
  timestamp: number;
}

export const chatScrollCache = new Map<string, CachedScrollState>();
import { createPortal } from 'react-dom';
import { ArrowLeft, Loader2, MoreVertical, Ban, Phone, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useChat } from '../hooks/useChat';
import { getOptimizedImageUrl } from '../lib/images';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { toast } from '../lib/toast';
import { REPORT_REASONS } from '../constants/report';
import { useTyping } from '../hooks/useTyping';
import { useScreenLifecycle } from '../contexts/ScreenLifecycleContext';
import { usePerformanceInstrument } from '../hooks/usePerformanceInstrument';
// useOnlineStatus is intentionally NOT called here — see comment at the usage site below.
import { useAppData } from '../context/AppDataContext';
import { TypingBubble } from './TypingBubble';
import { useIsMdUp, useIsMobile } from './ui/use-mobile';
import { useChatScrollAnchor } from '../hooks/useChatScrollAnchor';
import { useCall } from '../context/CallStateContext';
import { ChatEmbeddedCallBar } from './ChatEmbeddedCallBar';
import { NotificationManager } from '../lib/notifications';
import { getCachedUser, resolveAuthUser } from '../lib/authSession';
import { SharedProfileView } from './SharedProfileView';
import { User } from '../types';
import { getAppDateLocale } from '../../lib/i18n';
import {
  ConversationActionsMenu,
  openConversationActionsMenuFromEvent,
  type ConversationActionTarget,
} from './ConversationActionsMenu';
import { useLongPress } from '../hooks/useLongPress';
import { MessageReplyComposerBar } from './chat/MessageReplyComposerBar';
import { ChatMessageComposer } from './chat/ChatMessageComposer';
import { useChatMediaSend } from '../hooks/useChatMediaSend';
import { normalizeGifUrlForMessage } from '../lib/embedMediaResolver';
import { MessageWithReactions } from './chat/MessageWithReactions';
import {
  buildReplyTarget,
  resolveReplyQuote,
  type ReplyTarget,
} from '../lib/messageReply';
import {
  CHAT_MESSAGE_LIST_CLASS,
  CHAT_TYPING_CLEARANCE_EXTRA_PX,
  CHAT_MESSAGE_ROW_INNER_CLASS,
  CHAT_MESSAGE_ROW_INNER_GROUPED_CLASS,
  getChatMessageRowClass,
} from './chat/chatMessageStyles';
import { MessageRowAvatarSlot } from './chat/MessageRowAvatarSlot';
import { MessageGroupHeader } from './chat/MessageGroupHeader';
import {
  formatMessageTime,
  getMessageGroupPosition,
  isMessageBundled,
  isMessageGroupEnd,
  isMessageGroupStart,
  isNewSenderGroupStart,
} from '../lib/messageGrouping';
import { isOutgoingMessageRead } from '../lib/messageReadReceipts';
import {
  findFirstUnreadMessageId,
  isNearBottom,
  scrollContainerToBottomStable,
  scrollContainerToMessage,
} from '../lib/chatScroll';
import { ScrollToBottomButton, useScrollToBottom } from './chat/ScrollToBottomButton';
import { useStickyDateOverlay } from '../hooks/useStickyDateOverlay';

interface ChatScreenProps {
  onBack: () => void;
  conversationId: string;
  isActiveTopScreen?: boolean; // New prop
  isTransitioning?: boolean; // When true, screen is animating swipe. Header must stay inline.
  isDesktop?: boolean;
  otherUser: {
    id: string;
    name: string;
    display_name?: string;
    username?: string;
    imageUrl?: string;
    is_online?: boolean;
  };
  currentUserId: string;
  /** Live presence checker from the parent's single useOnlineStatus instance. */
  isOnline?: (userId: string) => boolean;
  onOpenProfilePreview?: (userId: string) => void;
  onConversationUpdated?: () => void;
  openReason?: 'preview-tap' | 'forward-reopen' | 'programmatic';
}

export function ChatScreen({
  onBack, 
  conversationId,
  isActiveTopScreen = true, // New prop
  isTransitioning = false, // New prop
  isDesktop = false,
  otherUser,
  currentUserId,
  isOnline: isOnlineProp,
  onOpenProfilePreview,
  onConversationUpdated,
  openReason = 'preview-tap',
}: ChatScreenProps) {
  usePerformanceInstrument('ChatScreen');
  const { t, i18n } = useTranslation();

  // --- CENTRALIZED STATE OWNERSHIP MACHINE ---
  const { phase, isFrozen, shouldRunExpensiveEffects } = useScreenLifecycle();
  
  const isTopMost = isActiveTopScreen;
  const isActive = isActiveTopScreen && !isFrozen;
  const isLeaving = phase === 'leaving';
  const isCached = phase === 'parked';
  const isGestureActive = phase === 'leaving'; // In this architecture, 'leaving' signifies an active pop/swipe gesture.

  const shouldAttachGlobalListeners = isActive && shouldRunExpensiveEffects && !isLeaving && !isCached;
  const shouldRunExpensiveEffectsResolved = shouldRunExpensiveEffects && !isLeaving && !isCached;
  const shouldAutoScroll = isActive && shouldRunExpensiveEffectsResolved && !isGestureActive;
  const shouldRunScrollSnapReactions = isActive && shouldRunExpensiveEffectsResolved && !isGestureActive;

  const IS_KEYBOARD_DEBUG_DEV = typeof window !== 'undefined' && (
    process.env.NODE_ENV !== 'production' ||
    (import.meta as any).env?.DEV
  );
  const shouldRunKeyboardDebug = shouldAttachGlobalListeners && IS_KEYBOARD_DEBUG_DEV;
  
  // Expose refs for debug
  const instanceIdRef = useRef(Math.random().toString(36).substring(2, 9));
  const debugRenderCountRef = useRef(0);
  const debugEventSeqRef = useRef(0);
  const debugPrevMetricsRef = useRef<{
    composerHeight?: number;
    viewportHeight?: number;
    visualViewportHeight?: number;
    messagesContainerClientHeight?: number;
    messagesContainerScrollTop?: number;
    isKeyboardLikelyOpen?: boolean;
  }>({});

  const callStateContext = useCall();
  const debugChatCallBridge = useCallback((event: string, payload?: any) => {
    const ts = performance.now();
    const info = {
      ts,
      event,
      isActiveTopScreen,
      isTransitioning,
      openReason,
      callActive: callStateContext.state === 'in_call',
      pipActive: callStateContext.callDisplayMode === 'pip',
      shouldBeHost: conversationId === callStateContext.activeCall?.conversationId,
      isHost: callStateContext.embeddedCallConversationId === conversationId,
      conversationId,
      instanceId: instanceIdRef.current,
      ...(payload || {})
    };
    console.log(`[CHAT CALL BRIDGE]`, info);
  }, [isActiveTopScreen, isTransitioning, openReason, callStateContext, conversationId]);

  useEffect(() => {
    const flowInfo = typeof window !== 'undefined' && (window as any).__getCallStateDebugInfo ? (window as any).__getCallStateDebugInfo() : '';
    console.log(`[PREVIEW ORIGIN DEBUG] ${flowInfo} ChatScreen mounted. conversationId=${conversationId}, openReason=${openReason}, openedFromPreview=${openReason === 'preview-tap'}`);
    debugChatCallBridge('ChatScreen mounted');
    return () => {
      const cleanupFlowInfo = typeof window !== 'undefined' && (window as any).__getCallStateDebugInfo ? (window as any).__getCallStateDebugInfo() : '';
      console.log(`[PREVIEW ORIGIN DEBUG] ${cleanupFlowInfo} ChatScreen unmounted. conversationId=${conversationId}`);
      debugChatCallBridge('ChatScreen unmounted');
    };
  }, []);

  const lastShouldRenderRef = useRef<boolean | null>(null);
  useEffect(() => {
    const shouldRender = callStateContext.state === 'in_call' && (callStateContext.embeddedCallConversationId === conversationId || callStateContext.callDisplayMode === 'pip');
    if (shouldRender !== lastShouldRenderRef.current) {
      lastShouldRenderRef.current = shouldRender;
      debugChatCallBridge('mount/unmount of the Call-Host-Zone decision changed', {
        shouldRender,
        callState: callStateContext.state,
        embeddedCallConversationId: callStateContext.embeddedCallConversationId,
        callDisplayMode: callStateContext.callDisplayMode
      });
    }
  }, [callStateContext.state, callStateContext.embeddedCallConversationId, callStateContext.callDisplayMode, conversationId, debugChatCallBridge]);

  useEffect(() => {
    const callContainerExists = !!document.querySelector(`[data-chat-call-host-zone="${conversationId}"]`);
    const isSwiping = typeof window !== 'undefined' && !!(window as any).__blyveNavSwipeActive;
    if (callContainerExists && !isActiveTopScreen && callStateContext.callDisplayMode !== 'pip' && !isSwiping) {
      console.warn(`[CHAT CALL BRIDGE][ILLEGAL HOST] Call is being rendered/hosted in ChatScreen ${conversationId} (instance ${instanceIdRef.current}) even though isActiveTopScreen is false and callDisplayMode is not pip! ts=${performance.now()}`);
    }
  }, [isActiveTopScreen, callStateContext.callDisplayMode, conversationId]);

// Online status comes from the parent via otherUser.is_online, which is
  // kept live by MessagesScreen's single useOnlineStatus instance.
  // Do NOT create a second useOnlineStatus here — a second subscriber on the
  // same channel starts with an empty presence snapshot and shows the peer
  // as offline until it re-syncs, causing a flicker/mismatch with the preview.
  useEffect(() => {
    if (!shouldRunKeyboardDebug) return;
    console.log(`[ChatScreen DEBUG] mount/update [Instanz: ${instanceIdRef.current}]`, {
      conversationId,
      isActiveTopScreen,
      isMounted: true
    });
    return () => console.log(`[ChatScreen DEBUG] unmount [Instanz: ${instanceIdRef.current}]`, { conversationId });
  }, [conversationId, isActiveTopScreen, shouldRunKeyboardDebug]);

  // Set manual scroll restoration to control exactly when the browser restores scroll positions
  useEffect(() => {
    if (!shouldAttachGlobalListeners) return;
    if (typeof window !== 'undefined' && window.history) {
      const originalScrollRestoration = window.history.scrollRestoration;
      window.history.scrollRestoration = 'manual';
      return () => {
        window.history.scrollRestoration = originalScrollRestoration;
      };
    }
  }, [shouldAttachGlobalListeners]);

  const [conversationActionsMenu, setConversationActionsMenu] = useState<ConversationActionTarget | null>(null);
  const {
    messages,
    lastViewedAt,
    loading,
    loadingMore,
    hasMore,
    sending,
    error,
    sendMessage,
    deleteMessage,
    markAsRead,
    loadOlderMessages,
  } = useChat(conversationId);
  const { currentUserProfile } = useAppData();
  const {
    startDirectCall,
    state: callState,
    activeCall,
    connectionState: callConnectionState,
    setIsProfilePreviewOpen,
  } = useCall();
  const isMdUp = useIsMdUp();
  const isMobile = useIsMobile();
  const [messageInput, setMessageInput] = useState('');
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [editTarget, setEditTarget] = useState<{ id: string; originalContent: string } | null>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const typingIndicatorRef = useRef<HTMLDivElement>(null);
  const [typingClearance, setTypingClearance] = useState(0);
  const isLoadingOlderRef = useRef(false);
  const optionsMenuRef = useRef<HTMLDivElement>(null);
  const optionsButtonRef = useRef<HTMLButtonElement>(null);
  const { show: showScrollToBottom, handleScroll: scrollToBottomHandleScroll, scrollToBottom } = useScrollToBottom(messagesContainerRef);
  const { label: stickyDateLabel, visible: stickyDateVisible } = useStickyDateOverlay(messagesContainerRef, messages);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [selectedReportReason, setSelectedReportReason] = useState<string | null>(null);
  const [reportTargetUserId, setReportTargetUserId] = useState<string | null>(null);
  const [newlyLoadedIds, setNewlyLoadedIds] = useState<Set<string>>(new Set());
  const [dropActive, setDropActive] = useState(false);
  const [profilePreviewUserId, setProfilePreviewUserId] = useState<string | null>(null);
  const [profilePreviewData, setProfilePreviewData] = useState<User | null>(null);

  const isAnyOverlayActive = Boolean(
    profilePreviewUserId ||
    showReportModal ||
    showBlockModal
  );

  useEffect(() => {
    setIsProfilePreviewOpen(isAnyOverlayActive);
    return () => {
      setIsProfilePreviewOpen(false);
    };
  }, [isAnyOverlayActive, setIsProfilePreviewOpen]);
  const initialScrollDoneRef = useRef(false);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const previewBottomResizeObserverRef = useRef<ResizeObserver | null>(null);
  const didApplyInitialOpenScrollRef = useRef(false);
  const isRestoringFromCacheRef = useRef(false);
  const userHasInteractedRef = useRef(false);
  const pendingPreviewBottomStabilizeRef = useRef<number | null>(null);
  const initialOpenReasonRef = useRef<'preview-tap' | 'forward-reopen' | 'programmatic' | null>(null);
  if (initialOpenReasonRef.current === null) {
    initialOpenReasonRef.current = openReason;
  }
  const canLoadOlderRef = useRef(false);
  const lastMessageIdRef = useRef<string | null>(null);
  const lastAppliedViewedAtRef = useRef<string | null>(null);
  const lastOwnReadAtRef = useRef<string | null>(null);
  const lastMessageReactionKeyRef = useRef<string | null>(null);
  const readReceiptScrollSeededRef = useRef(false);
  const wasNearBottomOnInputFocusRef = useRef(false); // NEW: Track near bottom status on input focus
  const [scrollAnchorReady, setScrollAnchorReady] = useState(false);
  const headerPortalRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(56);
  // Portal is only active while this ChatScreen is the top of the nav stack.
  // mobile-chat-stack-close fires when stack depth drops to 0 (forward-pull cached
  // screens stay mounted with display:none — portal must not escape to body then).
  const [isPortalActive, setIsPortalActive] = useState(true);

  const renderRef = useRef(0);

  // --- KEYBOARD DEBUG INSTRUMENTATION ---
  debugRenderCountRef.current += 1;
  const currentComposerEl = typeof document !== 'undefined' ? document.querySelector('[data-chat-composer]') : null;
  const currentComposerHeight = currentComposerEl ? (currentComposerEl as HTMLElement).offsetHeight : 0;
  const currentViewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
  const currentVisualViewportHeight = typeof window !== 'undefined' && window.visualViewport ? window.visualViewport.height : 0;
  const currentMessagesContainer = messagesContainerRef.current;
  const currentClientHeight = currentMessagesContainer ? currentMessagesContainer.clientHeight : 0;
  const currentScrollTop = currentMessagesContainer ? currentMessagesContainer.scrollTop : 0;

  const debugKeyboardHeightEstimate = Math.max(0, currentViewportHeight - currentVisualViewportHeight);
  const debugIsKeyboardLikelyOpen = debugKeyboardHeightEstimate > 80;

  useEffect(() => {
    if (!shouldRunKeyboardDebug || !IS_KEYBOARD_DEBUG_DEV) return;

    const prev = debugPrevMetricsRef.current;
    const diffs: Record<string, { from: any; to: any }> = {};

    if (prev.composerHeight !== undefined && prev.composerHeight !== currentComposerHeight) {
      diffs.composerHeight = { from: prev.composerHeight, to: currentComposerHeight };
    }
    if (prev.viewportHeight !== undefined && prev.viewportHeight !== currentViewportHeight) {
      diffs.viewportHeight = { from: prev.viewportHeight, to: currentViewportHeight };
    }
    if (prev.visualViewportHeight !== undefined && prev.visualViewportHeight !== currentVisualViewportHeight) {
      diffs.visualViewportHeight = { from: prev.visualViewportHeight, to: currentVisualViewportHeight };
    }
    if (prev.messagesContainerClientHeight !== undefined && prev.messagesContainerClientHeight !== currentClientHeight) {
      diffs.messagesContainerClientHeight = { from: prev.messagesContainerClientHeight, to: currentClientHeight };
    }
    if (prev.messagesContainerScrollTop !== undefined && prev.messagesContainerScrollTop !== currentScrollTop) {
      diffs.messagesContainerScrollTop = { from: prev.messagesContainerScrollTop, to: currentScrollTop };
    }
    if (prev.isKeyboardLikelyOpen !== undefined && prev.isKeyboardLikelyOpen !== debugIsKeyboardLikelyOpen) {
      diffs.isKeyboardLikelyOpen = { from: prev.isKeyboardLikelyOpen, to: debugIsKeyboardLikelyOpen };
    }

    console.log(`%c[ChatScreen KEYBOARD DEBUG] [Instanz: ${instanceIdRef.current}] render #${debugRenderCountRef.current} at ${performance.now().toFixed(2)}ms`, 'color: #3faf95; font-weight: bold;', {
      conversationId,
      openReason,
      instanceId: instanceIdRef.current,
      renderCount: debugRenderCountRef.current,
      diffs: Object.keys(diffs).length > 0 ? diffs : 'no relevant layout changes',
      metrics: {
        composerHeight: currentComposerHeight,
        viewportHeight: currentViewportHeight,
        visualViewportHeight: currentVisualViewportHeight,
        messagesContainerClientHeight: currentClientHeight,
        messagesContainerScrollTop: currentScrollTop,
        keyboardHeightEstimate: debugKeyboardHeightEstimate,
        isKeyboardLikelyOpen: debugIsKeyboardLikelyOpen
      }
    });

    debugPrevMetricsRef.current = {
      composerHeight: currentComposerHeight,
      viewportHeight: currentViewportHeight,
      visualViewportHeight: currentVisualViewportHeight,
      messagesContainerClientHeight: currentClientHeight,
      messagesContainerScrollTop: currentScrollTop,
      isKeyboardLikelyOpen: debugIsKeyboardLikelyOpen
    };
  });

  useLayoutEffect(() => {
    if (!shouldRunKeyboardDebug) return;
    const seq = (debugEventSeqRef.current += 1);
    console.log(`[ChatScreen KEYBOARD DEBUG #${seq}] useLayoutEffect START at ${performance.now().toFixed(2)}ms`, { conversationId, openReason, instanceId: instanceIdRef.current });
    return () => {
      const seqCleanup = (debugEventSeqRef.current += 1);
      console.log(`[ChatScreen KEYBOARD DEBUG #${seqCleanup}] useLayoutEffect CLEANUP at ${performance.now().toFixed(2)}ms`, { conversationId, openReason, instanceId: instanceIdRef.current });
    };
  }, [conversationId, openReason, shouldRunKeyboardDebug]);

  useEffect(() => {
    if (!shouldRunKeyboardDebug) return;
    const seq = (debugEventSeqRef.current += 1);
    console.log(`[ChatScreen KEYBOARD DEBUG #${seq}] useEffect START at ${performance.now().toFixed(2)}ms`, { conversationId, openReason, instanceId: instanceIdRef.current });
    return () => {
      const seqCleanup = (debugEventSeqRef.current += 1);
      console.log(`[ChatScreen KEYBOARD DEBUG #${seqCleanup}] useEffect CLEANUP at ${performance.now().toFixed(2)}ms`, { conversationId, openReason, instanceId: instanceIdRef.current });
    };
  }, [conversationId, openReason, shouldRunKeyboardDebug]);

  const logKeyboardSnapshot = useCallback((eventName: string) => {
    if (!shouldRunKeyboardDebug) return;

    const seq = (debugEventSeqRef.current += 1);
    const ts = performance.now().toFixed(2);
    
    const winWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
    const winHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
    const winScrollY = typeof window !== 'undefined' ? window.scrollY : 0;
    const docClientWidth = typeof document !== 'undefined' ? document.documentElement.clientWidth : 0;
    const docClientHeight = typeof document !== 'undefined' ? document.documentElement.clientHeight : 0;
    const docBodyHeight = typeof document !== 'undefined' && document.body ? document.body.clientHeight : 0;

    const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
    const activeElementMetrics = activeEl ? {
      tagName: activeEl.tagName,
      id: activeEl.id,
      className: activeEl.className,
      selectionStart: (activeEl as any).selectionStart,
      selectionEnd: (activeEl as any).selectionEnd
    } : null;

    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const vvMetrics = vv ? {
      width: vv.width,
      height: vv.height,
      offsetTop: vv.offsetTop,
      offsetLeft: vv.offsetLeft,
      pageTop: vv.pageTop,
      pageLeft: vv.pageLeft,
      scale: vv.scale
    } : 'Unsupported';

    const container = messagesContainerRef.current;
    const containerMetrics = container ? {
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      offsetHeight: container.offsetHeight,
      top: container.getBoundingClientRect().top,
      bottom: container.getBoundingClientRect().bottom,
      height: container.getBoundingClientRect().height,
      distanceToBottom: container.scrollHeight - container.scrollTop - container.clientHeight
    } : null;

    const content = messagesContentRef.current;
    const contentMetrics = content ? {
      offsetHeight: content.offsetHeight,
      scrollHeight: content.scrollHeight,
      height: content.getBoundingClientRect().height
    } : null;

    const composer = typeof document !== 'undefined' ? document.querySelector('[data-chat-composer]') : null;
    const composerRect = composer ? composer.getBoundingClientRect() : null;
    const composerMetrics = composer && composerRect ? {
      offsetHeight: (composer as HTMLElement).offsetHeight,
      top: composerRect.top,
      bottom: composerRect.bottom,
      height: composerRect.height,
      bottomDistance: vv ? vv.height - composerRect.bottom : winHeight - composerRect.bottom
    } : null;

    const input = messageInputRef.current;
    const inputRect = input ? input.getBoundingClientRect() : null;
    const inputMetrics = input && inputRect ? {
      top: inputRect.top,
      bottom: inputRect.bottom,
      height: inputRect.height
    } : null;

    const kbEstimate = Math.max(0, winHeight - (vv?.height ?? winHeight));
    const kbLikelyOpen = kbEstimate > 80;

    console.groupCollapsed(`%c[ChatScreen KEYBOARD DEBUG #${seq}] [Instanz: ${instanceIdRef.current}] ${eventName} at ${ts}ms`, 'color: #3b82f6; font-weight: bold;');
    console.log('Event Name:', eventName);
    console.log('Timestamp:', ts);
    console.log('Sequence:', seq);
    console.log('Instance ID:', instanceIdRef.current);
    console.log('Active Element:', activeElementMetrics);
    console.log('Keyboard Estimate:', { keyboardHeightEstimate: kbEstimate, isKeyboardLikelyOpen: kbLikelyOpen });
    console.log('Window / Viewport:', { winWidth, winHeight, winScrollY, docClientWidth, docClientHeight, docBodyHeight });
    console.log('VisualViewport:', vvMetrics);
    console.log('Chat Container:', containerMetrics);
    console.log('Messages Content:', contentMetrics);
    console.log('Composer:', composerMetrics);
    console.log('Input:', inputMetrics);
    console.groupEnd();
  }, [shouldRunKeyboardDebug]);

  const traceKeyboardEvent = useCallback((eventName: string) => {
    if (!shouldRunKeyboardDebug) return () => {};

    logKeyboardSnapshot(`${eventName} (IMMEDIATE)`);

    const rAF = requestAnimationFrame(() => {
      logKeyboardSnapshot(`${eventName} (rAF)`);
    });

    const t1 = setTimeout(() => {
      logKeyboardSnapshot(`${eventName} (100ms)`);
    }, 100);

    const t2 = setTimeout(() => {
      logKeyboardSnapshot(`${eventName} (300ms)`);
    }, 300);

    return () => {
      cancelAnimationFrame(rAF);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [logKeyboardSnapshot, shouldRunKeyboardDebug]);

  useEffect(() => {
    if (!shouldRunKeyboardDebug) return;

    const handleWindowResize = () => {
      logKeyboardSnapshot('window.resize');
    };

    const handleOrientationChange = () => {
      logKeyboardSnapshot('orientationchange');
    };

    const handleSelectionChange = () => {
      logKeyboardSnapshot('document.selectionchange');
    };

    const timeouts: Array<() => void> = [];

    const handleFocusIn = (e: FocusEvent) => {
      console.log(`[ChatScreen KEYBOARD DEBUG] [Instanz: ${instanceIdRef.current}] focusin event target:`, e.target);
      const cleanupTrace = traceKeyboardEvent('focusin');
      timeouts.push(cleanupTrace);
    };

    const handleFocusOut = (e: FocusEvent) => {
      console.log(`[ChatScreen KEYBOARD DEBUG] [Instanz: ${instanceIdRef.current}] focusout event target:`, e.target);
      const cleanupTrace = traceKeyboardEvent('focusout');
      timeouts.push(cleanupTrace);
    };

    window.addEventListener('resize', handleWindowResize);
    window.addEventListener('orientationchange', handleOrientationChange);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    document.addEventListener('selectionchange', handleSelectionChange);

    const vv = window.visualViewport;
    const handleVVResize = () => {
      const cleanupTrace = traceKeyboardEvent('visualViewport.resize');
      timeouts.push(cleanupTrace);
    };
    const handleVVScroll = () => {
      logKeyboardSnapshot('visualViewport.scroll');
    };

    if (vv) {
      vv.addEventListener('resize', handleVVResize);
      vv.addEventListener('scroll', handleVVScroll);
    } else {
      console.log(`%c[ChatScreen KEYBOARD DEBUG] [Instanz: ${instanceIdRef.current}] visualViewport unsupported`, 'color: red; font-weight: bold;');
    }

    const input = messageInputRef.current;
    const handleInputFocus = () => logKeyboardSnapshot('input.focus');
    const handleInputBlur = () => logKeyboardSnapshot('input.blur');
    const handleInputClick = () => logKeyboardSnapshot('input.click');
    const handleInputPointerDown = () => logKeyboardSnapshot('input.pointerdown');
    const handleInput = () => logKeyboardSnapshot('input.input');

    if (input) {
      input.addEventListener('focus', handleInputFocus);
      input.addEventListener('blur', handleInputBlur);
      input.addEventListener('click', handleInputClick);
      input.addEventListener('pointerdown', handleInputPointerDown);
      input.addEventListener('input', handleInput);
    }

    return () => {
      window.removeEventListener('resize', handleWindowResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
      document.removeEventListener('selectionchange', handleSelectionChange);

      if (vv) {
        vv.removeEventListener('resize', handleVVResize);
        vv.removeEventListener('scroll', handleVVScroll);
      }

      if (input) {
        input.removeEventListener('focus', handleInputFocus);
        input.removeEventListener('blur', handleInputBlur);
        input.removeEventListener('click', handleInputClick);
        input.removeEventListener('pointerdown', handleInputPointerDown);
        input.removeEventListener('input', handleInput);
      }

      timeouts.forEach((cleanup) => cleanup());
    };
  }, [logKeyboardSnapshot, traceKeyboardEvent, shouldRunKeyboardDebug]);

  const stabilizePreviewTapBottomIfNeeded = useCallback((container: HTMLElement) => {
    if (userHasInteractedRef.current) return;
    if (initialOpenReasonRef.current !== 'preview-tap') return;
    if (!shouldRunScrollSnapReactions) return; // Centralized gating
    if (!messagesContainerRef.current) return;
    if (messagesContainerRef.current !== container) return;

    if (pendingPreviewBottomStabilizeRef.current !== null) {
      cancelAnimationFrame(pendingPreviewBottomStabilizeRef.current);
      pendingPreviewBottomStabilizeRef.current = null;
    }

    let lastHeight = container.scrollHeight;
    let stableFrames = 0;
    let cycleCount = 0;

    const tick = () => {
      if (userHasInteractedRef.current) {
        pendingPreviewBottomStabilizeRef.current = null;
        return;
      }

      if (initialOpenReasonRef.current !== 'preview-tap') {
        pendingPreviewBottomStabilizeRef.current = null;
        return;
      }

      if (!shouldRunScrollSnapReactions) { // Centralized gating
        pendingPreviewBottomStabilizeRef.current = null;
        return;
      }

      const liveContainer = messagesContainerRef.current;
      if (!liveContainer || liveContainer !== container) {
        pendingPreviewBottomStabilizeRef.current = null;
        return;
      }

      // Check if the actual scrollTop has drifted from the expected scroll position of the last known height
      // (This serves as a robust fallback if the user scrolled up before touch/wheel listeners fired)
      // Uses a 10px tolerance to prevent false-positives on high-DPI displays or fractional pixel rendering in iOS Safari
      const lastExpectedMax = Math.max(0, lastHeight - liveContainer.clientHeight);
      if (Math.abs(liveContainer.scrollTop - lastExpectedMax) > 10) {
        userHasInteractedRef.current = true;
        pendingPreviewBottomStabilizeRef.current = null;
        return;
      }

      const currentHeight = liveContainer.scrollHeight;
      cycleCount += 1;

      if (currentHeight !== lastHeight) {
        const maxScroll = Math.max(0, currentHeight - liveContainer.clientHeight);
        liveContainer.scrollTop = maxScroll;
        lastHeight = currentHeight;
        stableFrames = 0;
      } else {
        stableFrames += 1;
      }

      if (cycleCount < 3 && stableFrames < 2) {
        pendingPreviewBottomStabilizeRef.current = requestAnimationFrame(tick);
      } else {
        pendingPreviewBottomStabilizeRef.current = null;
      }
    };

    pendingPreviewBottomStabilizeRef.current = requestAnimationFrame(tick);
  }, [shouldRunScrollSnapReactions]);

  const stopPreviewBottomGrowthFollow = useCallback(() => {
    if (previewBottomResizeObserverRef.current) {
      previewBottomResizeObserverRef.current.disconnect();
      previewBottomResizeObserverRef.current = null;
    }
  }, []);

  const pinToBottomIfStillEligible = useCallback(() => {
    if (userHasInteractedRef.current) return;
    if (initialOpenReasonRef.current !== 'preview-tap') return;
    if (!shouldRunScrollSnapReactions) return; // Use centralized gating

    const container = messagesContainerRef.current;
    if (!container) return;

    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    if (Math.abs(container.scrollTop - maxScroll) <= 15) {
      container.scrollTop = maxScroll;
    }
  }, [shouldRunScrollSnapReactions]);

  const handleLastMediaReady = useCallback(() => {
    pinToBottomIfStillEligible();
  }, [pinToBottomIfStillEligible]);

  const startPreviewBottomGrowthFollow = useCallback(() => {
    if (userHasInteractedRef.current) return;
    if (initialOpenReasonRef.current !== 'preview-tap') return;
    if (!shouldRunScrollSnapReactions) return; // Centralized gating
    const contentEl = messagesContentRef.current;
    const container = messagesContainerRef.current;
    if (!contentEl || !container) return;

    stopPreviewBottomGrowthFollow();

    let lastHeight = contentEl.offsetHeight;

    const observer = new ResizeObserver(() => {
      if (userHasInteractedRef.current || initialOpenReasonRef.current !== 'preview-tap' || !shouldRunScrollSnapReactions) {
        stopPreviewBottomGrowthFollow();
        return;
      }

      const liveContainer = messagesContainerRef.current;
      const liveContent = messagesContentRef.current;
      if (!liveContainer || !liveContent) {
        stopPreviewBottomGrowthFollow();
        return;
      }

      // Check if user has scrolled away from the expected bottom position of the last height
      const lastExpectedMax = Math.max(0, liveContainer.scrollHeight - liveContainer.clientHeight);
      if (Math.abs(liveContainer.scrollTop - lastExpectedMax) > 10) {
        userHasInteractedRef.current = true;
        stopPreviewBottomGrowthFollow();
        return;
      }

      const currentHeight = liveContent.offsetHeight;
      if (currentHeight !== lastHeight) {
        const maxScroll = Math.max(0, liveContainer.scrollHeight - liveContainer.clientHeight);
        liveContainer.scrollTop = maxScroll;
        lastHeight = currentHeight;
      }
    });

    observer.observe(contentEl);
    previewBottomResizeObserverRef.current = observer;

    // Automatically stop growth-follow phase after a short window (2.5 seconds)
    // to stop observing and release browser resources.
    setTimeout(() => {
      stopPreviewBottomGrowthFollow();
    }, 2500);
  }, [stopPreviewBottomGrowthFollow, shouldRunScrollSnapReactions]);

  const applyInitialScrollPosition = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container || messages.length === 0) return;

    if (initialOpenReasonRef.current === 'preview-tap') {
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      container.scrollTop = maxScroll;
      didApplyInitialOpenScrollRef.current = true;
      stabilizePreviewTapBottomIfNeeded(container);
      startPreviewBottomGrowthFollow();
      return;
    }

    if (initialOpenReasonRef.current === 'forward-reopen') {
      const cached = chatScrollCache.get(conversationId);
      if (cached) {
        container.scrollTop = cached.scrollTop;
        isRestoringFromCacheRef.current = true;
        didApplyInitialOpenScrollRef.current = true;
        
        if (cached.wasNearBottom) {
          const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
          container.scrollTop = maxScroll;
        }
        return;
      }
    }

    const firstUnreadId = findFirstUnreadMessageId(messages, currentUserId, lastViewedAt);
    if (firstUnreadId && scrollContainerToMessage(container, firstUnreadId)) {
      didApplyInitialOpenScrollRef.current = true;
      return;
    }

    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = maxScroll;
    didApplyInitialOpenScrollRef.current = true;
  }, [messages, currentUserId, lastViewedAt, conversationId, stabilizePreviewTapBottomIfNeeded, startPreviewBottomGrowthFollow]);


  const isGhostMode = !!currentUserProfile?.ghost_mode;

  const otherDisplay =
    otherUser.display_name?.trim() || otherUser.name || '';
  const meDisplay =
    currentUserProfile?.display_name?.trim() ||
    currentUserProfile?.name ||
    t('chat.you');

  const getSenderLabel = useCallback(
    (senderId: string) =>
      senderId === currentUserId ? meDisplay : otherDisplay,
    [currentUserId, meDisplay, otherDisplay]
  );

  const meAvatarUrl =
    currentUserProfile?.avatar_url ||
    currentUserProfile?.images?.[0] ||
    null;

  useEffect(() => {
    setReplyTarget(null);
  }, [conversationId]);

  useEffect(() => {
    if (!shouldRunExpensiveEffectsResolved) return;
    const el = headerPortalRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const height = el.offsetHeight;
      if (height > 0) {
        setHeaderHeight(height);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [shouldRunExpensiveEffectsResolved]);

  useEffect(() => {
    if (!shouldAttachGlobalListeners) return;
    const onOpen = () => setIsPortalActive(true);
    const onClose = () => setIsPortalActive(false);
    window.addEventListener('mobile-chat-stack-open', onOpen);
    window.addEventListener('mobile-chat-stack-close', onClose);
    return () => {
      window.removeEventListener('mobile-chat-stack-open', onOpen);
      window.removeEventListener('mobile-chat-stack-close', onClose);
    };
  }, [shouldAttachGlobalListeners]);


  // Event listeners for Auto-scroll on viewport change and stack transitions
  useEffect(() => {
    if (!shouldAttachGlobalListeners) return;

    let autoScrollRaf: number | null = null;

    const tryAutoScrollToBottom = () => {
      const container = messagesContainerRef.current;
      if (wasNearBottomOnInputFocusRef.current && container && !isNearBottom(container, 96)) {
        if (autoScrollRaf !== null) cancelAnimationFrame(autoScrollRaf);
        autoScrollRaf = requestAnimationFrame(() => {
          scrollContainerToBottomStable(container);
          autoScrollRaf = null;
        });
      }
    };

    const handleVisualViewportResize = () => {
      if (!shouldAttachGlobalListeners) return;
      tryAutoScrollToBottom();
    };
    
    const handleVisualViewportScroll = () => {
      if (!shouldAttachGlobalListeners) return;
      tryAutoScrollToBottom();
    };

    visualViewport?.addEventListener('resize', handleVisualViewportResize);
    visualViewport?.addEventListener('scroll', handleVisualViewportScroll);

    const handleInputFocus = () => {
      if (!shouldAttachGlobalListeners) return;
      if (messagesContainerRef.current) {
        wasNearBottomOnInputFocusRef.current = isNearBottom(messagesContainerRef.current, 96);
      }
    };
    
    const handleInputBlur = () => {
      if (!shouldAttachGlobalListeners) return;
      wasNearBottomOnInputFocusRef.current = false;
    };

    const inputElement = messageInputRef.current;
    inputElement?.addEventListener('focus', handleInputFocus);
    inputElement?.addEventListener('blur', handleInputBlur);

    const onMobileChatStackOpen = () => { if(!shouldAttachGlobalListeners) return; };
    const onMobileChatStackClose = () => { if(!shouldAttachGlobalListeners) return; };

    window.addEventListener('mobile-chat-stack-open', onMobileChatStackOpen);
    window.addEventListener('mobile-chat-stack-close', onMobileChatStackClose);

    return () => {
      if (autoScrollRaf !== null) cancelAnimationFrame(autoScrollRaf);
      visualViewport?.removeEventListener('resize', handleVisualViewportResize);
      visualViewport?.removeEventListener('scroll', handleVisualViewportScroll);
      inputElement?.removeEventListener('focus', handleInputFocus);
      inputElement?.removeEventListener('blur', handleInputBlur);
      window.removeEventListener('mobile-chat-stack-open', onMobileChatStackOpen);
      window.removeEventListener('mobile-chat-stack-close', onMobileChatStackClose);
    };
  }, [shouldAttachGlobalListeners, headerHeight]);

  // Log route/screen changes (inferred from ChatScreen lifecycle)
  useEffect(() => {
    console.debug(`[ChatScreen Debug] ${Date.now()} | ChatScreen mounted. isActiveTopScreen: ${isActiveTopScreen}`);
    return () => {
      console.debug(`[ChatScreen Debug] ${Date.now()} | ChatScreen unmounted. isActiveTopScreen: ${isActiveTopScreen}`);
    };
  }, []);

  useEffect(() => {
    console.log('[ChatScreen DEBUG]', {
      conversationId,
      isActiveTopScreen,
      headerHeight
    });
  }, [conversationId, isActiveTopScreen, headerHeight]);

  const openProfileActions = useCallback(
    (event: React.MouseEvent | React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setConversationActionsMenu(
        openConversationActionsMenuFromEvent(event, conversationId, {
          id: otherUser.id,
          name: otherDisplay,
          username: otherUser.username,
          imageUrl: otherUser.imageUrl,
        })
      );
    },
    [conversationId, otherDisplay, otherUser.id, otherUser.imageUrl, otherUser.username]
  );
  const { bind: profileLongPress } = useLongPress(openProfileActions);

  const handleRemoveFriend = useCallback(async () => {
    const confirmed = window.confirm(t('chat.deleteFriendConfirm', { name: otherDisplay }));
    if (!confirmed) return;

    try {
      await api.removeFriend(otherUser.id);
      toast.success(t('chat.deleteFriendSuccess'));
      onConversationUpdated?.();
      onBack();
    } catch (error: any) {
      toast.error(t('chat.deleteFriendFailedTitle'), error.message || t('chat.deleteFriendFailedTitle'));
    }
  }, [onBack, onConversationUpdated, otherDisplay, otherUser.id, t]);

  const handleBlockFromMenu = useCallback(async () => {
    const confirmed = window.confirm(t('chat.blockUserConfirm'));
    if (!confirmed) return;

    try {
      await api.blockUser(otherUser.id);
      toast.success(t('chat.blockSuccess'));
      onConversationUpdated?.();
      onBack();
    } catch (error: any) {
      toast.error(t('chat.blockFailedTitle'), error.message || t('chat.blockFailedTitle'));
    }
  }, [onBack, onConversationUpdated, otherUser.id, t]);
  const lastOwnMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].sender_id === currentUserId) {
        return messages[i].id;
      }
    }
    return null;
  }, [messages, currentUserId]);

  const renderedMessages = useMemo(() => {
    return messages.map((msg, index) => {
      const isMe = msg.sender_id === currentUserId;
      const isLastMessage = index === messages.length - 1;
      const prev = index > 0 ? messages[index - 1] : null;
      const next = index < messages.length - 1 ? messages[index + 1] : null;
      const isGroupStart = isMessageGroupStart(msg, prev);
      const isNewSender = isNewSenderGroupStart(msg, prev);
      const isGroupEnd = isMessageGroupEnd(msg, next);
      const isBundled = isMessageBundled(msg, prev, next);
      const groupPosition = getMessageGroupPosition(msg, prev, next);
      const isLastOwnMessage = isMe && msg.id === lastOwnMessageId;
      const isNewlyLoaded = newlyLoadedIds.has(msg.id);
      const timeLocale = getAppDateLocale(i18n.language);
      const messageTime = formatMessageTime(
        msg.created_at,
        timeLocale,
        timeLocale === 'en-US'
      );
      const replyQuote = resolveReplyQuote(
        msg.reply_to_message_id,
        messages,
        (senderId) => getSenderLabel(senderId),
        t('chat.originalMessageUnavailable')
      );
      const readLabel =
        isLastOwnMessage && isGroupEnd && msg.read_at
          ? `${t('chat.read')} ${formatMessageTime(msg.read_at, timeLocale, timeLocale === 'en-US')}`
          : undefined;
      return (
        <motion.div
          key={msg.id}
          data-message-id={msg.id}
          initial={isNewlyLoaded ? { opacity: 0, y: -6 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={
            isNewlyLoaded
              ? { duration: 0.18, ease: [0.25, 0.1, 0.25, 1] }
              : { duration: 0 }
          }
          className={getChatMessageRowClass(isGroupStart, isNewSender)}
          style={{ overflowAnchor: 'none' }}
        >
          <div className={`flex w-full flex-col ${isMe ? 'items-end' : 'items-start'}`}>
              <div
                className={`${
                  isBundled ? CHAT_MESSAGE_ROW_INNER_GROUPED_CLASS : CHAT_MESSAGE_ROW_INNER_CLASS
                } ${isMe ? 'flex-row-reverse' : 'flex-row'}`}
              >
                <MessageRowAvatarSlot
                  visible={isGroupEnd}
                  imageUrl={isMe ? meAvatarUrl : otherUser.imageUrl}
                  label={isMe ? meDisplay : otherDisplay}
                />
                <div className={`flex min-w-0 max-w-[calc(100%-2.25rem)] flex-1 flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  {isGroupStart && (
                    <MessageGroupHeader
                      name={isMe ? meDisplay : otherDisplay}
                      align={isMe ? 'end' : 'start'}
                    />
                  )}
                  <div className="w-full min-w-0">
                    <MessageWithReactions
                      messageId={msg.id}
                      isMe={isMe}
                      canDelete={isMe}
                      isReplyTarget={replyTarget?.id === msg.id}
                      onReply={() =>
                        setReplyTarget(buildReplyTarget(msg, getSenderLabel(msg.sender_id)))
                      }
                      onDelete={() => {
                        const confirmed = window.confirm(t('chat.deleteMessageConfirm'));
                        if (!confirmed) return;
                        void deleteMessage(msg.id).then((ok) => {
                          if (!ok) toast.error(t('chat.deleteMessageFailedTitle'));
                        });
                      }}
                      onEdit={() => {
                        setEditTarget({ id: msg.id, originalContent: msg.content });
                        setReplyTarget(null);
                        setMessageInput(msg.content);
                        focusMessageInput();
                      }}
                      content={msg.content}
                      isBundled={isBundled}
                      replyQuote={replyQuote}
                      bubblePosition={groupPosition}
                      messageTime={messageTime}
                      isRead={isOutgoingMessageRead(msg, messages, currentUserId)}
                      readLabel={readLabel}
                      editedAt={msg.edited_at}
                      onMediaLoad={isLastMessage ? handleLastMediaReady : undefined}
                    />
                  </div>
                </div>
              </div>
            </div>
        </motion.div>
      );
    });
  }, [
    messages,
    currentUserId,
    lastOwnMessageId,
    newlyLoadedIds,
    i18n.language,
    meAvatarUrl,
    otherUser.imageUrl,
    meDisplay,
    otherDisplay,
    getSenderLabel,
    t,
    replyTarget?.id,
    deleteMessage,
    handleLastMediaReady,
  ],
  );

  const { isPartnerTyping, sendTyping } = useTyping(conversationId, currentUserId, isGhostMode);

  // Save scroll position when the conversation changes or unmounts
  useEffect(() => {
    return () => {
      if (initialScrollDoneRef.current && scrollTrackerRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = scrollTrackerRef.current;
        chatScrollCache.set(conversationId, {
          scrollTop,
          scrollHeight,
          wasNearBottom: (scrollHeight - scrollTop - clientHeight) <= 96,
          timestamp: Date.now(),
        });
      }
      stopPreviewBottomGrowthFollow();
    };
  }, [conversationId, stopPreviewBottomGrowthFollow]);

  useEffect(() => {
    initialScrollDoneRef.current = false;
    didApplyInitialOpenScrollRef.current = false;
    isRestoringFromCacheRef.current = false;
    userHasInteractedRef.current = false;
    initialOpenReasonRef.current = openReason;
    if (pendingPreviewBottomStabilizeRef.current !== null) {
      cancelAnimationFrame(pendingPreviewBottomStabilizeRef.current);
      pendingPreviewBottomStabilizeRef.current = null;
    }
    stopPreviewBottomGrowthFollow();
    lastMessageIdRef.current = null;
    lastAppliedViewedAtRef.current = null;
    lastOwnReadAtRef.current = null;
    lastMessageReactionKeyRef.current = null;
    readReceiptScrollSeededRef.current = false;
    setScrollAnchorReady(false);
  }, [conversationId, openReason, stopPreviewBottomGrowthFollow]);

  useEffect(() => {
    if (!shouldRunExpensiveEffects) return;
    NotificationManager.setActiveConversationId(conversationId);
    window.dispatchEvent(
      new CustomEvent('conversation-opened', { detail: { conversationId } })
    );

    return () => {
      NotificationManager.setActiveConversationId(null);
      window.dispatchEvent(new CustomEvent('conversation-closed'));
    };
  }, [conversationId]);

  useEffect(() => {
    if (!shouldRunExpensiveEffects) return;
    canLoadOlderRef.current = false;
    const timer = setTimeout(() => {
      canLoadOlderRef.current = true;
    }, 1000);
    return () => clearTimeout(timer);
  }, [conversationId]);

  useLayoutEffect(() => {
    if (!shouldRunExpensiveEffects) return;
    if (loading || messages.length === 0) return;
    const container = messagesContainerRef.current;
    if (!container) return;

    if (!initialScrollDoneRef.current) {
      applyInitialScrollPosition();
      initialScrollDoneRef.current = true;
      lastMessageIdRef.current = messages[messages.length - 1]?.id ?? null;
      lastAppliedViewedAtRef.current = lastViewedAt;
      requestAnimationFrame(() => {
        setScrollAnchorReady(true);
      });

      // Reactions render asynchronously after messages (separate per-message fetch).
      // Use MutationObserver to watch for new nodes being added to the message list
      // (reaction bar DOM insertion) and immediately re-pin to true bottom.
      if (container) {
        let pinActive = true;
        const mo = new MutationObserver(() => {
          if (!pinActive || !shouldRunScrollSnapReactions) { mo.disconnect(); return; }
          const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
          // Only re-pin if already near the bottom — do not override a user scroll.
          const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
          if (dist < 96 && container.scrollTop < maxScroll) {
            container.scrollTop = maxScroll;
          }
        });
        mo.observe(container, { childList: true, subtree: true });
        window.setTimeout(() => { pinActive = false; mo.disconnect(); }, 1500);
      }

      return;
    }

    const lastMessage = messages[messages.length - 1];
    if (lastMessageIdRef.current !== lastMessage.id) {
      lastMessageIdRef.current = lastMessage.id;
      lastMessageReactionKeyRef.current = JSON.stringify(lastMessage.reactions ?? null);
      const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
      const isMyMessage = lastMessage.sender_id === currentUserId;
      console.log('[scroll-snap] new-message branch', { dist, isMyMessage, nearBottom: isNearBottom(container) });
      if (isMyMessage || isNearBottom(container, 96)) {
        scrollContainerToBottomStable(container);
      }
      return;
    }

    // Re-pin when a reaction is added/removed on the last message and the user
    // is already near the bottom (the reaction row height shifts the layout).
    const reactionKey = JSON.stringify(lastMessage.reactions ?? null);
    if (reactionKey !== lastMessageReactionKeyRef.current) {
      lastMessageReactionKeyRef.current = reactionKey;
      const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
      console.log('[scroll-snap] reaction branch', { dist, nearBottom: isNearBottom(container) });
      if (isNearBottom(container)) {
        if (!shouldRunScrollSnapReactions) return; // Centralized gating
        requestAnimationFrame(() => scrollContainerToBottomStable(container));
      }
      return;
    }

    if (
      lastViewedAt &&
      lastAppliedViewedAtRef.current !== lastViewedAt &&
      !findFirstUnreadMessageId(messages, currentUserId, lastViewedAt)
    ) {
      // Only update the ref — do NOT scroll. markAsRead fires continuously with
      // fresh ISO strings, so this branch fires on every read-receipt update.
      // Initial scroll-to-bottom is already handled by applyInitialScrollPosition.
      lastAppliedViewedAtRef.current = lastViewedAt;
    }
  }, [loading, messages, lastViewedAt, currentUserId, applyInitialScrollPosition, shouldRunScrollSnapReactions]);

  useLayoutEffect(() => {
    if (!shouldRunScrollSnapReactions) return; // Centralized gating
    let rafId: number | null = null;
    
    if (!isPartnerTyping) {
      setTypingClearance(0);
      if (initialScrollDoneRef.current) {
        rafId = requestAnimationFrame(() => {
          const container = messagesContainerRef.current;
          if (!container) return;
          const distance =
            container.scrollHeight - container.scrollTop - container.clientHeight;
          if (distance < 96) {
            scrollContainerToBottomStable(container);
          }
          rafId = null;
        });
      }
      return () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
      };
    }

    const measure = () => {
      const el = typingIndicatorRef.current;
      if (!el) return;
      const height = el.offsetHeight;
      setTypingClearance(height + CHAT_TYPING_CLEARANCE_EXTRA_PX);
    };
    measure();
    rafId = requestAnimationFrame(measure);

    let observer: ResizeObserver | undefined;
    const indicator = typingIndicatorRef.current;
    if (indicator) {
      observer = new ResizeObserver(measure);
      observer.observe(indicator);
    }

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer?.disconnect();
    };
  }, [isPartnerTyping, shouldRunScrollSnapReactions]);

  useLayoutEffect(() => {
    if (!shouldRunScrollSnapReactions) return;
    if (!isPartnerTyping || typingClearance <= 0 || !scrollAnchorReady) return;
    const container = messagesContainerRef.current;
    if (!container) return;

    let rafId: number | null = null;
    if (isNearBottom(container)) {
      rafId = requestAnimationFrame(() => {
        scrollContainerToBottomStable(container);
        rafId = null;
      });
    }
    
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isPartnerTyping, typingClearance, scrollAnchorReady, shouldRunScrollSnapReactions]);

  useLayoutEffect(() => {
    if (!shouldRunScrollSnapReactions) return;
    if (!scrollAnchorReady || loading) return;
    const container = messagesContainerRef.current;
    if (!container || !lastOwnMessageId) return;

    const lastOwn = messages.find((m) => m.id === lastOwnMessageId);
    const readAt = lastOwn?.read_at ?? null;

    if (!readReceiptScrollSeededRef.current) {
      readReceiptScrollSeededRef.current = true;
      lastOwnReadAtRef.current = readAt;
      return;
    }

    if (!readAt || readAt === lastOwnReadAtRef.current) return;

    lastOwnReadAtRef.current = readAt;
    if (!isNearBottom(container)) return;

    let rafId: number | null = null;
    rafId = requestAnimationFrame(() => {
      scrollContainerToBottomStable(container, 12, { smooth: true });
      rafId = null;
    });

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [messages, lastOwnMessageId, scrollAnchorReady, loading]);

  const loadOlderAndPreserveScroll = useCallback(async () => {
    if (loadingMore || !hasMore || isLoadingOlderRef.current) return;
    const container = messagesContainerRef.current;
    if (!container) return;

    isLoadingOlderRef.current = true;

    const messageElements = container.querySelectorAll('[data-message-id]');
    let firstVisibleMessageId: string | null = null;
    for (const el of Array.from(messageElements)) {
      const rect = el.getBoundingClientRect();
      if (rect.top >= 0 && rect.top < window.innerHeight) {
        firstVisibleMessageId = el.getAttribute('data-message-id');
        break;
      }
    }

    const olderMessages = await loadOlderMessages();

    setTimeout(() => {
      if (olderMessages.length > 0) {
        setNewlyLoadedIds(new Set(olderMessages.map((m) => m.id)));
        setTimeout(() => setNewlyLoadedIds(new Set()), 400);
      }
      if (firstVisibleMessageId) {
        const targetElement = container.querySelector(
          `[data-message-id="${firstVisibleMessageId}"]`
        );
        if (targetElement) {
          targetElement.scrollIntoView({ block: 'start', behavior: 'auto' });
        }
      }
      isLoadingOlderRef.current = false;
    }, 120);
  }, [loadOlderMessages, loadingMore, hasMore]);

  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    scrollToBottomHandleScroll();

    if (container && initialScrollDoneRef.current) {
      chatScrollCache.set(conversationId, {
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        wasNearBottom: isNearBottom(container, 96),
        timestamp: Date.now(),
      });
    }

    if (!container || loadingMore || !hasMore) return;
    if (container.scrollTop <= 80 && canLoadOlderRef.current) {
      loadOlderAndPreserveScroll();
    }
  }, [conversationId, loadOlderAndPreserveScroll, loadingMore, hasMore, scrollToBottomHandleScroll]);

  // Ref tracks the timestamp of the last typing=true broadcast to throttle sends.
  const lastTypingTrueRef = useRef(0);
  useEffect(() => {
    if (messageInput.trim().length > 0) {
      const now = Date.now();
      if (now - lastTypingTrueRef.current >= 300) {
        lastTypingTrueRef.current = now;
        void sendTyping(true);
      }
    } else {
      lastTypingTrueRef.current = 0;
      void sendTyping(false);
    }
  }, [messageInput, sendTyping]);

  useEffect(() => {
    if (!showOptionsMenu || !shouldAttachGlobalListeners) return;

    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        optionsMenuRef.current &&
        !optionsMenuRef.current.contains(target) &&
        optionsButtonRef.current &&
        !optionsButtonRef.current.contains(target)
      ) {
        setShowOptionsMenu(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showOptionsMenu, shouldAttachGlobalListeners]);

  useEffect(() => {
    if (!profilePreviewUserId) {
      setProfilePreviewData(null);
      return;
    }
    let cancelled = false;
    const loadProfile = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, name, display_name, username, bio, avatar_url, images')
          .eq('id', profilePreviewUserId)
          .single();
        if (cancelled) return;
        if (error) throw error;
        if (data) {
          setProfilePreviewData({
            id: data.id,
            name: data.display_name || data.name || 'Unknown',
            display_name: data.display_name || data.name,
            username: data.username,
            bio: data.bio || '',
            avatar_url: data.avatar_url,
            images: data.images || [],
          });
        }
      } catch {
        if (!cancelled) setProfilePreviewUserId(null);
      }
    };
    void loadProfile();
    return () => { cancelled = true; };
  }, [profilePreviewUserId]);

  // ──────────────────────────────────────────────────────────────────────────
  // Mark incoming messages as read only when the user is actively viewing
  // Track scroll position passively to avoid DOM reads during unmount/cleanup
  const scrollTrackerRef = useRef<{ scrollTop: number; scrollHeight: number; clientHeight: number } | null>(null);

  // the bottom of the message list (i.e. they can actually see the messages).
  // Stable ref so tryMark always sees the latest markAsRead without being a dep.
  const markAsReadRef = useRef(markAsRead);
  markAsReadRef.current = markAsRead;
  useEffect(() => {
    if (!shouldAttachGlobalListeners) return;
    const container = messagesContainerRef.current;
    if (!container || !conversationId) return;

    const tryMark = () => {
      scrollTrackerRef.current = {
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight
      };
      
      // Only fire when the tab/window is visible.
      if (document.visibilityState !== 'visible') return;
      // Only fire when the user is near the bottom (messages are visible).
      const dist = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (dist > 96) return;
      void markAsReadRef.current();
    };

    // IntersectionObserver — fires when the container enters/exits the viewport
    // (covers cases like switching apps, minimising, or chat sliding out of view).
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) tryMark();
      },
      { threshold: 0.1 }
    );
    io.observe(container);

    // Track user interactions to stop any background post-stabilizations
    const recordUserInteraction = () => {
      userHasInteractedRef.current = true;
      if (pendingPreviewBottomStabilizeRef.current !== null) {
        cancelAnimationFrame(pendingPreviewBottomStabilizeRef.current);
        pendingPreviewBottomStabilizeRef.current = null;
      }
    };

    container.addEventListener('wheel', recordUserInteraction, { passive: true });
    container.addEventListener('touchstart', recordUserInteraction, { passive: true });
    container.addEventListener('touchmove', recordUserInteraction, { passive: true });
    container.addEventListener('pointerdown', recordUserInteraction, { passive: true });
    container.addEventListener('keydown', recordUserInteraction, { passive: true });

    // Scroll listener — fires while the user scrolls towards the bottom.
    container.addEventListener('scroll', tryMark, { passive: true });

    // Visibility change — re-evaluate when the tab becomes active again.
    document.addEventListener('visibilitychange', tryMark);

    // Run once immediately in case the chat opens already scrolled to the bottom.
    tryMark();

    return () => {
      io.disconnect();
      container.removeEventListener('wheel', recordUserInteraction);
      container.removeEventListener('touchstart', recordUserInteraction);
      container.removeEventListener('touchmove', recordUserInteraction);
      container.removeEventListener('pointerdown', recordUserInteraction);
      container.removeEventListener('keydown', recordUserInteraction);
      container.removeEventListener('scroll', tryMark);
      document.removeEventListener('visibilitychange', tryMark);
    };
    // messages intentionally omitted: messagesRef.current is read inside tryMark
    // via markAsReadRef, so the observers don't need to be recreated per message.
  }, [conversationId, shouldAttachGlobalListeners]);

  const focusMessageInput = useCallback(() => {
    if (!isMdUp) return;
    requestAnimationFrame(() => {
      messageInputRef.current?.focus({ preventScroll: true });
    });
  }, [isMdUp]);

  useLayoutEffect(() => {
    if (!shouldRunExpensiveEffects) return;
    if (!conversationId || !isMdUp) return;
    const id = requestAnimationFrame(() => {
      messageInputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [conversationId, isMdUp, shouldRunExpensiveEffects]);

  const sendWithAttachments = useCallback(
    async (content: string, attachmentIds: string[], replyToMessageId: string | null) => {
      const msg = await sendMessage(content, replyToMessageId, attachmentIds);
      return !!msg;
    },
    [sendMessage],
  );

  const {
    sendFiles: sendMediaFiles,
    sendVoiceMemo,
    uploading: mediaUploading,
    uploadLabel: mediaUploadLabel,
  } = useChatMediaSend(
    conversationId ? { type: 'dm', conversationId } : null,
    sendWithAttachments,
  );

  const handleSend = useCallback(async () => {
    const trimmed = messageInput.trim();
    if (!trimmed || sending || mediaUploading) return;

    // Edit mode: update the existing message instead of sending a new one.
    if (editTarget) {
      const { id, originalContent } = editTarget;
      setEditTarget(null);
      setMessageInput('');
      if (trimmed === originalContent) return; // no change
      try {
        await api.editMessageSafe(id, trimmed);
        // Realtime subscription in useChat will push the updated row automatically.
      } catch {
        toast.error(t('chat.editMessageFailed', 'Could not edit message'));
        setMessageInput(trimmed);
        setEditTarget({ id, originalContent });
      }
      focusMessageInput();
      return;
    }

    const replyToId = replyTarget?.id ?? null;
    const activeReply = replyTarget;
    setMessageInput('');
    setReplyTarget(null);
    const sent = await sendMessage(trimmed, replyToId);
    if (!sent) {
      setMessageInput((prev) => (prev === '' ? trimmed : prev));
      if (activeReply) {
        setReplyTarget(activeReply);
      }
    }
    focusMessageInput();
  }, [messageInput, sending, mediaUploading, sendMessage, focusMessageInput, replyTarget, editTarget, t]);

  const handleSendFiles = useCallback(
    async (files: File[], caption?: string) => {
      const replyToId = replyTarget?.id ?? null;
      const activeReply = replyTarget;
      setReplyTarget(null);
      const ok = await sendMediaFiles(files, { caption, replyToMessageId: replyToId });
      if (!ok && activeReply) setReplyTarget(activeReply);
      focusMessageInput();
    },
    [replyTarget, sendMediaFiles, focusMessageInput],
  );

  const handleSendVoiceMemo = useCallback(
    async (blob: Blob) => {
      const replyToId = replyTarget?.id ?? null;
      const activeReply = replyTarget;
      setReplyTarget(null);
      const ok = await sendVoiceMemo(blob, replyToId);
      if (!ok && activeReply) setReplyTarget(activeReply);
      focusMessageInput();
    },
    [replyTarget, sendVoiceMemo, focusMessageInput],
  );

  const handleSendUrl = useCallback(
    async (url: string) => {
      if (sending || !url.trim()) return;

      const replyToId = replyTarget?.id ?? null;
      const activeReply = replyTarget;
      setReplyTarget(null);
      const content = await normalizeGifUrlForMessage(url.trim());
      const sent = await sendMessage(content, replyToId);
      if (!sent && activeReply) {
        setReplyTarget(activeReply);
      }
      focusMessageInput();
    },
    [sending, sendMessage, focusMessageInput, replyTarget]
  );

  const handleReportUser = () => {
    setReportTargetUserId(otherUser.id);
    setShowOptionsMenu(false);
    setShowReportModal(true);
  };

  const submitReport = async () => {
    if (!selectedReportReason || !reportTargetUserId) return;

    try {
      const user = getCachedUser() ?? (await resolveAuthUser());
      if (!user) throw new Error('User not authenticated');

      const { error } = await supabase
        .from('reports')
        .insert({
          reporter_id: user.id,
          reported_id: reportTargetUserId,
          reason: selectedReportReason,
        });

      if (error) throw error;
      toast.success(t('chat.reportSuccess'));
    } catch (error: any) {
      console.error('Failed to report user:', error);
      toast.error(t('chat.reportFailedTitle'), error.message || t('chat.reportFailedTitle'));
    } finally {
      setShowReportModal(false);
      setSelectedReportReason(null);
      setReportTargetUserId(null);
    }
  };

  const handleBlockUser = () => {
    setShowOptionsMenu(false);
    setShowBlockModal(true);
  };

  const confirmBlockUser = async () => {
    try {
      await api.blockUser(otherUser.id);
      toast.success(t('chat.blockSuccess'));
      setShowBlockModal(false);
      onBack();
    } catch (error: any) {
      console.error('Failed to block user:', error);
      toast.error(t('chat.blockFailedTitle'), error.message || t('chat.blockFailedTitle'));
    }
  };

  const isThisChatBusyForMe =
    (callState === 'calling' || (callState === 'in_call' && callConnectionState === 'connected')) &&
    activeCall?.conversationId === conversationId;
  const isCallButtonDisabled = isThisChatBusyForMe;

  const headerContent = (
    <div
      ref={headerPortalRef}
      className={`blyve-screen-bg border-b border-gray-200 blyve-border-subtle shrink-0 w-full z-20`}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          {!isDesktop && (
            <button
              onClick={onBack}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full"
              style={{
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
                cursor: 'pointer'
              }}
            >
              <ArrowLeft className="w-6 h-6 text-gray-900 dark:text-white" />
            </button>
          )}

          <div
            onContextMenu={openProfileActions}
            {...profileLongPress}
          >
            <button
              onClick={() => setProfilePreviewUserId(otherUser.id)}
              className="flex items-center gap-3"
              style={{
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
                cursor: 'pointer'
              }}
            >
              <img
                src={otherUser.imageUrl ? getOptimizedImageUrl(otherUser.imageUrl, 200) : `https://ui-avatars.com/api/?name=${encodeURIComponent(otherDisplay)}`}
                alt={otherDisplay}
                className="w-10 h-10 rounded-full object-cover"
              />
              <div>
                <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                  {otherDisplay}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {(isOnlineProp?.(otherUser.id) ?? otherUser.is_online) ? t('chat.online') : t('chat.offline')}
                </p>
              </div>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0 min-w-0">
          <button
            type="button"
            onPointerDown={() => debugChatCallBridge('start-call-button pointerdown')}
            onClick={() => {
              debugChatCallBridge('start-call-button click');
              void startDirectCall({
                conversationId,
                otherUserId: otherUser.id,
                otherUserName: otherDisplay,
                otherUserAvatar: otherUser.imageUrl,
              });
            }}
            onDoubleClick={() => debugChatCallBridge('start-call-button dblclick')}
            onFocus={() => debugChatCallBridge('start-call-button focus')}
            onBlur={() => debugChatCallBridge('start-call-button blur')}
            title="Start call"
            disabled={isCallButtonDisabled}
            className={`p-2 rounded-full transition-colors shrink-0 ${
              'hover:bg-gray-100 dark:hover:bg-gray-800'
            } ${isCallButtonDisabled ? 'opacity-70 cursor-not-allowed' : ''}`}
          >
            <Phone
              className={`w-5 h-5 ${
                'text-gray-600 dark:text-gray-300'
              }`}
            />
          </button>
          <button
            ref={optionsButtonRef}
            onClick={() => setShowOptionsMenu((prev) => !prev)}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full"
          >
            <MoreVertical className="w-5 h-5 text-gray-600 dark:text-gray-300" />
          </button>
        </div>
      </div>
      <ChatEmbeddedCallBar conversationId={conversationId} currentUserId={currentUserId} isActive={isActiveTopScreen} />
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0 w-full max-w-full flex-col blyve-screen-bg z-50">
      {/* CRITICAL UI ARCHITECTURE WARNING:
          Do NOT blindly refactor this header rendering logic to always use `createPortal(..., document.body)`.
          Because screens are kept alive and translated horizontally (they are NOT unmounted or `display: none`),
          using `createPortal` unconditionally will cause the header to leak globally across the app over other screens, 
          OR it will detach from the screen body during swipe animations.
          The portal is ONLY used on mobile AND when the screen is the active top screen AND NOT transitioning (to break free from transform-based clipping for the iOS keyboard).
          DO NOT REMOVE OR CHANGE THIS LOGIC UNLESS IT IS A STRICT REFACTOR AND REQUIRED! */}
      {true || isDesktop || !isActiveTopScreen || isTransitioning ? (
        <div
          ref={headerPortalRef}
          className="blyve-screen-bg border-b border-gray-200 blyve-border-subtle shrink-0 w-full z-20"
        >
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <button
                onClick={onBack}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full"
                style={{
                  touchAction: 'manipulation',
                  WebkitTapHighlightColor: 'transparent',
                  cursor: 'pointer'
                }}
              >
                <ArrowLeft className="w-6 h-6 text-gray-900 dark:text-white" />
              </button>

              <div
                onContextMenu={openProfileActions}
                {...profileLongPress}
              >
                <button
                  onClick={() => setProfilePreviewUserId(otherUser.id)}
                  className="flex items-center gap-3"
                  style={{
                    touchAction: 'manipulation',
                    WebkitTapHighlightColor: 'transparent',
                    cursor: 'pointer'
                  }}
                >
                  <img
                    src={otherUser.imageUrl ? getOptimizedImageUrl(otherUser.imageUrl, 200) : `https://ui-avatars.com/api/?name=${encodeURIComponent(otherDisplay)}`}
                    alt={otherDisplay}
                    className="w-10 h-10 rounded-full object-cover"
                  />
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                      {otherDisplay}
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {(isOnlineProp?.(otherUser.id) ?? otherUser.is_online) ? t('chat.online') : t('chat.offline')}
                    </p>
                  </div>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0 min-w-0">
              <button
                type="button"
                onPointerDown={() => debugChatCallBridge('start-call-button pointerdown')}
                onClick={() => {
                  debugChatCallBridge('start-call-button click');
                  void startDirectCall({
                    conversationId,
                    otherUserId: otherUser.id,
                    otherUserName: otherDisplay,
                    otherUserAvatar: otherUser.imageUrl,
                  });
                }}
                onDoubleClick={() => debugChatCallBridge('start-call-button dblclick')}
                onFocus={() => debugChatCallBridge('start-call-button focus')}
                onBlur={() => debugChatCallBridge('start-call-button blur')}
                title="Start call"
                disabled={isCallButtonDisabled}
                className={`p-2 rounded-full transition-colors shrink-0 ${
                  'hover:bg-gray-100 dark:hover:bg-gray-800'
                } ${isCallButtonDisabled ? 'opacity-70 cursor-not-allowed' : ''}`}
              >
                <Phone
                  className={`w-5 h-5 ${
                    'text-gray-600 dark:text-gray-300'
                  }`}
                />
              </button>
              <button
                ref={optionsButtonRef}
                onClick={() => setShowOptionsMenu((prev) => !prev)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full"
              >
                <MoreVertical className="w-5 h-5 text-gray-600 dark:text-gray-300" />
              </button>
            </div>
          </div>
          <ChatEmbeddedCallBar conversationId={conversationId} currentUserId={currentUserId} isActive={isActiveTopScreen} />
        </div>
      ) : (
        <>
          {/* Placeholder prevents messages from jumping up when the header is moved to the portal */}
          <div style={{ height: headerHeight > 0 ? headerHeight : 65, flexShrink: 0, width: '100%' }} />
          {isPortalActive && createPortal(
            <div
              ref={headerPortalRef}
          style={{
            position: 'fixed',
            // Match the nav shell's top so the header aligns with the visual
            // viewport offset. This eliminates the gap between portal bottom
            // and the messages paddingTop when vv.offsetTop > 0.
            top: 'var(--blyve-vv-offset-top, 0px)',
            left: 0,
            right: 0,
            zIndex: 66,
          }}
          className="blyve-screen-bg border-b border-gray-200 blyve-border-subtle"
        >
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <button
                onClick={onBack}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full"
                style={{
                  touchAction: 'manipulation',
                  WebkitTapHighlightColor: 'transparent',
                  cursor: 'pointer'
                }}
              >
                <ArrowLeft className="w-6 h-6 text-gray-900 dark:text-white" />
              </button>

              <div
                onContextMenu={openProfileActions}
                {...profileLongPress}
              >
                <button
                  onClick={() => setProfilePreviewUserId(otherUser.id)}
                  className="flex items-center gap-3"
                  style={{
                    touchAction: 'manipulation',
                    WebkitTapHighlightColor: 'transparent',
                    cursor: 'pointer'
                  }}
                >
                  <img
                    src={otherUser.imageUrl ? getOptimizedImageUrl(otherUser.imageUrl, 200) : `https://ui-avatars.com/api/?name=${encodeURIComponent(otherDisplay)}`}
                    alt={otherDisplay}
                    className="w-10 h-10 rounded-full object-cover"
                  />
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                      {otherDisplay}
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {(isOnlineProp?.(otherUser.id) ?? otherUser.is_online) ? t('chat.online') : t('chat.offline')}
                    </p>
                  </div>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0 min-w-0">
              <button
                type="button"
                onPointerDown={() => debugChatCallBridge('start-call-button pointerdown')}
                onClick={() => {
                  debugChatCallBridge('start-call-button click');
                  void startDirectCall({
                    conversationId,
                    otherUserId: otherUser.id,
                    otherUserName: otherDisplay,
                    otherUserAvatar: otherUser.imageUrl,
                  });
                }}
                onDoubleClick={() => debugChatCallBridge('start-call-button dblclick')}
                onFocus={() => debugChatCallBridge('start-call-button focus')}
                onBlur={() => debugChatCallBridge('start-call-button blur')}
                title="Start call"
                disabled={isCallButtonDisabled}
                className={`p-2 rounded-full transition-colors shrink-0 ${
                  'hover:bg-gray-100 dark:hover:bg-gray-800'
                } ${isCallButtonDisabled ? 'opacity-70 cursor-not-allowed' : ''}`}
              >
                <Phone
                  className={`w-5 h-5 ${
                    'text-gray-600 dark:text-gray-300'
                  }`}
                />
              </button>
              <button
                ref={optionsButtonRef}
                onClick={() => setShowOptionsMenu((prev) => !prev)}
                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full"
              >
                <MoreVertical className="w-5 h-5 text-gray-600 dark:text-gray-300" />
              </button>
            </div>
          </div>
          <ChatEmbeddedCallBar conversationId={conversationId} currentUserId={currentUserId} isActive={isActiveTopScreen} />
        </div>,
        document.body
      )}
      </>
      )}

      {/* Messages — relative wrapper so ScrollToBottomButton anchors above the composer */}
      <div className="relative min-h-0 flex-1 flex flex-col" style={{ paddingTop: 0 }}>
        {/* Sticky date pill overlay */}
        {stickyDateLabel ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center"
            style={{
              opacity: stickyDateVisible ? 1 : 0,
              transition: 'opacity 0.2s ease',
            }}
          >
            <span className="rounded-full bg-black/40 px-3 py-1 text-[11px] font-medium leading-tight text-white backdrop-blur-sm dark:bg-black/55">
              {stickyDateLabel}
            </span>
          </div>
        ) : null}
        <div
          data-chat-messages-scroll
          className={`${CHAT_MESSAGE_LIST_CLASS} ${dropActive ? 'ring-2 ring-inset ring-blyve/40' : ''}`}
          ref={messagesContainerRef}
          onScroll={handleMessagesScroll}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDropActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          if (e.currentTarget === e.target) setDropActive(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDropActive(false);
          if (e.dataTransfer.files?.length) {
            void handleSendFiles(Array.from(e.dataTransfer.files));
          }
        }}
        style={{
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
          overscrollBehavior: 'contain',
          overscrollBehaviorX: 'none',
          overscrollBehaviorY: 'contain',
        }}
      >
        {loading && messages.length === 0 ? (
          <div className="flex h-full items-center justify-center blyve-screen-bg">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-red-500 dark:text-red-400">{error}</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-gray-500 dark:text-gray-400">{t('chat.noMessagesHint')}</p>
          </div>
        ) : (
          <div ref={messagesContentRef} className="flex flex-col min-h-full w-full">
            {loadingMore && (
              <div className="flex items-center justify-center py-2">
                <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
              </div>
            )}
            {renderedMessages}
            {typingClearance > 0 && (
              <div aria-hidden style={{ height: typingClearance, flexShrink: 0 }} />
            )}
            <div ref={bottomAnchorRef} data-chat-bottom-anchor aria-hidden style={{ height: 1, flexShrink: 0, overflowAnchor: 'auto' }} />
            <div ref={messagesEndRef} data-chat-scroll-end aria-hidden />
          </div>
        )}
        </div>
        <ScrollToBottomButton show={showScrollToBottom} onClick={scrollToBottom} />
      </div>

      <ChatMessageComposer
        value={messageInput}
        onChange={setMessageInput}
        onSend={handleSend}
        onSendUrl={handleSendUrl}
        onSendFiles={handleSendFiles}
        onSendVoiceMemo={handleSendVoiceMemo}
        placeholder={t('chat.dmMessagePlaceholder')}
        sending={sending}
        mediaUploading={mediaUploading}
        mediaUploadLabel={mediaUploadLabel}
        dropActive={dropActive}
        onDropActiveChange={setDropActive}
        inputRef={messageInputRef}
        replyBar={
          editTarget ? (
            <div className="flex items-center gap-2 border-t border-gray-200 px-4 py-2 dark:border-white/10">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium" style={{ color: '#3faf95' }}>{t('chat.editingMessage', 'Editing message')}</p>
                <p className="truncate text-xs text-gray-500 dark:text-gray-400">{editTarget.originalContent}</p>
              </div>
              <button
                type="button"
                aria-label={t('common.cancel', 'Cancel')}
                onClick={() => { setEditTarget(null); setMessageInput(''); }}
                className="shrink-0 rounded-full p-1 text-gray-400 transition-colors hover:text-gray-600 dark:hover:text-gray-200"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ) : replyTarget ? (
            <MessageReplyComposerBar target={replyTarget} onCancel={() => setReplyTarget(null)} />
          ) : null
        }
        typingIndicator={
          <AnimatePresence>
            {isPartnerTyping ? (
              <div ref={typingIndicatorRef} className="absolute bottom-full left-4 z-30 mb-2">
                <TypingBubble inline />
              </div>
            ) : null}
          </AnimatePresence>
        }
      />
      {showOptionsMenu && (
        <div
          ref={optionsMenuRef}
          className="absolute right-4 top-14 z-40 w-36 rounded-lg border border-gray-200 dark:border-white/5 blyve-panel-bg shadow-lg overflow-hidden"
        >
          <button
            onClick={handleReportUser}
            className="w-full px-3 py-2 text-left text-xs text-gray-900 dark:text-white md:dark:text-white hover:bg-gray-50 dark:hover:bg-white/5"
          >
            {t('chat.reportProfile')}
          </button>
          <button
            onClick={handleBlockUser}
            className="w-full px-3 py-2 text-left text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10"
          >
            {t('chat.blockProfile')}
          </button>
    </div>
      )}


      {showReportModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => {
              setShowReportModal(false);
              setSelectedReportReason(null);
              setReportTargetUserId(null);
            }}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative bg-white dark:bg-[#0A0A0A] dark:border dark:border-white/5 rounded-2xl w-full max-w-md p-6"
          >
            <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">
              {t('profile.reportUser')}
            </h3>
            <div className="space-y-2 mb-4">
              {REPORT_REASONS.map((reason) => (
                <button
                  key={reason.key}
                  onClick={() => setSelectedReportReason(reason.key)}
                  className={`w-full text-left px-4 py-2 rounded-lg border transition-colors ${
                    selectedReportReason === reason.key
                      ? 'border-blyve bg-blyve/10 text-blyve font-medium dark:bg-blyve/15 dark:text-blyve'
                      : 'border-gray-200 dark:border-white/5 text-gray-700 dark:text-gray-200'
                  }`}
                >
                  {t(`report.reasons.${reason.key}`)}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowReportModal(false);
                  setSelectedReportReason(null);
                  setReportTargetUserId(null);
                }}
                className="flex-1 py-2 rounded-lg border border-gray-200 dark:border-white/5 text-gray-700 dark:text-gray-200"
              >
                {t('profile.cancel')}
              </button>
              <button
                onClick={submitReport}
                disabled={!selectedReportReason}
                className="flex-1 py-2 rounded-lg bg-blyve hover:bg-blyve-hover text-white disabled:opacity-50 shadow-lg"
              >
                {t('chat.reportSubmit')}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* BLOCK USER MODAL */}
      {showBlockModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowBlockModal(false)}
          />

          {/* Modal Content */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative w-full max-w-xs bg-white dark:bg-[#1e1e1e] rounded-3xl p-6 shadow-2xl border border-gray-100 dark:border-gray-800 overflow-hidden"
          >
            <div className="flex flex-col items-center text-center gap-4">
              <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-500 mb-2">
                <Ban className="w-6 h-6" />
              </div>

              <h3 className="text-xl font-bold text-gray-900 dark:text-white">
                {t('chat.blockUserTitle')}
              </h3>

              <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">
                {t('chat.blockUserConfirm')}
              </p>

              <div className="flex gap-3 w-full mt-2">
                <button
                  onClick={() => setShowBlockModal(false)}
                  className="flex-1 py-3 px-4 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-semibold text-sm"
                >
                  {t('profile.cancel')}
                </button>

                <button
                  onClick={confirmBlockUser}
                  className="flex-1 py-3 px-4 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold text-sm shadow-lg shadow-red-500/30"
                >
                  {t('chat.blockSubmit')}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {conversationActionsMenu ? (
        <ConversationActionsMenu
          target={conversationActionsMenu}
          onClose={() => setConversationActionsMenu(null)}
          onViewProfile={() => setProfilePreviewUserId(otherUser.id)}
          onRemoveFriend={handleRemoveFriend}
          onBlockUser={handleBlockFromMenu}
        />
      ) : null}

      {profilePreviewUserId && profilePreviewData && (
        <SharedProfileView
          profile={profilePreviewData}
          conversationId={conversationId}
          onClose={() => {
            setProfilePreviewUserId(null);
            setProfilePreviewData(null);
          }}
        />
      )}
    </div>
  );
}
