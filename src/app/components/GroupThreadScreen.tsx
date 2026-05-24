import React, { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, Send, Loader2 } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { supabase } from '../lib/supabase';
import { toast } from '../lib/toast';
import { GroupChannelNavContext } from '../context/GroupChannelNavContext';
import { useAppData } from '../context/AppDataContext';
import { getOptimizedImageUrl } from '../lib/images';
import { useIsMdUp } from './ui/use-mobile';
import { useGroupTyping } from '../hooks/useGroupTyping';
import { formatGroupTypingLabel } from '../lib/groupTypingBroadcast';
import { TypingBubble } from './TypingBubble';

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
  const { currentUserProfile } = useAppData();
  const isMdUp = useIsMdUp();
  const ctx = useContext(GroupChannelNavContext);
  const channelId = channelIdProp ?? ctx.channelId;
  const channelName = channelNameProp ?? ctx.channelName ?? '';
  const channelIconUrl = channelIconUrlProp ?? ctx.channelIconUrl ?? null;

  const [messages, setMessages] = useState<GroupMessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const onOpenedRef = useRef(onOpened);
  onOpenedRef.current = onOpened;

  const loadMessages = useCallback(async () => {
    if (!channelId) return;
    const data = await api.getGroupMessages(groupId, channelId);
    setMessages((data?.messages || []) as GroupMessageRow[]);
  }, [groupId, channelId]);

  useEffect(() => {
    if (!channelId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await loadMessages();
        if (!cancelled) {
          localStorage.setItem(`blyve_group_channel_last_read_${channelId}`, new Date().toISOString());
          onOpenedRef.current?.();
        }
      } catch (e: any) {
        if (!cancelled) {
          toast.error(t('groups.loadMessagesFailedTitle'), e?.message || t('groups.loadMessagesFailedBody'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId, channelId, loadMessages, t]);

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
          localStorage.setItem(`blyve_group_channel_last_read_${channelId}`, new Date().toISOString());
          onOpenedRef.current?.();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, loading]);

  useLayoutEffect(() => {
    if (!channelId || !isMdUp) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [channelId, isMdUp]);

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

  const meDisplay = currentUserProfile?.display_name || currentUserProfile?.name || 'Du';
  const meHandle = currentUserProfile?.username as string | undefined;
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

  useEffect(() => {
    if (!channelId) return;
    if (input.trim().length > 0) {
      void sendTyping(true);
    } else {
      void sendTyping(false);
    }
  }, [channelId, input, sendTyping]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending || !channelId) return;
    try {
      setSending(true);
      void sendTyping(false);
      const data = await api.sendGroupMessage(groupId, text, channelId);
      setInput('');
      if (data?.message) {
        setMessages((prev) => [...prev, data.message as GroupMessageRow]);
      } else {
        await loadMessages();
      }
    } catch (e: any) {
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
      <div className="bg-white dark:bg-black md:dark:bg-[#121212] flex flex-col h-full w-full items-center justify-center p-6">
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
    <div className="relative flex h-full min-h-0 w-full flex-col bg-white pb-16 dark:bg-black md:pb-0 md:dark:bg-[#121212]">
      {/* Header — aligned with ChatScreen */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-black md:dark:bg-[#121212] shrink-0"
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

      {/* Messages — same spacing / bubble style as ChatScreen */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-4 bg-white dark:bg-black md:dark:bg-[#121212] min-h-0"
        style={{
          WebkitOverflowScrolling: 'touch',
          paddingBottom: '12px',
        }}
      >
        {loading ? (
          <div className="flex items-center justify-center h-full min-h-[200px]">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full min-h-[200px]">
            <p className="text-gray-500 dark:text-gray-400 text-center px-4">{t('groups.noMessagesYet')}</p>
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === currentUserId;
            const otherDisplay = m.sender?.display_name || m.sender?.username || t('groups.unknownSender');
            const otherHandle = m.sender?.username;
            const avatarUrl = m.sender?.avatar_url
              ? getOptimizedImageUrl(m.sender.avatar_url, 80)
              : null;
            return (
              <div
                key={m.id}
                style={{
                  width: '100%',
                  margin: '4px 0',
                  padding: '0 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: mine ? 'flex-end' : 'flex-start',
                }}
              >
                {!mine && (
                  <div
                    className="max-w-[70%] text-[11px] text-gray-600 dark:text-gray-400 mb-0.5 px-1"
                    style={{ alignSelf: 'flex-start' }}
                  >
                    <strong className="text-gray-800 dark:text-gray-200 font-semibold">{otherDisplay}</strong>
                    {otherHandle ? (
                      <span className="text-gray-500 dark:text-gray-500"> @{otherHandle}</span>
                    ) : null}
                  </div>
                )}
                {mine && (
                  <div
                    className="max-w-[70%] text-[11px] text-gray-600 dark:text-gray-400 mb-0.5 px-1"
                    style={{ alignSelf: 'flex-end', textAlign: 'right' }}
                  >
                    <strong className="text-gray-800 dark:text-gray-200 font-semibold">{meDisplay}</strong>
                    {meHandle ? (
                      <span className="text-gray-500 dark:text-gray-500"> @{meHandle}</span>
                    ) : null}
                  </div>
                )}
                <div
                  className={`max-w-[70%] flex gap-2 ${mine ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  {!mine && (
                    <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-600 dark:text-gray-300">
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        otherDisplay.charAt(0).toUpperCase()
                      )}
                    </div>
                  )}
                  <div
                    className={`min-w-0 px-4 py-2 rounded-2xl ${
                      mine
                        ? 'bg-gradient-to-br from-orange-500 via-red-500 to-pink-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white'
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap break-words">{m.content}</p>
                    <p
                      className={`text-xs mt-1 ${mine ? 'text-white/70' : 'text-gray-500 dark:text-gray-400'}`}
                    >
                      {new Date(m.created_at).toLocaleTimeString(timeLocale, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input — aligned with ChatScreen */}
      <div className="relative z-20 shrink-0 border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-black md:dark:bg-[#121212]">
        <AnimatePresence>
          {typers.length > 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="absolute bottom-full left-4 z-30 mb-2 flex flex-col items-start gap-1"
            >
              <TypingBubble inline />
              {typingLabel ? (
                <p className="max-w-[min(100vw-2rem,320px)] truncate px-1 text-xs italic text-[#5865f2]">
                  {typingLabel}
                </p>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
        <div className="flex w-full items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder={t('groups.messagePlaceholder')}
            className="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-full text-gray-900 dark:text-white focus:outline-none"
            style={{
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
              fontSize: '16px',
            }}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void handleSend()}
            disabled={sending || !input.trim()}
            className="p-3 bg-gradient-to-br from-orange-500 via-red-500 to-pink-500 rounded-full disabled:opacity-50 flex items-center justify-center"
            style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
          >
            {sending ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <Send className="w-5 h-5 text-white" />}
          </button>
        </div>
      </div>
    </div>
  );
}
