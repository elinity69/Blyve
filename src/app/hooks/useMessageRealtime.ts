import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../context/ToastContext';
import {
  dispatchConversationPreviewUpdate,
  dispatchConversationListReloadRequested,
  dispatchUnreadRefreshRequest,
  type MessageEventPayload,
} from '../lib/messageEvents';
import { isMessageReadReceiptUpdate } from '../lib/messageReadReceipts';
import { NotificationManager } from '../lib/notifications';
import { supabase } from '../lib/supabase';
import { debounce } from '../lib/requestThrottle';
import { onAppForeground, shouldResubscribeRealtimeChannel } from '../lib/realtimeReconnect';
import {
  addConversationIdToCache,
  fetchConversationIds,
  invalidateConversationMembershipCache,
} from '../lib/conversationMembership';
import { appendDmMessageToCache } from '../lib/chatMessages';
import { fetchConversationLastViewedAt } from '../lib/conversationViews';
import type { Message } from './useChat';

interface GroupMessageEventPayload {
  id: string;
  group_id: string;
  channel_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

const MAX_REALTIME_CONVERSATIONS = 50;
const MAX_REALTIME_GROUPS = 30;
const MEMBERSHIP_RELOAD_MS = 15_000;

/**
 * Filtered realtime hub for message events (no global table listeners).
 * Drives preview text, unread badges, toasts, and notification sounds.
 */
function messageFromRealtimePayload(payload: MessageEventPayload): Message {
  return {
    id: payload.id,
    conversation_id: payload.conversation_id,
    sender_id: payload.sender_id,
    content: payload.content,
    created_at: payload.created_at,
    is_read: false,
    read_at: null,
    reply_to_message_id: null,
  };
}

export function useMessageRealtime(currentUserId: string | null) {
  const queryClient = useQueryClient();
  const queryClientRef = useRef(queryClient);
  queryClientRef.current = queryClient;
  const { showToast } = useToast();
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  const conversationIdsRef = useRef<Set<string>>(new Set());
  const groupIdsRef = useRef<Set<string>>(new Set());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastGroupIdsLoadRef = useRef(0);
  const lastMembershipSignatureRef = useRef('');
  const channelHealthyRef = useRef(false);
  const resubscribeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!currentUserId) return;

    let cancelled = false;

    const loadConversationIds = async (force = false) => {
      try {
        const ids = await fetchConversationIds(currentUserId, { force });
        if (cancelled) return false;
        conversationIdsRef.current = new Set(ids);
        return true;
      } catch (error) {
        console.warn('loadConversationIds:', error);
        return false;
      }
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
      const isKnownConversation = conversationIdsRef.current.has(message.conversation_id);
      if (!isKnownConversation) {
        dispatchConversationListReloadRequested();
        await loadConversationIds(true);
        subscribeFilteredChannel();
      }

      const activeConversationId = NotificationManager.getActiveConversationId();
      const isChatOpen = activeConversationId === message.conversation_id;

      dispatchConversationPreviewUpdate(
        message.conversation_id,
        message.content,
        message.created_at
      );

      if (message.sender_id !== currentUserId && !isChatOpen) {
        appendDmMessageToCache(queryClientRef.current, messageFromRealtimePayload(message));
      }

      if (message.sender_id === currentUserId) {
        return;
      }

      // Before notifying, check if the message is truly unread from the server's perspective.
      // This prevents re-notifying for messages read on another device when logging in.
      const lastViewedAt = await fetchConversationLastViewedAt(message.conversation_id, currentUserId);
      if (lastViewedAt && new Date(message.created_at) <= new Date(lastViewedAt)) {
        return;
      }

      if (!isChatOpen) {
        dispatchUnreadRefreshRequest();
      }

      // Play app notification sound even when the tab is not visible.
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
          silent: false,
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

      const appIsVisible = NotificationManager.isAppVisible();
      if (appIsVisible) {
        NotificationManager.playNotificationSound({ groupId: message.group_id });
      }

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

      if (appIsVisible) {
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

      channel.on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversations',
          filter: `user1_id=eq.${currentUserId}`,
        },
        () => {
          void refreshMembershipAndResubscribe({ listReload: true });
        }
      );
      channel.on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversations',
          filter: `user2_id=eq.${currentUserId}`,
        },
        () => {
          void refreshMembershipAndResubscribe({ listReload: true });
        }
      );

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

      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channelHealthyRef.current = true;
          return;
        }

        if (shouldResubscribeRealtimeChannel(status)) {
          channelHealthyRef.current = false;
          if (resubscribeTimeoutRef.current) {
            window.clearTimeout(resubscribeTimeoutRef.current);
          }
          resubscribeTimeoutRef.current = window.setTimeout(() => {
            resubscribeTimeoutRef.current = null;
            if (!cancelled) {
              void refreshMembershipAndResubscribe();
            }
          }, 800);
        }
      });
      channelRef.current = channel;
    };

    const setup = async () => {
      await Promise.all([loadConversationIds(true), loadGroupIds(true)]);
      if (cancelled) return;
      subscribeFilteredChannel();
    };

    const refreshMembershipAndResubscribe = debounce(async (options?: { listReload?: boolean }) => {
      const previousSignature = lastMembershipSignatureRef.current;
      await Promise.all([loadConversationIds(true), loadGroupIds(true)]);
      if (cancelled) return;

      const signature = [
        [...conversationIdsRef.current].sort().join(','),
        [...groupIdsRef.current].sort().join(','),
      ].join('|');

      const membershipChanged = signature !== previousSignature;
      lastMembershipSignatureRef.current = signature;

      if (membershipChanged) {
        subscribeFilteredChannel();
        if (options?.listReload) {
          dispatchConversationListReloadRequested();
        }
      }
    }, 1000);

    void setup();

    const unsubscribeForeground = onAppForeground(() => {
      void refreshMembershipAndResubscribe();
    });

    const handleConversationOpened = (event: Event) => {
      const conversationId = (event as CustomEvent<{ conversationId?: string }>).detail
        ?.conversationId;
      if (!conversationId) return;

      if (!conversationIdsRef.current.has(conversationId)) {
        conversationIdsRef.current.add(conversationId);
        addConversationIdToCache(currentUserId, conversationId);
        subscribeFilteredChannel();
      }
    };

    window.addEventListener('conversation-opened', handleConversationOpened);

    return () => {
      cancelled = true;
      invalidateConversationMembershipCache(currentUserId);
      unsubscribeForeground();
      window.removeEventListener('conversation-opened', handleConversationOpened);
      if (resubscribeTimeoutRef.current) {
        window.clearTimeout(resubscribeTimeoutRef.current);
        resubscribeTimeoutRef.current = null;
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [currentUserId]);
}
