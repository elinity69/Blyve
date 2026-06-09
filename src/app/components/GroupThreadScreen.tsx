import React, { useContext, useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import {
  fetchGroupChannelMessages,
  groupMessagesQueryKey,
} from '../lib/chatMessages';
import { GroupChannelNavContext } from '../context/GroupChannelNavContext';
import { useAppData } from '../context/AppDataContext';
import { useCall } from '../context/CallStateContext';
import { useIsMdUp, useIsMobile } from './ui/use-mobile';
import { useChatScrollAnchor } from '../hooks/useChatScrollAnchor';
import { getOptimizedImageUrl } from '../lib/images';
import { useGroupTyping } from '../hooks/useGroupTyping';
import { formatGroupTypingLabel } from '../lib/groupTypingBroadcast';
import { TypingBubble } from './TypingBubble';
import { NotificationManager } from '../lib/notifications';
import { MessageReplyComposerBar } from './chat/MessageReplyComposerBar';
import { ChatMessageComposer } from './chat/ChatMessageComposer';
import { scrollContainerToBottomStable } from '../lib/chatScroll';
import { ScrollToBottomButton, useScrollToBottom } from './chat/ScrollToBottomButton';
import { useChatMediaSend } from '../hooks/useChatMediaSend';
import { MessageWithReactions } from './chat/MessageWithReactions';
import {
  buildReplyTarget,
  resolveReplyQuote,
  type ReplyTarget,
} from '../lib/messageReply';
import {
  CHAT_MESSAGE_LIST_CLASS,
  CHAT_MESSAGE_ROW_INNER_CLASS,
  CHAT_MESSAGE_ROW_INNER_GROUPED_CLASS,
  getChatMessageRowClass,
  measureTypingIndicatorClearance,
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
import { ChatEmbeddedCallBar } from './ChatEmbeddedCallBar';

function groupAccentHue(groupId: string): number {
  let h = 0;
  for (let i = 0; i < groupId.length; i += 1) h += groupId.charCodeAt(i);
  return 200 + (h % 140);
}

export interface GroupMessageRow {
  id: string;
  group_id: string;
  channel_id?: string;
  sender_id: string;
  content: string;
  created_at: string;
  updated_at?: string;
  reply_to_message_id?: string | null;
  sender?: {
    id: string;
    username?: string | null;
    display_name?: string | null;
    avatar_url?: string | null;
  };
}

interface GroupThreadScreenProps {
  groupId: string;
  groupName: string;
  /** When set (e.g. desktop), used directly. On mobile overlay, omitted — values come from GroupChannelNavContext. */
  channelId?: string | null;
  channelName?: string | null;
  channelIconUrl?: string | null;
  currentUserId: string;
  onBack: () => void;
  onLeave?: () => Promise<void>;
  /** Called when the thread is opened so the parent can refresh unread badges. */
  onOpened?: () => void;
}

export function GroupThreadScreen({
  groupId,
  groupName,
  channelId: channelIdProp,
  channelName: channelNameProp,
  channelIconUrl: channelIconUrlProp,
  currentUserId,
  onBack,
  onLeave,
  onOpened,
}: GroupThreadScreenProps) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { currentUserProfile } = useAppData();
  const { activeCall, state: callState } = useCall();
  const isMdUp = useIsMdUp();
  const ctx = useContext(GroupChannelNavContext);
  const channelId = channelIdProp ?? ctx.channelId;
  const channelName = channelNameProp ?? ctx.channelName ?? '';
  const channelIconUrl = channelIconUrlProp ?? ctx.channelIconUrl ?? null;

  const [messages, setMessages] = useState<GroupMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState('');
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingIndicatorRef = useRef<HTMLDivElement>(null);
  const [typingClearance, setTypingClearance] = useState(0);
  const { show: showScrollToBottom, handleScroll: scrollToBottomHandleScroll, scrollToBottom } = useScrollToBottom(scrollRef);
  const onOpenedRef = useRef(onOpened);
  onOpenedRef.current = onOpened;
  const prevChannelIdRef = useRef<string | null>(null);
  const loadErrorToastRef = useRef<string | null>(null);

  const {
    data: fetchedMessages,
    isPending,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: groupMessagesQueryKey(groupId, channelId ?? ''),
    enabled: !!channelId,
    queryFn: () => fetchGroupChannelMessages(groupId, channelId!) as Promise<GroupMessageRow[]>,
    initialData: () => {
      if (!channelId) return undefined;
      return queryClient.getQueryData<GroupMessageRow[]>(
        groupMessagesQueryKey(groupId, channelId)
      );
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  useEffect(() => {
    if (!channelId) {
      prevChannelIdRef.current = null;
      setMessages([]);
      setLoading(false);
      return;
    }

    const channelChanged = prevChannelIdRef.current !== channelId;
    if (channelChanged) {
      prevChannelIdRef.current = channelId;
      setMessages([]);
    }

    if (isPending) {
      setLoading(true);
      return;
    }

    setLoading(false);

    if (queryError) {
      const errorKey = `${channelId}:${(queryError as Error).message}`;
      if (loadErrorToastRef.current !== errorKey) {
        loadErrorToastRef.current = errorKey;
        toast.error(
          t('groups.loadMessagesFailedTitle'),
          (queryError as Error).message || t('groups.loadMessagesFailedBody')
        );
      }
      return;
    }

    loadErrorToastRef.current = null;

    if (fetchedMessages) {
      setMessages(fetchedMessages);
      void api.markGroupChannelRead(channelId).then(() => {
        onOpenedRef.current?.();
      });
    }
  }, [channelId, fetchedMessages, isPending, queryError, t]);

  useEffect(() => {
    if (!channelId) return;
    NotificationManager.setActiveGroupChannelId(channelId);
    return () => {
      NotificationManager.setActiveGroupChannelId(null);
    };
  }, [channelId]);

  useEffect(() => {
    if (!channelId) return;
    const channel = supabase
      .channel(`group-messages-${channelId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'group_messages',
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          const row = payload.new as GroupMessageRow;
          setMessages((prev) => {
            if (prev.some((message) => message.id === row.id)) return prev;
            return [...prev, row];
          });
          void api.markGroupChannelRead(channelId).then(() => {
            onOpenedRef.current?.();
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelId]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || loading) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  const isMobile = useIsMobile();
  const assignScrollContainer = useChatScrollAnchor(scrollRef, isMobile, messagesEndRef);

  useLayoutEffect(() => {
    if (!channelId || !isMdUp) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [channelId, isMdUp]);

  const meDisplay = currentUserProfile?.display_name || currentUserProfile?.name || t('chat.you');
  const meAvatarUrl =
    currentUserProfile?.avatar_url ||
    currentUserProfile?.images?.[0] ||
    null;

  const getSenderLabel = useCallback(
    (senderId: string, message?: GroupMessageRow) => {
      if (senderId === currentUserId) return meDisplay;
      return (
        message?.sender?.display_name ||
        message?.sender?.username ||
        t('groups.unknownSender')
      );
    },
    [currentUserId, meDisplay, t]
  );

  useEffect(() => {
    setReplyTarget(null);
  }, [channelId]);
  const isGhostMode = !!currentUserProfile?.ghost_mode;
  const { typers, sendTyping } = useGroupTyping(
    groupId,
    channelId,
    currentUserId,
    meDisplay,
    isGhostMode
  );
  const typingLabel = formatGroupTypingLabel(
    typers.map((typer) => typer.displayName),
    t
  );

  useLayoutEffect(() => {
    const indicator = typingIndicatorRef.current;
    const isTyping = typers.length > 0;

    if (!isTyping) {
      setTypingClearance(0);
      return;
    }

    const measure = () => {
      const el = typingIndicatorRef.current;
      if (!el) return;
      setTypingClearance(measureTypingIndicatorClearance(el));
    };
    measure();
    requestAnimationFrame(() => {
      measure();
      requestAnimationFrame(measure);
    });

    let observer: ResizeObserver | undefined;
    if (indicator) {
      observer = new ResizeObserver(measure);
      observer.observe(indicator);
    }

    return () => observer?.disconnect();
  }, [typers.length, typingLabel]);

  useLayoutEffect(() => {
    if (typers.length === 0 || typingClearance <= 0) return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => scrollContainerToBottomStable(el));
  }, [typers.length, typingClearance]);

  const handleLeave = async () => {
    try {
      await api.leaveGroup(groupId);
      toast.success(t('groups.leftGroup'));
      await onLeave?.();
      onBack();
    } catch (e: any) {
      toast.error(t('groups.leaveFailedTitle'), e?.message || t('groups.leaveFailedBody'));
    }
  };

  useEffect(() => {
    if (!channelId) return;
    if (input.trim().length > 0) {
      void sendTyping(true);
    } else {
      void sendTyping(false);
    }
  }, [channelId, input, sendTyping]);

  const sendWithAttachments = useCallback(
    async (content: string, attachmentIds: string[], replyToMessageId: string | null) => {
      if (!channelId) return false;
      try {
        setSending(true);
        void sendTyping(false);
        const data = await api.sendGroupMessage(
          groupId,
          content,
          channelId,
          replyToMessageId,
          attachmentIds,
        );
        if (data?.message) {
          setMessages((prev) => [...prev, data.message as GroupMessageRow]);
        } else {
          await refetch();
        }
        return true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(t('groups.sendFailedTitle'), msg || t('groups.sendFailedBody'));
        return false;
      } finally {
        setSending(false);
      }
    },
    [channelId, groupId, refetch, sendTyping, t],
  );

  const {
    sendFiles: sendMediaFiles,
    sendVoiceMemo,
    uploading: mediaUploading,
    uploadLabel: mediaUploadLabel,
  } = useChatMediaSend(
    channelId ? { type: 'group', groupId, channelId } : null,
    sendWithAttachments,
  );

  const handleSendFiles = useCallback(
    async (files: File[], caption?: string) => {
      const replyToId = replyTarget?.id ?? null;
      const activeReply = replyTarget;
      setReplyTarget(null);
      const ok = await sendMediaFiles(files, { caption, replyToMessageId: replyToId });
      if (!ok && activeReply) setReplyTarget(activeReply);
    },
    [replyTarget, sendMediaFiles],
  );

  const handleSendVoiceMemo = useCallback(
    async (blob: Blob) => {
      const replyToId = replyTarget?.id ?? null;
      const activeReply = replyTarget;
      setReplyTarget(null);
      const ok = await sendVoiceMemo(blob, replyToId);
      if (!ok && activeReply) setReplyTarget(activeReply);
    },
    [replyTarget, sendVoiceMemo],
  );

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending || mediaUploading || !channelId) return;
    const activeReply = replyTarget;
    const replyToId = activeReply?.id ?? null;
    try {
      setSending(true);
      void sendTyping(false);
      const data = await api.sendGroupMessage(groupId, text, channelId, replyToId);
      setInput('');
      setReplyTarget(null);
      if (data?.message) {
        setMessages((prev) => [...prev, data.message as GroupMessageRow]);
      } else {
        await refetch();
      }
    } catch (e: any) {
      if (activeReply) setReplyTarget(activeReply);
      toast.error(t('groups.sendFailedTitle'), e?.message || t('groups.sendFailedBody'));
    } finally {
      setSending(false);
      if (isMdUp) {
        requestAnimationFrame(() => {
          inputRef.current?.focus({ preventScroll: true });
        });
      }
    }
  };

  const handleSendUrl = async (url: string) => {
    const text = url.trim();
    if (!text || sending || !channelId) return;
    const activeReply = replyTarget;
    const replyToId = activeReply?.id ?? null;
    try {
      setSending(true);
      void sendTyping(false);
      const { normalizeGifUrlForMessage } = await import('../lib/embedMediaResolver');
      const content = await normalizeGifUrlForMessage(text);
      const data = await api.sendGroupMessage(groupId, content, channelId, replyToId);
      setReplyTarget(null);
      if (data?.message) {
        setMessages((prev) => [...prev, data.message as GroupMessageRow]);
      } else {
        await refetch();
      }
    } catch (e: any) {
      if (activeReply) setReplyTarget(activeReply);
      toast.error(t('groups.sendFailedTitle'), e?.message || t('groups.sendFailedBody'));
    } finally {
      setSending(false);
      if (isMdUp) {
        requestAnimationFrame(() => {
          inputRef.current?.focus({ preventScroll: true });
        });
      }
    }
  };

  if (!channelId) {
    return (
      <div className="blyve-app-bg flex flex-col h-full w-full items-center justify-center p-6">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400 mb-2" />
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center">{t('groups.loadingChannels')}</p>
      </div>
    );
  }

  const channelLabel = channelName ? `#${channelName}` : `#${t('groups.channelGeneral')}`;
  const hue = groupAccentHue(groupId);
  const groupInitial = (groupName?.trim().charAt(0) || '?').toUpperCase();
  const channelIconSrc = channelIconUrl ? getOptimizedImageUrl(channelIconUrl, 120) : null;

  const timeLocale = i18n.language?.startsWith('de')
    ? 'de-DE'
    : i18n.language?.startsWith('es')
      ? 'es-ES'
      : 'en-US';

  return (
    <div className="relative flex h-full min-h-0 w-full max-w-full flex-col overflow-hidden blyve-screen-bg">
      {/* Header — aligned with ChatScreen */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-gray-200 blyve-border-subtle blyve-screen-bg shrink-0"
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full shrink-0"
            style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
          >
            <ArrowLeft className="w-6 h-6 text-gray-900 dark:text-white" />
          </button>
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0 overflow-hidden"
            style={
              channelIconSrc
                ? undefined
                : { background: `linear-gradient(145deg, hsl(${hue}, 42%, 42%), hsl(${hue}, 45%, 32%))` }
            }
            aria-hidden
          >
            {channelIconSrc ? (
              <img src={channelIconSrc} alt="" className="w-full h-full object-cover" />
            ) : (
              groupInitial
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white truncate">{groupName}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{channelLabel}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleLeave}
          className="text-xs font-medium text-red-600 dark:text-red-400 px-3 py-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 shrink-0"
          style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
        >
          {t('groups.leave')}
        </button>
      </div>


      <ChatEmbeddedCallBar
        currentUserId={currentUserId}
        voiceGroupId={
          activeCall?.isVoiceChannel && activeCall.groupId === groupId ? groupId : undefined
        }
      />

      {/* Messages — same spacing / bubble style as ChatScreen */}
      <div
        data-chat-messages-scroll
        ref={assignScrollContainer}
        className={`${CHAT_MESSAGE_LIST_CLASS} ${dropActive ? 'ring-2 ring-inset ring-blyve/40' : ''}`}
        onScroll={scrollToBottomHandleScroll}
        onDragOver={(e) => {
          e.preventDefault();
          setDropActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          if (e.currentTarget === e.target) setDropActive(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDropActive(false);
          if (e.dataTransfer.files?.length) {
            void handleSendFiles(Array.from(e.dataTransfer.files));
          }
        }}
        style={{
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
          overscrollBehavior: 'contain',
          overscrollBehaviorX: 'hidden',
          overscrollBehaviorY: 'contain',
          ...(typingClearance > 0 ? { paddingBottom: typingClearance } : {}),
        }}
      >
        {loading ? (
          <div className="flex h-full min-h-[200px] items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full min-h-[200px] items-center justify-center">
            <p className="text-gray-500 dark:text-gray-400 text-center px-4">{t('groups.noMessagesYet')}</p>
          </div>
        ) : (
          messages.map((m, index) => {
            const mine = m.sender_id === currentUserId;
            const prev = index > 0 ? messages[index - 1] : null;
            const next = index < messages.length - 1 ? messages[index + 1] : null;
            const isGroupStart = isMessageGroupStart(m, prev);
            const isNewSender = isNewSenderGroupStart(m, prev);
            const isGroupEnd = isMessageGroupEnd(m, next);
            const isBundled = isMessageBundled(m, prev, next);
            const groupPosition = getMessageGroupPosition(m, prev, next);
            const otherDisplay = m.sender?.display_name || m.sender?.username || t('groups.unknownSender');
            const senderLabel = mine ? meDisplay : otherDisplay;
            const messageTime = formatMessageTime(
              m.created_at,
              timeLocale,
              timeLocale.startsWith('en')
            );
            const replyQuote = resolveReplyQuote(
              m.reply_to_message_id,
              messages,
              (senderId, parent) => getSenderLabel(senderId, parent),
              t('chat.originalMessageUnavailable')
            );
            return (
              <div
                key={m.id}
                data-message-id={m.id}
                className={getChatMessageRowClass(isGroupStart, isNewSender)}
              >
                <div className={`flex w-full flex-col ${mine ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`${
                      isBundled ? CHAT_MESSAGE_ROW_INNER_GROUPED_CLASS : CHAT_MESSAGE_ROW_INNER_CLASS
                    } ${mine ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    <MessageRowAvatarSlot
                      visible={isGroupEnd}
                      imageUrl={mine ? meAvatarUrl : m.sender?.avatar_url}
                      label={senderLabel}
                    />
                    <div className={`min-w-0 flex-1 flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
                      {isGroupStart && (
                        <MessageGroupHeader
                          name={senderLabel}
                          align={mine ? 'end' : 'start'}
                        />
                      )}
                      <div className="w-full min-w-0">
                        <MessageWithReactions
                          messageId={m.id}
                          isMe={mine}
                          canDelete={false}
                          isReplyTarget={replyTarget?.id === m.id}
                          onReply={() =>
                            setReplyTarget(buildReplyTarget(m, getSenderLabel(m.sender_id, m)))
                          }
                          onDelete={() => { /* group message delete not yet wired */ }}
                          content={m.content}
                          isBundled={isBundled}
                          replyQuote={replyQuote}
                          bubblePosition={groupPosition}
                          messageTime={messageTime}
                          isRead={false}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} aria-hidden className="h-px w-full shrink-0" />
      </div>

      <ScrollToBottomButton show={showScrollToBottom} onClick={scrollToBottom} />

      <ChatMessageComposer
        value={input}
        onChange={setInput}
        onSend={handleSend}
        onSendUrl={handleSendUrl}
        onSendFiles={handleSendFiles}
        onSendVoiceMemo={handleSendVoiceMemo}
        placeholder={t('groups.messagePlaceholder')}
        sending={sending}
        mediaUploading={mediaUploading}
        mediaUploadLabel={mediaUploadLabel}
        dropActive={dropActive}
        onDropActiveChange={setDropActive}
        inputRef={inputRef}
        replyBar={
          replyTarget ? (
            <MessageReplyComposerBar target={replyTarget} onCancel={() => setReplyTarget(null)} />
          ) : null
        }
        typingIndicator={
          <AnimatePresence>
            {typers.length > 0 ? (
              <motion.div
                ref={typingIndicatorRef}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="absolute bottom-full left-4 z-30 mb-2 flex flex-col items-start gap-1"
              >
                <TypingBubble inline />
                {typingLabel ? (
                  <p className="max-w-[min(100vw-2rem,320px)] truncate px-1 text-xs italic text-blyve">
                    {typingLabel}
                  </p>
                ) : null}
              </motion.div>
            ) : null}
          </AnimatePresence>
        }
      />
    </div>
  );
}
