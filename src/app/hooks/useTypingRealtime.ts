import { useEffect, useRef } from 'react';
import { subscribeTypingBroadcast } from '../lib/typingBroadcast';
import { supabase } from '../lib/supabase';
import { debounce } from '../lib/requestThrottle';

const MAX_TYPING_CHANNELS = 15;

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
      const { data } = await supabase
        .from('conversations')
        .select('id')
        .or(`user1_id.eq.${currentUserId},user2_id.eq.${currentUserId}`)
        .order('updated_at', { ascending: false })
        .limit(MAX_TYPING_CHANNELS);

      if (cancelled) return;

      const nextIds = new Set((data || []).map((row) => row.id));
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

    return () => {
      cancelled = true;
      window.removeEventListener('conversation-opened', onConversationOpened);
      window.removeEventListener('conversation-closed', debouncedSync);
      for (const unsub of unsubByConversationRef.current.values()) {
        unsub();
      }
      unsubByConversationRef.current.clear();
    };
  }, [currentUserId]);
}
