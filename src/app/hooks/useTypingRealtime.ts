import { useEffect, useRef } from 'react';
import { subscribeTypingBroadcast } from '../lib/typingBroadcast';
import { supabase } from '../lib/supabase';

/**
 * App-level typing subscriptions for all user conversations.
 * Keeps broadcast channels active even when no chat is open.
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

    const syncSubscriptions = async () => {
      const { data } = await supabase
        .from('conversations')
        .select('id')
        .or(`user1_id.eq.${currentUserId},user2_id.eq.${currentUserId}`);

      if (cancelled) return;

      const nextIds = new Set((data || []).map((row) => row.id));
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
          // typingBroadcast.notify() dispatches typing-status-changed for the UI.
        });
        currentUnsubs.set(conversationId, unsub);
      }
    };

    void syncSubscriptions();

    const refresh = () => {
      void syncSubscriptions();
    };

    window.addEventListener('conversation-opened', refresh);
    window.addEventListener('conversation-closed', refresh);

    return () => {
      cancelled = true;
      window.removeEventListener('conversation-opened', refresh);
      window.removeEventListener('conversation-closed', refresh);
      for (const unsub of unsubByConversationRef.current.values()) {
        unsub();
      }
      unsubByConversationRef.current.clear();
    };
  }, [currentUserId]);
}
