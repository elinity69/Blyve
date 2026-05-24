import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';
import { RealtimeChannel } from '@supabase/supabase-js';
import { dispatchConversationPreviewUpdate } from '../lib/messageEvents';
import { useUnread } from '../context/UnreadContext';

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  is_read: boolean;
  read_at: string | null;
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

export function useChat(conversationId: string | null, onMessageSent?: (conversationId: string, lastMessage: string, lastMessageAt: string) => void) {
  const { refreshUnreadCount } = useUnread();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const queryClient = useQueryClient();
  const pageSize = 50;

  useEffect(() => {
    if (!conversationId) {
      setCurrentUserId(null);
      return;
    }
    const loadCurrentUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        setCurrentUserId(user?.id || null);
      } catch (err) {
        console.error('Failed to get current user for messages:', err);
        setCurrentUserId(null);
      }
    };
    loadCurrentUser();
  }, [conversationId]);

  const { data: fetchedMessages, isLoading, isFetched, error: queryError } = useQuery({
    queryKey: ['messages', conversationId, currentUserId],
    enabled: !!conversationId && !!currentUserId,
    queryFn: async () => {
      const { data, error: fetchError } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(pageSize);

      if (fetchError) throw fetchError;
      return (data || []).slice().reverse();
    },
    staleTime: 5 * 60 * 1000,
  });

  // Subscribe to realtime updates
  useEffect(() => {
    if (!conversationId) {
      return;
    }

    if (!isFetched || !currentUserId) {
      setLoading(true);
      return;
    }
    setLoading(false);
    if (queryError) {
      setError((queryError as Error).message || 'Failed to load messages');
    } else {
      setError(null);
    }

    if (fetchedMessages) {
      setMessages((prev) => {
        const map = new Map<string, Message>();
        fetchedMessages.forEach((m) => map.set(m.id, m as Message));
        prev.forEach((m) => {
          if (!map.has(m.id)) map.set(m.id, m);
        });
        return Array.from(map.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
      });
      setHasMore(fetchedMessages.length === pageSize);
    }

    // Subscribe to realtime changes
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
          console.log('New message received:', payload);
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
          if (newMessage.sender_id !== currentUserId) {
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
          console.log('Message updated:', payload);
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
  }, [conversationId, fetchedMessages, isLoading, isFetched, queryError, currentUserId, refreshUnreadCount]);

  useEffect(() => {
    if (!conversationId) return;
    setMessages([]);
    setHasMore(true);
    setLoadingMore(false);
    setError(null);
  }, [conversationId]);

  // Send a message
  const sendMessage = useCallback(
    async (content: string): Promise<Message | null> => {
      if (!conversationId || !content.trim()) {
        return null;
      }

      try {
        setSending(true);
        setError(null);

        // Use secure RPC function that validates conversation participation server-side
        const result = await api.sendMessageSafe(conversationId, content.trim());

        if (!result || !result.success) {
          throw new Error(result?.message || 'Failed to send message. Permission denied or conversation not allowed.');
        }

        // The function returns the message ID, so we need to fetch the full message
        const { data: newMessage, error: fetchError } = await supabase
          .from('messages')
          .select('*')
          .eq('id', result.message_id)
          .single();

        if (fetchError) throw fetchError;

        // Message will be added via realtime subscription, but we can add it optimistically
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
        queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });

        return newMessage;
      } catch (err: any) {
        console.error('Error sending message:', err);
        setError(err.message || 'Failed to send message');
        return null;
      } finally {
        setSending(false);
      }
    },
    [conversationId, onMessageSent]
  );

  // Mark messages as read
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
        console.warn('Error loading ghost mode status:', profileError);
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
        queryKey: ['messages', conversationId],
        refetchType: 'active',
      });
    } catch (err) {
      console.error('Error marking messages as read:', err);
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
        .select('*')
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
    reload: () => queryClient.invalidateQueries({ queryKey: ['messages', conversationId] }),
  };
}

