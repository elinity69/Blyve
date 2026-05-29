import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { getCachedUser, resolveAuthUser, subscribeAuth } from '../lib/authSession';
import { api } from '../lib/api';
import { useAppData } from '../context/AppDataContext';
import { RealtimeChannel } from '@supabase/supabase-js';
import {
  dispatchConversationPreviewUpdate,
  dispatchConversationUnreadCleared,
  dispatchUnreadRefreshRequest,
} from '../lib/messageEvents';
import { NotificationManager } from '../lib/notifications';
import { getUnreadBatchKey, isMessageReadReceiptUpdate } from '../lib/messageReadReceipts';
import {
  applyReadStateToDmMessages,
  DM_MESSAGES_PAGE_SIZE,
  dmMessagesQueryKey,
  fetchDmMessages,
  mergeDmMessagesById,
} from '../lib/chatMessages';

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  is_read: boolean;
  read_at: string | null;
  reply_to_message_id?: string | null;
}

export interface Conversation {
  id: string;
  user1_id: string;
  user2_id: string;
  created_at: string;
  updated_at: string;
  last_message: string | null;
  last_message_at: string | null;
  other_user: {
    id: string;
    name: string;
    display_name?: string;
    username?: string;
    imageUrl?: string;
    is_online?: boolean;
    age?: number;
  };
  has_messages: boolean;
}

function isAbortError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err ?? '');
  return msg.includes('AbortError') || msg.includes('aborted');
}

export function useChat(conversationId: string | null, onMessageSent?: (conversationId: string, lastMessage: string, lastMessageAt: string) => void) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const markAsReadInFlightRef = useRef(false);
  const lastPatchedUnreadKeyRef = useRef('');
  const initialMarkDoneRef = useRef<string | null>(null);
  const ghostModeRef = useRef(false);
  const prevConversationIdRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const { currentUserProfile } = useAppData();
  const pageSize = DM_MESSAGES_PAGE_SIZE;

  ghostModeRef.current = !!currentUserProfile?.ghost_mode;

  messagesRef.current = messages;

  useEffect(() => {
    currentUserIdRef.current = getCachedUser()?.id ?? null;
    return subscribeAuth((_event, session) => {
      currentUserIdRef.current = session?.user?.id ?? null;
    });
  }, []);

  const {
    data: fetchedMessages,
    isPending,
    isFetched,
    error: queryError,
  } = useQuery({
    queryKey: dmMessagesQueryKey(conversationId!),
    enabled: !!conversationId,
    queryFn: () => fetchDmMessages(conversationId!),
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: true,
    retry: 2,
  });

  const markAsRead = useCallback(async () => {
    if (!conversationId || markAsReadInFlightRef.current) return;

    const userId = currentUserIdRef.current ?? getCachedUser()?.id;
    if (!userId) return;

    if (ghostModeRef.current) return;

    const unreadKey = getUnreadBatchKey(messagesRef.current, userId);
    const syncedKey = unreadKey || `synced:${conversationId}`;
    if (lastPatchedUnreadKeyRef.current === syncedKey) return;

    markAsReadInFlightRef.current = true;
    dispatchConversationUnreadCleared(conversationId);

    try {
      const user = await resolveAuthUser();
      if (!user) return;

      const readAt = new Date().toISOString();

      const { error: updateError } = await supabase
        .from('messages')
        .update({
          read_at: readAt,
          is_read: true,
        })
        .eq('conversation_id', conversationId)
        .neq('sender_id', user.id)
        .eq('is_read', false);

      if (updateError) {
        const msg = String((updateError as { message?: string }).message || '');
        const missingCol =
          (updateError as { code?: string }).code === 'PGRST204' &&
          (msg.includes('is_read') || msg.includes('read_at'));
        if (missingCol) {
          return;
        }
        throw updateError;
      }

      lastPatchedUnreadKeyRef.current = syncedKey;

      if (unreadKey) {
        setMessages((prev) => applyReadStateToDmMessages(prev, conversationId, user.id, readAt));

        queryClient.setQueryData<Message[]>(dmMessagesQueryKey(conversationId), (cached) => {
          if (!cached?.length) return cached;
          return applyReadStateToDmMessages(cached, conversationId, user.id, readAt);
        });
      }

      dispatchUnreadRefreshRequest({ exceptConversationId: conversationId });
    } catch (err) {
      if (!isAbortError(err)) {
        console.error('Error marking messages as read:', err);
      }
    } finally {
      markAsReadInFlightRef.current = false;
    }
  }, [conversationId, queryClient]);

  const markAsReadRef = useRef(markAsRead);
  markAsReadRef.current = markAsRead;

  // Sync query results into local state (single effect — no separate clear effect that races).
  useEffect(() => {
    if (!conversationId) {
      prevConversationIdRef.current = null;
      setMessages([]);
      setLoading(false);
      setError(null);
      return;
    }

    const conversationChanged = prevConversationIdRef.current !== conversationId;
    if (conversationChanged) {
      prevConversationIdRef.current = conversationId;
      lastPatchedUnreadKeyRef.current = '';
      initialMarkDoneRef.current = null;
      setHasMore(true);
      setLoadingMore(false);
      setError(null);

      const cached = queryClient.getQueryData<Message[]>(dmMessagesQueryKey(conversationId));
      if (cached?.length) {
        setMessages(cached);
        setLoading(false);
      } else {
        setMessages([]);
        setLoading(isPending);
      }
    }

    if (isPending && messagesRef.current.length === 0) {
      setLoading(true);
      return;
    }

    setLoading(false);

    if (queryError) {
      setError((queryError as Error).message || 'Failed to load messages');
      return;
    }

    setError(null);

    if (fetchedMessages) {
      setMessages((prev) => {
        const incoming = fetchedMessages as Message[];
        if (conversationChanged || prev.length === 0) {
          return incoming;
        }
        return mergeDmMessagesById(prev, incoming);
      });
      setHasMore(fetchedMessages.length === pageSize);
    }
  }, [conversationId, fetchedMessages, isPending, isFetched, queryError, pageSize]);

  // One initial mark-as-read per conversation after the first page is in local state.
  useEffect(() => {
    if (!conversationId || isPending || !isFetched) return;
    if (initialMarkDoneRef.current === conversationId) return;
    initialMarkDoneRef.current = conversationId;
    void markAsReadRef.current();
  }, [conversationId, isPending, isFetched]);

  // Realtime subscription — only tied to conversationId.
  useEffect(() => {
    if (!conversationId) {
      return;
    }

    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const newMessage = payload.new as Message;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMessage.id)) {
              return prev;
            }
            return [...prev, newMessage];
          });

          dispatchConversationPreviewUpdate(
            newMessage.conversation_id,
            newMessage.content,
            newMessage.created_at
          );

          if (newMessage.sender_id !== currentUserIdRef.current) {
            lastPatchedUnreadKeyRef.current = '';
            void markAsReadRef.current();
            dispatchUnreadRefreshRequest({ exceptConversationId: conversationId });
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (
            isMessageReadReceiptUpdate(
              payload.old as Record<string, unknown> | undefined,
              payload.new as Record<string, unknown> | undefined
            )
          ) {
            const updatedMessage = payload.new as Message;
            setMessages((prev) =>
              prev.map((m) => (m.id === updatedMessage.id ? updatedMessage : m))
            );
            queryClient.setQueryData<Message[]>(
              dmMessagesQueryKey(conversationId),
              (cached) => {
                if (!cached?.length) return cached;
                return cached.map((m) =>
                  m.id === updatedMessage.id ? updatedMessage : m
                );
              }
            );
            return;
          }

          const updatedMessage = payload.new as Message;
          setMessages((prev) =>
            prev.map((m) => (m.id === updatedMessage.id ? updatedMessage : m))
          );
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [conversationId]);

  const sendMessage = useCallback(
    async (
      content: string,
      replyToMessageId?: string | null,
      attachmentIds?: string[],
    ): Promise<Message | null> => {
      const trimmed = content.trim();
      const hasAttachments = !!attachmentIds?.length;
      if (!conversationId || (!trimmed && !hasAttachments)) {
        return null;
      }

      try {
        setSending(true);
        setError(null);

        const result = await api.sendMessageSafe(
          conversationId,
          trimmed,
          replyToMessageId ?? null,
          attachmentIds,
        );

        if (!result || !result.success) {
          throw new Error(result?.message || 'Failed to send message. Permission denied or conversation not allowed.');
        }

        const { data: newMessage, error: fetchError } = await supabase
          .from('messages')
          .select('id, conversation_id, sender_id, content, created_at, is_read, read_at, reply_to_message_id')
          .eq('id', result.message_id)
          .single();

        if (fetchError) throw fetchError;

        if (newMessage) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMessage.id)) {
              return prev;
            }
            return [...prev, newMessage];
          });

          queryClient.setQueryData<Message[]>(
            dmMessagesQueryKey(conversationId),
            (cached) => {
              const base = cached ?? [];
              if (base.some((m) => m.id === newMessage.id)) return base;
              return [...base, newMessage as Message];
            }
          );

          dispatchConversationPreviewUpdate(
            conversationId,
            newMessage.content,
            newMessage.created_at
          );

          if (onMessageSent && conversationId) {
            onMessageSent(conversationId, newMessage.content, newMessage.created_at);
          }
        }

        return newMessage;
      } catch (err: any) {
        console.error('Error sending message:', err);
        setError(err.message || 'Failed to send message');
        return null;
      } finally {
        setSending(false);
      }
    },
    [conversationId, onMessageSent, queryClient]
  );

  const loadOlderMessages = useCallback(async (): Promise<Message[]> => {
    if (!conversationId || loadingMore || !hasMore) return [];
    const oldestMessage = messagesRef.current[0];
    if (!oldestMessage) return [];

    try {
      setLoadingMore(true);
      const { data, error: fetchError } = await supabase
        .from('messages')
        .select('id, conversation_id, sender_id, content, created_at, is_read, read_at, reply_to_message_id')
        .eq('conversation_id', conversationId)
        .lt('created_at', oldestMessage.created_at)
        .order('created_at', { ascending: false })
        .limit(pageSize);

      if (fetchError) throw fetchError;

      const olderMessages = (data || []).slice().reverse();
      setMessages((prev) => {
        const existing = new Set(prev.map((m) => m.id));
        const dedupedOlder = olderMessages.filter((m) => !existing.has(m.id));
        return [...dedupedOlder, ...prev];
      });
      setHasMore((data || []).length === pageSize);
      return olderMessages;
    } catch (err: any) {
      console.error('Error loading older messages:', err);
      setError(err.message || 'Failed to load older messages');
      return [];
    } finally {
      setLoadingMore(false);
    }
  }, [conversationId, loadingMore, hasMore, pageSize]);

  return {
    messages,
    loading,
    loadingMore,
    hasMore,
    sending,
    error,
    sendMessage,
    markAsRead,
    loadOlderMessages,
    reload: () => queryClient.invalidateQueries({ queryKey: dmMessagesQueryKey(conversationId!) }),
  };
}
