import { useEffect, useRef } from 'react';
import { subscribeTypingBroadcast } from '../lib/typingBroadcast';
import { debounce } from '../lib/requestThrottle';
import { fetchConversationIds } from '../lib/conversationMembership';

const MAX_TYPING_CHANNELS = 30;

/**
 * Typing subscriptions for recent conversations only (not all 200).
 * Additional channels are added when a conversation is opened.
 */
export function useTypingRealtime(currentUserId: string | null) {
  const unsubByConversationRef = useRef<Map<string, () => void>>(new Map());

  useEffect(() => {
    if (!currentUserId) {
      for (const unsub of unsubByConversationRef.current.values()) {
        unsub();
      }
      unsubByConversationRef.current.clear();
      return;
    }

    let cancelled = false;

    const syncSubscriptions = async (extraConversationId?: string) => {
      let ids: string[] = [];
      try {
        ids = await fetchConversationIds(currentUserId, { limit: MAX_TYPING_CHANNELS });
      } catch (error) {
        console.warn('useTypingRealtime syncSubscriptions:', error);
        return;
      }

      if (cancelled) return;

      const nextIds = new Set(ids);
      if (extraConversationId) {
        nextIds.add(extraConversationId);
      }

      const currentUnsubs = unsubByConversationRef.current;

      for (const [conversationId, unsub] of [...currentUnsubs.entries()]) {
        if (!nextIds.has(conversationId)) {
          unsub();
          currentUnsubs.delete(conversationId);
        }
      }

      for (const conversationId of nextIds) {
        if (currentUnsubs.has(conversationId)) continue;

        const unsub = subscribeTypingBroadcast(conversationId, () => {
          // typingBroadcast dispatches typing-status-changed for the UI.
        });
        currentUnsubs.set(conversationId, unsub);
      }
    };

    const debouncedSync = debounce(() => {
      void syncSubscriptions();
    }, 800);

    void syncSubscriptions();

    const onConversationOpened = (event: Event) => {
      const conversationId = (event as CustomEvent<{ conversationId?: string }>).detail
        ?.conversationId;
      if (conversationId) {
        void syncSubscriptions(conversationId);
      } else {
        debouncedSync();
      }
    };

    window.addEventListener('conversation-opened', onConversationOpened);
    window.addEventListener('conversation-closed', debouncedSync);
    window.addEventListener('conversation-list-reload-requested', debouncedSync);

    return () => {
      cancelled = true;
      window.removeEventListener('conversation-opened', onConversationOpened);
      window.removeEventListener('conversation-closed', debouncedSync);
      window.removeEventListener('conversation-list-reload-requested', debouncedSync);
      for (const unsub of unsubByConversationRef.current.values()) {
        unsub();
      }
      unsubByConversationRef.current.clear();
    };
  }, [currentUserId]);
}
