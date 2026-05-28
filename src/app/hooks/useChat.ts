import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { RealtimeChannel } from '@supabase/supabase-js';
import { dispatchConversationPreviewUpdate } from '../lib/messageEvents';
import { useUnread } from '../context/UnreadContext';
import {
  DM_MESSAGES_PAGE_SIZE,
  dmMessagesQueryKey,
  fetchDmMessages,
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
  unread_count: number;
  has_messages: boolean;
}

function mergeMessages(base: Message[], extras: Message[]): Message[] {
  const map = new Map<string, Message>();
  base.forEach((m) => map.set(m.id, m));
  extras.forEach((m) => map.set(m.id, m));
  return Array.from(map.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function isAbortError(err: unknown): boolean {
  const msg = String((err as { message?: string })?.message ?? err ?? '');
  return msg.includes('AbortError') || msg.includes('aborted');
}

export function useChat(conversationId: string | null, onMessageSent?: (conversationId: string, lastMessage: string, lastMessageAt: string) => void) {
  const { refreshUnreadCount } = useUnread();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const prevConversationIdRef = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const pageSize = DM_MESSAGES_PAGE_SIZE;

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled) return;
      currentUserIdRef.current = user?.id ?? null;
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      currentUserIdRef.current = session?.user?.id ?? null;
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const {
    data: fetchedMessages,
    isPending,
    isFetched,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: dmMessagesQueryKey(conversationId!),
    enabled: !!conversationId,
    queryFn: () => fetchDmMessages(conversationId!),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

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
      setMessages([]);
      setHasMore(true);
      setLoadingMore(false);
      setError(null);
    }

    if (isPending) {
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
      setMessages((prev) =>
        conversationChanged
          ? (fetchedMessages as Message[])
          : mergeMessages(fetchedMessages as Message[], prev)
      );
      setHasMore(fetchedMessages.length === pageSize);
    }
  }, [conversationId, fetchedMessages, isPending, isFetched, queryError]);

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
            void refreshUnreadCount();
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
  }, [conversationId, refreshUnreadCount]);

  // Refetch after inactivity / tab focus / auth token refresh.
  useEffect(() => {
    if (!conversationId) return;

    const refetchMessages = () => {
      void refetch();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refetchMessages();
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')) {
        refetchMessages();
      }
    });

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', refetchMessages);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', refetchMessages);
      subscription.unsubscribe();
    };
  }, [conversationId, refetch]);

  const sendMessage = useCallback(
    async (content: string, replyToMessageId?: string | null): Promise<Message | null> => {
      if (!conversationId || !content.trim()) {
        return null;
      }

      try {
        setSending(true);
        setError(null);

        const result = await api.sendMessageSafe(
          conversationId,
          content.trim(),
          replyToMessageId ?? null
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

          dispatchConversationPreviewUpdate(
            conversationId,
            newMessage.content,
            newMessage.created_at
          );

          if (onMessageSent && conversationId) {
            onMessageSent(conversationId, newMessage.content, newMessage.created_at);
          }
        }
        void queryClient.invalidateQueries({ queryKey: dmMessagesQueryKey(conversationId) });

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

  const markAsRead = useCallback(async () => {
    if (!conversationId) return;

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('ghost_mode')
        .eq('id', user.id)
        .single();

      if (profileError) {
        if (!isAbortError(profileError)) {
          console.warn('Error loading ghost mode status:', profileError);
        }
        return;
      }

      if (profile?.ghost_mode) {
        return;
      }

      const { error: updateError } = await supabase
        .from('messages')
        .update({
          read_at: new Date().toISOString(),
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

      const readAt = new Date().toISOString();
      setMessages((prev) =>
        prev.map((m) =>
          m.conversation_id === conversationId &&
          m.sender_id !== user.id &&
          !m.is_read
            ? { ...m, is_read: true, read_at: readAt }
            : m
        )
      );

      void refreshUnreadCount();
      void queryClient.invalidateQueries({
        queryKey: dmMessagesQueryKey(conversationId),
        refetchType: 'active',
      });
    } catch (err) {
      if (!isAbortError(err)) {
        console.error('Error marking messages as read:', err);
      }
    }
  }, [conversationId, queryClient, refreshUnreadCount]);

  const loadOlderMessages = useCallback(async (): Promise<Message[]> => {
    if (!conversationId || loadingMore || !hasMore) return [];
    const oldestMessage = messages[0];
    if (!oldestMessage) return [];

    try {
      setLoadingMore(true);
      const { data, error: fetchError } = await supabase
        .from('messages')
        .select('id, conversation_id, sender_id, content, created_at, is_read, read_at')
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
  }, [conversationId, loadingMore, hasMore, messages]);

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
