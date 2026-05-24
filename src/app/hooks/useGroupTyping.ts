import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  GroupTyper,
  publishGroupTypingBroadcast,
  subscribeGroupTypingBroadcast,
} from '../lib/groupTypingBroadcast';

export function useGroupTyping(
  groupId: string | null,
  channelId: string | null,
  userId: string | null,
  displayName: string,
  isGhostMode: boolean
) {
  const [typers, setTypers] = useState<GroupTyper[]>([]);

  useEffect(() => {
    if (!groupId || !channelId || !userId) {
      setTypers([]);
      return;
    }

    return subscribeGroupTypingBroadcast(groupId, channelId, setTypers);
  }, [groupId, channelId, userId]);

  const otherTypers = useMemo(
    () => (userId ? typers.filter((typer) => typer.userId !== userId) : typers),
    [typers, userId]
  );

  const sendTyping = useCallback(
    async (typing = true) => {
      if (!groupId || !channelId || !userId || isGhostMode) return;
      const name = displayName.trim() || 'Member';
      try {
        await publishGroupTypingBroadcast(groupId, channelId, userId, name, typing);
      } catch (error) {
        console.warn('Failed to send group typing broadcast:', error);
      }
    },
    [channelId, displayName, groupId, isGhostMode, userId]
  );

  return { typers: otherTypers, sendTyping };
}
