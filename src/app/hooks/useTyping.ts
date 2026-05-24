import { useCallback, useEffect, useState } from 'react';
import { publishTypingBroadcast, subscribeTypingBroadcast } from '../lib/typingBroadcast';

export function useTyping(conversationId: string | null, userId: string | null, isGhostMode: boolean) {
  const [isPartnerTyping, setIsPartnerTyping] = useState(false);

  useEffect(() => {
    if (!conversationId || !userId) {
      setIsPartnerTyping(false);
      return;
    }

    return subscribeTypingBroadcast(conversationId, setIsPartnerTyping);
  }, [conversationId, userId]);

  const sendTyping = useCallback(
    async (typing = true) => {
      if (!conversationId || !userId || isGhostMode) return;
      try {
        await publishTypingBroadcast(conversationId, userId, typing);
      } catch (error) {
        console.warn('Failed to send typing broadcast:', error);
      }
    },
    [conversationId, userId, isGhostMode]
  );

  return { isPartnerTyping, sendTyping };
}
