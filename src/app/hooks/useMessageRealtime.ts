import { useEffect, useRef } from 'react';
import { useToast } from '../context/ToastContext';
import { useUnread } from '../context/UnreadContext';
import {
  dispatchConversationPreviewUpdate,
  dispatchUnreadRefreshRequest,
  type MessageEventPayload,
} from '../lib/messageEvents';
import { NotificationManager } from '../lib/notifications';
import { supabase } from '../lib/supabase';

/**
 * Single realtime hub for message INSERT/UPDATE events.
 * Drives preview text, unread badges, toasts, and notification sounds.
 */
export function useMessageRealtime(currentUserId: string | null) {
  const { showToast } = useToast();
  const { refreshUnreadCount } = useUnread();
  const conversationIdsRef = useRef<Set<string>>(new Set());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!currentUserId) return;

    let cancelled = false;

    const loadConversationIds = async () => {
      const { data } = await supabase
        .from('conversations')
        .select('id')
        .or(`user1_id.eq.${currentUserId},user2_id.eq.${currentUserId}`);

      if (cancelled) return;
      conversationIdsRef.current = new Set((data || []).map((row) => row.id));
    };

    const handleMessageInsert = async (message: MessageEventPayload) => {
      if (!conversationIdsRef.current.has(message.conversation_id)) {
        await loadConversationIds();
        if (!conversationIdsRef.current.has(message.conversation_id)) {
          return;
        }
      }

      console.log('🔔 Message realtime INSERT:', {
        messageId: message.id,
        conversationId: message.conversation_id,
        senderId: message.sender_id,
      });

      dispatchConversationPreviewUpdate(
        message.conversation_id,
        message.content,
        message.created_at
      );
      dispatchUnreadRefreshRequest();
      void refreshUnreadCount();

      if (message.sender_id === currentUserId) {
        return;
      }

      const activeConversationId =
        NotificationManager.getActiveConversationId() ||
        localStorage.getItem('currentConversationId');
      const isChatOpen = activeConversationId === message.conversation_id;

      if (!isChatOpen) {
        NotificationManager.playNotificationSound();
      }

      const { data: sender } = await supabase
        .from('profiles')
        .select('name, display_name, username, avatar_url')
        .eq('id', message.sender_id)
        .single();

      const senderName = sender?.display_name || sender?.name || sender?.username || 'Someone';
      const senderPhoto = sender?.avatar_url || null;
      const preview =
        message.content && message.content.length > 100
          ? `${message.content.substring(0, 100)}...`
          : message.content || 'New message';

      if (isChatOpen) {
        return;
      }

      if (NotificationManager.isAppActive()) {
        showToast({
          type: 'info',
          title: senderName,
          message: preview,
          duration: 5000,
          imageUrl: senderPhoto || undefined,
          conversationId: message.conversation_id,
        });
        return;
      }

      if (NotificationManager.getPermission() === 'granted') {
        NotificationManager.showNotification(`💬 ${senderName}`, {
          body: preview,
          icon: senderPhoto || '/icon.png',
          badge: '/icon.png',
          tag: `message-${message.id}`,
          requireInteraction: false,
          silent: true,
          playSound: false,
          data: {
            conversationId: message.conversation_id,
            senderId: message.sender_id,
          },
        });
      } else {
        showToast({
          type: 'info',
          title: senderName,
          message: preview,
          duration: 5000,
          imageUrl: senderPhoto || undefined,
          conversationId: message.conversation_id,
        });
      }
    };

    const setup = async () => {
      await loadConversationIds();
      if (cancelled) return;

      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }

      const channel = supabase
        .channel(`message-realtime-${currentUserId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          (payload) => {
            void handleMessageInsert(payload.new as MessageEventPayload);
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'messages' },
          (payload) => {
            const message = (payload.new || payload.old) as MessageEventPayload | null;
            if (!message?.conversation_id) return;
            if (!conversationIdsRef.current.has(message.conversation_id)) return;
            dispatchUnreadRefreshRequest();
            void refreshUnreadCount();
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'conversations' },
          (payload) => {
            const updated = payload.new as {
              id?: string;
              last_message?: string;
              last_message_at?: string;
            };
            if (!updated?.id || !updated.last_message || !updated.last_message_at) return;
            if (!conversationIdsRef.current.has(updated.id)) return;
            dispatchConversationPreviewUpdate(
              updated.id,
              updated.last_message,
              updated.last_message_at
            );
          }
        )
        .subscribe((status) => {
          console.log(`📡 Message realtime channel: ${status}`);
        });

      channelRef.current = channel;
    };

    void setup();

    const refreshConversationIds = () => {
      void loadConversationIds();
    };
    window.addEventListener('conversation-opened', refreshConversationIds);
    window.addEventListener('conversation-closed', refreshConversationIds);

    return () => {
      cancelled = true;
      window.removeEventListener('conversation-opened', refreshConversationIds);
      window.removeEventListener('conversation-closed', refreshConversationIds);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [currentUserId, refreshUnreadCount, showToast]);
}
