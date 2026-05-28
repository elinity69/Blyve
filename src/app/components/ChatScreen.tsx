import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
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
import { useAppData } from '../context/AppDataContext';
import { TypingBubble } from './TypingBubble';
import { useIsMdUp, useIsMobile } from './ui/use-mobile';
import { useChatScrollAnchor } from '../hooks/useChatScrollAnchor';
import { useCall } from '../context/CallContext';
import { ChatEmbeddedCallBar } from './ChatEmbeddedCallBar';
import { NotificationManager } from '../lib/notifications';
import { getCachedUser, resolveAuthUser } from '../lib/authSession';
import { getAppDateLocale } from '../../lib/i18n';
import {
  ConversationActionsMenu,
  openConversationActionsMenuFromEvent,
  type ConversationActionTarget,
} from './ConversationActionsMenu';
import { useLongPress } from '../hooks/useLongPress';
import { MessageReplyComposerBar } from './chat/MessageReplyComposerBar';
import { ChatMessageComposer } from './chat/ChatMessageComposer';
import { MessageRowReplyWrapper } from './chat/MessageRowReplyWrapper';
import { MessageRowReplyButton } from './chat/MessageRowReplyButton';
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
import { ChatMessageBody } from './chat/ChatMessageBody';
import {
  formatMessageTime,
  getMessageGroupPosition,
  isMessageBundled,
  isMessageGroupEnd,
  isMessageGroupStart,
  isNewSenderGroupStart,
} from '../lib/messageGrouping';
import { isOutgoingMessageRead } from '../lib/messageReadReceipts';

interface ChatScreenProps {
  onBack: () => void;
  conversationId: string;
  otherUser: {
    id: string;
    name: string;
    display_name?: string;
    username?: string;
    imageUrl?: string;
    is_online?: boolean;
  };
  currentUserId: string;
  onOpenProfilePreview?: (userId: string) => void;
  onConversationUpdated?: () => void;
}

export function ChatScreen({
  onBack, 
  conversationId,
  otherUser,
  currentUserId,
  onOpenProfilePreview,
  onConversationUpdated,
}: ChatScreenProps) {
  const { t, i18n } = useTranslation();
  const [conversationActionsMenu, setConversationActionsMenu] = useState<ConversationActionTarget | null>(null);
  const { messages, loading, loadingMore, hasMore, sending, error, sendMessage, loadOlderMessages } = useChat(conversationId);
  const { currentUserProfile } = useAppData();
  const {
    startDirectCall,
    state: callState,
    activeCall,
    connectionState: callConnectionState,
  } = useCall();
  const isMdUp = useIsMdUp();
  const isMobile = useIsMobile();
  const [messageInput, setMessageInput] = useState('');
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  useChatScrollAnchor(messagesContainerRef, isMobile);
  const typingIndicatorRef = useRef<HTMLDivElement>(null);
  const [typingClearance, setTypingClearance] = useState(0);
  const isLoadingOlderRef = useRef(false);
  const optionsMenuRef = useRef<HTMLDivElement>(null);
  const optionsButtonRef = useRef<HTMLButtonElement>(null);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [selectedReportReason, setSelectedReportReason] = useState<string | null>(null);
  const [reportTargetUserId, setReportTargetUserId] = useState<string | null>(null);
  const [newlyLoadedIds, setNewlyLoadedIds] = useState<Set<string>>(new Set());
  const initialScrollDoneRef = useRef(false);
  const canLoadOlderRef = useRef(false);
  const lastMessageIdRef = useRef<string | null>(null);

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
    currentUserProfile?.imageUrl ||
    null;

  useEffect(() => {
    setReplyTarget(null);
  }, [conversationId]);

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
  const profileLongPress = useLongPress(openProfileActions);

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
  const { isPartnerTyping, sendTyping } = useTyping(conversationId, currentUserId, isGhostMode);

  const lastOwnMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].sender_id === currentUserId) {
        return messages[i].id;
      }
    }
    return null;
  }, [messages, currentUserId]);

  const scrollToBottomInstant = useCallback((element: HTMLElement) => {
    element.scrollTop = element.scrollHeight;
  }, []);

  useEffect(() => {
    initialScrollDoneRef.current = false;
    lastMessageIdRef.current = null;
  }, [conversationId]);

  useEffect(() => {
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
    canLoadOlderRef.current = false;
    const timer = setTimeout(() => {
      canLoadOlderRef.current = true;
    }, 1000);
    return () => clearTimeout(timer);
  }, [conversationId]);

  useLayoutEffect(() => {
    if (loading || messages.length === 0) return;
    const container = messagesContainerRef.current;
    if (!container) return;

    if (!initialScrollDoneRef.current) {
      scrollToBottomInstant(container);
      initialScrollDoneRef.current = true;
      lastMessageIdRef.current = messages[messages.length - 1]?.id ?? null;
      return;
    }

    const lastMessage = messages[messages.length - 1];
    if (lastMessageIdRef.current === lastMessage.id) return;
    lastMessageIdRef.current = lastMessage.id;
    scrollToBottomInstant(container);
  }, [loading, messages, scrollToBottomInstant]);

  useLayoutEffect(() => {
    if (!isPartnerTyping) {
      setTypingClearance(0);
      return;
    }

    const measure = () => {
      const el = typingIndicatorRef.current;
      const height = el?.offsetHeight ?? 40;
      setTypingClearance(height + CHAT_TYPING_CLEARANCE_EXTRA_PX);
    };
    measure();
    requestAnimationFrame(measure);

    let observer: ResizeObserver | undefined;
    const indicator = typingIndicatorRef.current;
    if (indicator) {
      observer = new ResizeObserver(measure);
      observer.observe(indicator);
    }

    return () => observer?.disconnect();
  }, [isPartnerTyping]);

  useLayoutEffect(() => {
    if (!isPartnerTyping || typingClearance <= 0) return;
    const container = messagesContainerRef.current;
    if (!container || !initialScrollDoneRef.current) return;
    scrollToBottomInstant(container);
  }, [isPartnerTyping, typingClearance, scrollToBottomInstant]);

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
    if (!container || loadingMore || !hasMore) return;
    if (container.scrollTop <= 80 && canLoadOlderRef.current) {
      loadOlderAndPreserveScroll();
    }
  }, [loadOlderAndPreserveScroll, loadingMore, hasMore]);

  useEffect(() => {
    if (messageInput.trim().length > 0) {
      void sendTyping(true);
    } else {
      void sendTyping(false);
    }
  }, [messageInput, sendTyping]);

  useEffect(() => {
    if (!showOptionsMenu) return;

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
  }, [showOptionsMenu]);

  const focusMessageInput = useCallback(() => {
    if (!isMdUp) return;
    requestAnimationFrame(() => {
      messageInputRef.current?.focus({ preventScroll: true });
    });
  }, [isMdUp]);

  useLayoutEffect(() => {
    if (!conversationId || !isMdUp) return;
    const id = requestAnimationFrame(() => {
      messageInputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [conversationId, isMdUp]);

  const handleSend = useCallback(async () => {
    const trimmed = messageInput.trim();
    if (!trimmed || sending) return;

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
  }, [messageInput, sending, sendMessage, focusMessageInput, replyTarget]);

  const handleSendUrl = useCallback(
    async (url: string) => {
      if (sending || !url.trim()) return;

      const replyToId = replyTarget?.id ?? null;
      const activeReply = replyTarget;
      setReplyTarget(null);
      const sent = await sendMessage(url.trim(), replyToId);
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
  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-white dark:bg-[#0d0d0d] md:dark:bg-[#0e0e0e]">
      {/* Header */}
      <div 
        className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-[#1f1f1f] bg-white dark:bg-[#0d0d0d] md:dark:bg-[#0e0e0e]"
        style={{ flexShrink: 0 }}
      >
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
              onClick={() => onOpenProfilePreview?.(otherUser.id)}
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
                  {otherUser.is_online ? t('chat.online') : t('chat.offline')}
                </p>
              </div>
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0 min-w-0">
          <button
            type="button"
            onClick={() =>
              void startDirectCall({
                conversationId,
                otherUserId: otherUser.id,
                otherUserName: otherDisplay,
                otherUserAvatar: otherUser.imageUrl,
              })
            }
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
      <ChatEmbeddedCallBar conversationId={conversationId} currentUserId={currentUserId} />

      {/* Messages */}
      <div 
        className={CHAT_MESSAGE_LIST_CLASS}
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        style={{
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          ...(typingClearance > 0 ? { paddingBottom: typingClearance } : {}),
        }}
      >
        {loading && messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
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
          <>
            {loadingMore && (
              <div className="flex items-center justify-center py-2">
                <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
              </div>
            )}
            {messages.map((msg, index) => {
              const isMe = msg.sender_id === currentUserId;
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
              return (
                <motion.div
                  key={msg.id}
                  data-message-id={msg.id}
                  initial={isNewlyLoaded ? { opacity: 0, y: -8 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.25,
                    ease: [0.25, 0.1, 0.25, 1]
                  }}
                  className={getChatMessageRowClass(isGroupStart, isNewSender)}
                >
                  <MessageRowReplyWrapper
                    onReply={() =>
                      setReplyTarget(buildReplyTarget(msg, getSenderLabel(msg.sender_id)))
                    }
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
                        <div className={`flex min-w-0 flex-1 flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                          {isGroupStart && (
                            <MessageGroupHeader
                              name={isMe ? meDisplay : otherDisplay}
                              align={isMe ? 'end' : 'start'}
                            />
                          )}
                          <div
                            className={`group/bubble flex w-fit items-start gap-1.5 ${
                              isMe ? 'flex-row-reverse' : 'flex-row'
                            }`}
                          >
                            <ChatMessageBody
                              content={msg.content}
                              isMe={isMe}
                              isBundled={isBundled}
                              replyQuote={replyQuote}
                              bubblePosition={groupPosition}
                              messageTime={messageTime}
                              isRead={isOutgoingMessageRead(msg, messages, currentUserId)}
                            />
                            <MessageRowReplyButton
                              onReply={() =>
                                setReplyTarget(buildReplyTarget(msg, getSenderLabel(msg.sender_id)))
                              }
                            />
                          </div>
                          {isLastOwnMessage && isGroupEnd && msg.read_at && (
                            <div className="mt-0.5 text-right text-[10px] leading-none text-[#8E8E93]">
                              {t('chat.read')}{' '}
                              {formatMessageTime(msg.read_at, timeLocale, timeLocale === 'en-US')}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </MessageRowReplyWrapper>
                </motion.div>
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      <ChatMessageComposer
        value={messageInput}
        onChange={setMessageInput}
        onSend={handleSend}
        onSendUrl={handleSendUrl}
        placeholder={t('chat.dmMessagePlaceholder')}
        sending={sending}
        inputRef={messageInputRef}
        replyBar={
          replyTarget ? (
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
          className="absolute right-4 top-14 z-40 w-36 rounded-lg border border-gray-200 dark:border-white/5 bg-white dark:bg-[#0A0A0A] md:dark:bg-[#121212] shadow-lg overflow-hidden"
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
                      ? 'border-orange-500 bg-gradient-to-br from-orange-50 via-pink-50 to-red-50 dark:bg-[#0A0A0A] dark:border dark:border-white/5 bg-gradient-to-br from-orange-500 via-red-500 to-pink-500 bg-clip-text text-transparent'
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
                className="flex-1 py-2 rounded-lg bg-gradient-to-br from-purple-500 via-pink-500 to-rose-500 hover:from-purple-600 hover:via-pink-600 hover:to-rose-600 text-white disabled:opacity-50 shadow-lg"
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
          onViewProfile={() => onOpenProfilePreview?.(otherUser.id)}
          onRemoveFriend={handleRemoveFriend}
          onBlockUser={handleBlockFromMenu}
        />
      ) : null}
    </div>
  );
}
