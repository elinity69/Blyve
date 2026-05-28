import { useEffect, useRef } from 'react';
import { useToast } from '../context/ToastContext';
import {
  dispatchConversationPreviewUpdate,
  dispatchUnreadRefreshRequest,
  type MessageEventPayload,
} from '../lib/messageEvents';
import { NotificationManager } from '../lib/notifications';
import { supabase } from '../lib/supabase';

interface GroupMessageEventPayload {
  id: string;
  group_id: string;
  channel_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

/**
 * Single realtime hub for message INSERT/UPDATE events.
 * Drives preview text, unread badges, toasts, and notification sounds.
 */
export function useMessageRealtime(currentUserId: string | null) {
  const { showToast } = useToast();
  const conversationIdsRef = useRef<Set<string>>(new Set());
  const groupIdsRef = useRef<Set<string>>(new Set());
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

    const loadGroupIds = async () => {
      const { data } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', currentUserId);

      if (cancelled) return;
      groupIdsRef.current = new Set((data || []).map((row) => row.group_id));
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

      if (message.sender_id === currentUserId) {
        return;
      }

      NotificationManager.playNotificationSound({ conversationId: message.conversation_id });

      const activeConversationId = NotificationManager.getActiveConversationId();
      const isChatOpen = activeConversationId === message.conversation_id;

      if (isChatOpen) {
        return;
      }

      const { data: sender } = await supabase
        .from('profiles')
        .select('name, display_name, username, avatar_url, images')
        .eq('id', message.sender_id)
        .single();

      const senderName = sender?.display_name || sender?.name || sender?.username || 'Someone';
      const senderPhoto = sender?.avatar_url || sender?.images?.[0] || null;
      const preview =
        message.content && message.content.length > 100
          ? `${message.content.substring(0, 100)}...`
          : message.content || 'New message';

      const toastPayload = {
        type: 'info' as const,
        variant: 'message' as const,
        title: senderName,
        message: preview,
        duration: 6000,
        imageUrl: senderPhoto || undefined,
        conversationId: message.conversation_id,
      };

      if (NotificationManager.isAppVisible()) {
        showToast(toastPayload);
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
      }
    };

    const handleGroupMessageInsert = async (message: GroupMessageEventPayload) => {
      if (!groupIdsRef.current.has(message.group_id)) {
        await loadGroupIds();
        if (!groupIdsRef.current.has(message.group_id)) {
          return;
        }
      }

      if (message.sender_id === currentUserId) {
        return;
      }

      const activeChannelId = NotificationManager.getActiveGroupChannelId();
      if (activeChannelId === message.channel_id) {
        return;
      }

      if (!NotificationManager.shouldNotifyForGroup(message.group_id)) {
        return;
      }

      NotificationManager.playNotificationSound({ groupId: message.group_id });

      const [{ data: sender }, { data: channel }, { data: group }] = await Promise.all([
        supabase
          .from('profiles')
          .select('name, display_name, username, avatar_url, images')
          .eq('id', message.sender_id)
          .single(),
        supabase.from('group_channels').select('name').eq('id', message.channel_id).maybeSingle(),
        supabase.from('groups').select('name').eq('id', message.group_id).maybeSingle(),
      ]);

      const senderName = sender?.display_name || sender?.name || sender?.username || 'Someone';
      const senderPhoto = sender?.avatar_url || sender?.images?.[0] || null;
      const channelName = channel?.name || 'general';
      const groupName = group?.name || 'Group';
      const preview =
        message.content && message.content.length > 100
          ? `${message.content.substring(0, 100)}...`
          : message.content || 'New message';

      if (NotificationManager.isAppVisible()) {
        showToast({
          type: 'info',
          variant: 'message',
          title: senderName,
          message: `${groupName} · #${channelName}\n${preview}`,
          duration: 6000,
          imageUrl: senderPhoto || undefined,
        });
        return;
      }

      if (NotificationManager.getPermission() === 'granted') {
        NotificationManager.showNotification(`💬 ${senderName}`, {
          body: `${groupName} · #${channelName}: ${preview}`,
          icon: senderPhoto || '/icon.png',
          badge: '/icon.png',
          tag: `group-message-${message.id}`,
          requireInteraction: false,
          silent: true,
          playSound: false,
        });
      }
    };

    const setup = async () => {
      await Promise.all([loadConversationIds(), loadGroupIds()]);
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
          { event: 'INSERT', schema: 'public', table: 'group_messages' },
          (payload) => {
            void handleGroupMessageInsert(payload.new as GroupMessageEventPayload);
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
      void loadGroupIds();
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
  }, [currentUserId, showToast]);
}
