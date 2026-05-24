import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { ArrowLeft, Send, Loader2, MoreVertical, Ban, CheckCheck, Phone, X } from 'lucide-react';
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
import { useIsMdUp } from './ui/use-mobile';
import { useCall } from '../context/CallContext';
import { ChatCallPanel } from './ChatCallPanel';
import { NotificationManager } from '../lib/notifications';

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
  onOpenProfilePreview?: (userId: string) => void; // ✅ NEU: Callback nach oben
}

export function ChatScreen({
  onBack, 
  conversationId,
  otherUser,
  currentUserId,
  onOpenProfilePreview,
}: ChatScreenProps) {
  const { t, i18n } = useTranslation();
  const { messages, loading, loadingMore, hasMore, sending, error, sendMessage, markAsRead, loadOlderMessages } = useChat(conversationId);
  const { currentUserProfile } = useAppData();
  const {
    startDirectCall,
    state: callState,
    activeCall,
    connectionState: callConnectionState,
  } = useCall();
  const isMdUp = useIsMdUp();
  
  const [messageInput, setMessageInput] = useState('');
  const messageInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const isLoadingOlderRef = useRef(false);
  const optionsMenuRef = useRef<HTMLDivElement>(null);
  const optionsButtonRef = useRef<HTMLButtonElement>(null);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [selectedReportReason, setSelectedReportReason] = useState<string | null>(null);
  const [reportTargetUserId, setReportTargetUserId] = useState<string | null>(null);
  const [isTransitionDone, setIsTransitionDone] = useState(false);
  const [newlyLoadedIds, setNewlyLoadedIds] = useState<Set<string>>(new Set());
  const initialScrollDoneRef = useRef(false);
  const canLoadOlderRef = useRef(false);
  const lastMessageIdRef = useRef<string | null>(null);
  const lastReadReceiptIdRef = useRef<string | null>(null);
  const lastTypingStateRef = useRef<boolean>(false);

  const isGhostMode = !!currentUserProfile?.ghost_mode;

  const otherDisplay =
    otherUser.display_name?.trim() || otherUser.name || '';
  const meDisplay =
    currentUserProfile?.display_name?.trim() ||
    currentUserProfile?.name ||
    'Du';
  const { isPartnerTyping, sendTyping } = useTyping(conversationId, currentUserId, isGhostMode);
  const lastOwnMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].sender_id === currentUserId) {
        return messages[i].id;
      }
    }
    return null;
  }, [messages, currentUserId]);

  const smoothScrollToBottom = useCallback((element: HTMLElement, duration = 400) => {
    const start = element.scrollTop;
    const end = element.scrollHeight - element.clientHeight;
    const distance = end - start;
    if (distance === 0) return;
    const startTime = performance.now();

    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    const animateScroll = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);
      element.scrollTop = start + distance * eased;
      if (progress < 1) {
        requestAnimationFrame(animateScroll);
      }
    };

    requestAnimationFrame(animateScroll);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setIsTransitionDone(true), 350);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    initialScrollDoneRef.current = false;
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

  useEffect(() => {
    if (!isTransitionDone || messages.length === 0 || initialScrollDoneRef.current) return;
    const scrollTimeout = setTimeout(() => {
      const container = messagesContainerRef.current;
      if (!container) return;
      smoothScrollToBottom(container, 350);
      initialScrollDoneRef.current = true;
    }, 100);
    return () => clearTimeout(scrollTimeout);
  }, [isTransitionDone, messages, smoothScrollToBottom]);

  useEffect(() => {
    if (!initialScrollDoneRef.current || messages.length === 0) return;
    const lastMessage = messages[messages.length - 1];
    if (lastMessageIdRef.current === lastMessage.id) return;
    lastMessageIdRef.current = lastMessage.id;
    const container = messagesContainerRef.current;
    if (!container) return;
    smoothScrollToBottom(container, 300);
  }, [messages, currentUserId, smoothScrollToBottom]);

  useEffect(() => {
    if (!initialScrollDoneRef.current || messages.length === 0) return;
    const lastOwnReadMessage = [...messages].reverse().find(
      (msg) => msg.sender_id === currentUserId && !!msg.read_at
    );
    if (!lastOwnReadMessage) return;
    if (lastReadReceiptIdRef.current === lastOwnReadMessage.id) return;
    lastReadReceiptIdRef.current = lastOwnReadMessage.id;
    const container = messagesContainerRef.current;
    if (!container) return;
    smoothScrollToBottom(container, 250);
  }, [messages, currentUserId, smoothScrollToBottom]);

  useEffect(() => {
    if (!initialScrollDoneRef.current) return;
    if (lastTypingStateRef.current === isPartnerTyping) return;
    lastTypingStateRef.current = isPartnerTyping;
    if (!isPartnerTyping) return;
    const container = messagesContainerRef.current;
    if (!container) return;
    smoothScrollToBottom(container, 200);
  }, [isPartnerTyping, smoothScrollToBottom]);

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
    if (messages.length > 0) {
      markAsRead();
    }
  }, [messages, markAsRead]);

  useEffect(() => {
    if (conversationId) {
      markAsRead();
    }
  }, [conversationId, markAsRead]);

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

    setMessageInput('');
    const sent = await sendMessage(trimmed);
    if (!sent) {
      setMessageInput((prev) => (prev === '' ? trimmed : prev));
    }
    focusMessageInput();
  }, [messageInput, sending, sendMessage, focusMessageInput]);

  const handleReportUser = () => {
    setReportTargetUserId(otherUser.id);
    setShowOptionsMenu(false);
    setShowReportModal(true);
  };

  const submitReport = async () => {
    if (!selectedReportReason || !reportTargetUserId) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { error } = await supabase
        .from('reports')
        .insert({
          reporter_id: user.id,
          reported_id: reportTargetUserId,
          reason: selectedReportReason,
        });

      if (error) throw error;
      toast.success('Danke, wir prüfen das.');
    } catch (error: any) {
      console.error('Failed to report user:', error);
      toast.error('Fehler beim Melden', error.message || 'Failed to report user.');
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
      toast.success('Nutzer wurde blockiert und alle Nachrichten gelöscht.');
      setShowBlockModal(false);
      onBack();
    } catch (error: any) {
      console.error('Failed to block user:', error);
      toast.error('Fehler beim Blockieren', error.message || 'Failed to block user.');
    }
  };

  const isThisChatBusyForMe =
    (callState === 'calling' || (callState === 'in_call' && callConnectionState === 'connected')) &&
    activeCall?.conversationId === conversationId;
  const isCallButtonDisabled = isThisChatBusyForMe;
  return (
    <div className="relative flex h-full min-h-0 w-full flex-col bg-white pb-16 dark:bg-black md:pb-0 md:dark:bg-[#121212]">
      {/* Header */}
      <div 
        className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-black md:dark:bg-[#121212]"
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
                {otherUser.is_online ? 'Online' : 'Offline'}
              </p>
            </div>
          </button>
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
      <ChatCallPanel conversationId={conversationId} currentUserId={currentUserId} />

      {/* Messages */}
      <div 
        className="flex-1 overflow-y-auto px-4 py-4 bg-white dark:bg-black md:dark:bg-[#121212]"
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        style={{
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: '12px',
        }}
      >
        {loading && messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-red-500 dark:text-red-400">{error}</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500 dark:text-gray-400">Noch keine Nachrichten. Sag Hallo! 👋</p>
          </div>
        ) : (
          <>
            {loadingMore && (
              <div className="flex items-center justify-center py-2">
                <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
              </div>
            )}
            {messages.map((msg) => {
              const isMe = msg.sender_id === currentUserId;
              const isLastOwnMessage = isMe && msg.id === lastOwnMessageId;
              const isNewlyLoaded = newlyLoadedIds.has(msg.id);
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
                  style={{
                    width: '100%',
                    margin: '4px 0',
                    padding: '0 12px',
                    alignItems: isMe ? 'flex-end' : 'flex-start',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {!isMe && (
                    <div
                      className="max-w-[70%] text-[11px] text-gray-600 dark:text-gray-400 mb-0.5 px-1"
                      style={{ alignSelf: 'flex-start' }}
                    >
                      <strong className="text-gray-800 dark:text-gray-200 font-semibold">{otherDisplay}</strong>
                    </div>
                  )}
                  {isMe && (
                    <div
                      className="max-w-[70%] text-[11px] text-gray-600 dark:text-gray-400 mb-0.5 px-1"
                      style={{ alignSelf: 'flex-end', textAlign: 'right' }}
                    >
                      <strong className="text-gray-800 dark:text-gray-200 font-semibold">{meDisplay}</strong>
                    </div>
                  )}
                  <div
                    className={`max-w-[70%] px-4 py-2 rounded-2xl ${
                      isMe
                        ? 'bg-gradient-to-br from-orange-500 via-red-500 to-pink-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                    <p className={`text-xs mt-1 flex items-center gap-1 ${isMe ? 'text-white/70' : 'text-gray-500 dark:text-gray-400'}`}>
                      {new Date(msg.created_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                      {isMe && (
                        msg.read_at || msg.is_read ? (
                          <CheckCheck className="w-3.5 h-3.5 text-blue-500" />
                        ) : (
                          <CheckCheck className="w-3.5 h-3.5 text-gray-400" />
                        )
                      )}
                    </p>
                  </div>
                  {isLastOwnMessage && msg.read_at && (
                    <div
                      style={{
                        fontSize: 10,
                        color: '#8E8E93',
                        marginTop: 4,
                        marginRight: 2,
                        textAlign: 'right',
                      }}
                    >
                      {t('chat.read')} {(() => {
                        const lang = i18n.language || 'de';
                        const isEnglish = lang.startsWith('en');
                        const locale = isEnglish ? 'en-US' : (lang.startsWith('es') ? 'es-ES' : 'de-DE');
                        return new Date(msg.read_at).toLocaleTimeString(locale, {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: isEnglish
                        });
                      })()}
                    </div>
                  )}
                </motion.div>
              );
            })}
            <div ref={messagesEndRef} style={{ scrollMarginBottom: '12px' }} />
          </>
        )}
      </div>

      {/* Input */}
      <div className="relative z-20 shrink-0 border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-black md:dark:bg-[#121212]">
        <AnimatePresence>
          {isPartnerTyping && <TypingBubble />}
        </AnimatePresence>
        <div className="flex w-full items-center gap-2">
          <input
            ref={messageInputRef}
            type="text"
            value={messageInput}
            onChange={(e) => {
              setMessageInput(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Nachricht schreiben..."
            className="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-full text-gray-900 dark:text-white focus:outline-none"
            style={{
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
              fontSize: '16px'
            }}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void handleSend()}
            disabled={!messageInput.trim() || sending}
            className="p-3 bg-gradient-to-br from-orange-500 via-red-500 to-pink-500 rounded-full disabled:opacity-50 flex items-center justify-center"
            style={{
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
              cursor: 'pointer'
            }}
          >
            {sending ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <Send className="w-5 h-5 text-white" />}
          </button>
        </div>
      </div>
      {showOptionsMenu && (
        <div
          ref={optionsMenuRef}
          className="absolute right-4 top-14 z-40 w-36 rounded-lg border border-gray-200 dark:border-white/5 bg-white dark:bg-[#0A0A0A] md:dark:bg-[#121212] shadow-lg overflow-hidden"
        >
          <button
            onClick={handleReportUser}
            className="w-full px-3 py-2 text-left text-xs text-gray-900 dark:text-white md:dark:text-white hover:bg-gray-50 dark:hover:bg-white/5"
          >
            Profil melden
          </button>
          <button
            onClick={handleBlockUser}
            className="w-full px-3 py-2 text-left text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10"
          >
            Profil blockieren
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
              Nutzer melden
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
                  {reason.label}
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
                Abbrechen
              </button>
              <button
                onClick={submitReport}
                disabled={!selectedReportReason}
                className="flex-1 py-2 rounded-lg bg-gradient-to-br from-purple-500 via-pink-500 to-rose-500 hover:from-purple-600 hover:via-pink-600 hover:to-rose-600 text-white disabled:opacity-50 shadow-lg"
              >
                Melden
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
                Nutzer blockieren?
              </h3>

              <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">
                Möchtest du diesen Nutzer wirklich blockieren? Alle Nachrichten und Chats werden gelöscht.
              </p>

              <div className="flex gap-3 w-full mt-2">
                <button
                  onClick={() => setShowBlockModal(false)}
                  className="flex-1 py-3 px-4 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-semibold text-sm"
                >
                  Abbrechen
                </button>

                <button
                  onClick={confirmBlockUser}
                  className="flex-1 py-3 px-4 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold text-sm shadow-lg shadow-red-500/30"
                >
                  Blockieren
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
