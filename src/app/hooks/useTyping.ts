import { useCallback, useEffect, useState } from 'react';
import { publishTypingBroadcast, subscribeTypingBroadcast } from '../lib/typingBroadcast';

const logTypingDebug = (event: string, conversationId: string | null, userId: string | null, additionalMetrics: Record<string, any> = {}) => {
  console.log('[BLYVE_TYPING_DEBUG]', {
    event,
    ts: Date.now(),
    conversationId,
    userId,
    ...additionalMetrics,
  });
};

export function useTyping(conversationId: string | null, userId: string | null, isGhostMode: boolean) {
  const [isPartnerTyping, setIsPartnerTyping] = useState(false);

  useEffect(() => {
    logTypingDebug('useEffect_run', conversationId, userId, { isPartnerTyping });
    if (!conversationId || !userId) {
      setIsPartnerTyping(false);
      logTypingDebug('useEffect_return_early', conversationId, userId);
      return;
    }

    logTypingDebug('subscribeTypingBroadcast_called', conversationId, userId);
    const cleanup = subscribeTypingBroadcast(conversationId, setIsPartnerTyping);
    return () => {
      logTypingDebug('subscribeTypingBroadcast_cleanup', conversationId, userId);
      cleanup();
    };
  }, [conversationId, userId]);

  const sendTyping = useCallback(
    async (typing = true) => {
      logTypingDebug('sendTyping_called', conversationId, userId, { typing, isGhostMode });
      if (!conversationId || !userId || isGhostMode) {
        logTypingDebug('sendTyping_return_early', conversationId, userId, { typing, isGhostMode });
        return;
      }
      try {
        await publishTypingBroadcast(conversationId, userId, typing);
        logTypingDebug('publishTypingBroadcast_success', conversationId, userId, { typing });
      } catch (error: any) {
        logTypingDebug('publishTypingBroadcast_failed', conversationId, userId, { error: error.message });
        console.warn('Failed to send typing broadcast:', error);
      }
    },
    [conversationId, userId, isGhostMode]
  );

  return { isPartnerTyping, sendTyping };
}
