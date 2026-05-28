import { useEffect, useRef } from 'react';
import { useToast } from '../context/ToastContext';
import {
  dispatchConversationPreviewUpdate,
  dispatchUnreadRefreshRequest,
  type MessageEventPayload,
} from '../lib/messageEvents';
import { isMessageReadReceiptUpdate } from '../lib/messageReadReceipts';
import { NotificationManager } from '../lib/notifications';
import { supabase } from '../lib/supabase';
import { debounce } from '../lib/requestThrottle';

interface GroupMessageEventPayload {
  id: string;
  group_id: string;
  channel_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

const MAX_REALTIME_CONVERSATIONS = 30;
const MAX_REALTIME_GROUPS = 30;
const MEMBERSHIP_RELOAD_MS = 60_000;

/**
 * Filtered realtime hub for message events (no global table listeners).
 * Drives preview text, unread badges, toasts, and notification sounds.
 */
export function useMessageRealtime(currentUserId: string | null) {
  const { showToast } = useToast();
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  const conversationIdsRef = useRef<Set<string>>(new Set());
  const groupIdsRef = useRef<Set<string>>(new Set());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastConversationIdsLoadRef = useRef(0);
  const lastGroupIdsLoadRef = useRef(0);

  useEffect(() => {
    if (!currentUserId) return;

    let cancelled = false;

    const loadConversationIds = async (force = false) => {
      const now = Date.now();
      if (!force && now - lastConversationIdsLoadRef.current < MEMBERSHIP_RELOAD_MS) {
        return false;
      }
      lastConversationIdsLoadRef.current = now;

      const { data } = await supabase
        .from('conversations')
        .select('id')
        .or(`user1_id.eq.${currentUserId},user2_id.eq.${currentUserId}`)
        .order('updated_at', { ascending: false })
        .limit(200);

      if (cancelled) return false;
      conversationIdsRef.current = new Set((data || []).map((row) => row.id));
      return true;
    };

    const loadGroupIds = async (force = false) => {
      const now = Date.now();
      if (!force && now - lastGroupIdsLoadRef.current < MEMBERSHIP_RELOAD_MS) {
        return false;
      }
      lastGroupIdsLoadRef.current = now;

      const { data } = await supabase
        .from('group_members')
        .select('group_id')
        .eq('user_id', currentUserId);

      if (cancelled) return false;
      groupIdsRef.current = new Set((data || []).map((row) => row.group_id));
      return true;
    };

    const handleMessageInsert = async (message: MessageEventPayload) => {
      const activeConversationId = NotificationManager.getActiveConversationId();
      const isChatOpen = activeConversationId === message.conversation_id;

      dispatchConversationPreviewUpdate(
        message.conversation_id,
        message.content,
        message.created_at
      );

      if (message.sender_id === currentUserId) {
        return;
      }

      if (!isChatOpen) {
        dispatchUnreadRefreshRequest();
      }

      NotificationManager.playNotificationSound({ conversationId: message.conversation_id });

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
        showToastRef.current(toastPayload);
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
        showToastRef.current({
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

    const subscribeFilteredChannel = () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }

      const channel = supabase.channel(`message-realtime-${currentUserId}`);

      for (const conversationId of [...conversationIdsRef.current].slice(
        0,
        MAX_REALTIME_CONVERSATIONS
      )) {
        channel.on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `conversation_id=eq.${conversationId}`,
          },
          (payload) => {
            void handleMessageInsert(payload.new as MessageEventPayload);
          }
        );
        channel.on(
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
              return;
            }
            const message = (payload.new || payload.old) as MessageEventPayload | null;
            if (!message?.conversation_id) return;
            if (NotificationManager.getActiveConversationId() === message.conversation_id) {
              return;
            }
            dispatchUnreadRefreshRequest();
          }
        );
      }

      for (const groupId of [...groupIdsRef.current].slice(0, MAX_REALTIME_GROUPS)) {
        channel.on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'group_messages',
            filter: `group_id=eq.${groupId}`,
          },
          (payload) => {
            void handleGroupMessageInsert(payload.new as GroupMessageEventPayload);
          }
        );
      }

      channel.subscribe();
      channelRef.current = channel;
    };

    const setup = async () => {
      await Promise.all([loadConversationIds(true), loadGroupIds(true)]);
      if (cancelled) return;
      subscribeFilteredChannel();
    };

    const refreshMembershipAndResubscribe = debounce(async () => {
      await Promise.all([loadConversationIds(true), loadGroupIds(true)]);
      if (cancelled) return;
      subscribeFilteredChannel();
    }, 1000);

    void setup();

    window.addEventListener('conversation-opened', refreshMembershipAndResubscribe);
    window.addEventListener('conversation-closed', refreshMembershipAndResubscribe);

    return () => {
      cancelled = true;
      window.removeEventListener('conversation-opened', refreshMembershipAndResubscribe);
      window.removeEventListener('conversation-closed', refreshMembershipAndResubscribe);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [currentUserId]);
}
