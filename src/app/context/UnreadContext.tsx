import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo, useRef } from 'react';
import { NotificationManager } from '../lib/notifications';
import { supabase } from '../lib/supabase';

interface UnreadContextType {
  totalUnread: number;
  unreadByConversation: Record<string, number>;
  refreshUnreadCount: () => Promise<void>;
  clearConversationUnread: (conversationId: string) => void;
}

const UnreadContext = createContext<UnreadContextType | undefined>(undefined);

const UNREAD_REFRESH_DEBOUNCE_MS = 500;
const UNREAD_MIN_REFRESH_INTERVAL_MS = 2500;
/** Ignore server unread for a conversation shortly after a local clear (replication lag). */
const STALE_UNREAD_SUPPRESS_MS = 10_000;

function applyClearedConversationPins(
  countByConv: Record<string, number>,
  clearedUntilByConversation: Map<string, number>,
  activeConversationId: string | null
): Record<string, number> {
  const next = { ...countByConv };
  const now = Date.now();

  if (activeConversationId) {
    delete next[activeConversationId];
  }

  for (const [conversationId, until] of clearedUntilByConversation) {
    if (until < now) {
      clearedUntilByConversation.delete(conversationId);
      continue;
    }
    delete next[conversationId];
  }

  return next;
}

function sumUnreadMap(countByConv: Record<string, number>): number {
  return Object.values(countByConv).reduce((sum, n) => sum + n, 0);
}

export const UnreadProvider = ({
  children,
  currentUserId,
}: {
  children: ReactNode;
  currentUserId: string | null;
}) => {
  const [totalUnread, setTotalUnread] = useState(0);
  const [unreadByConversation, setUnreadByConversation] = useState<Record<string, number>>({});
  const refreshTimeoutRef = useRef<number | null>(null);
  const lastRefreshAtRef = useRef(0);
  const inFlightRef = useRef(false);
  const clearedUntilByConversationRef = useRef<Map<string, number>>(new Map());

  const clearConversationUnread = useCallback((conversationId: string) => {
    if (!conversationId) return;

    clearedUntilByConversationRef.current.set(
      conversationId,
      Date.now() + STALE_UNREAD_SUPPRESS_MS
    );

    setUnreadByConversation((prev) => {
      const removed = prev[conversationId] || 0;
      if (removed === 0) return prev;

      const next = { ...prev };
      delete next[conversationId];
      const total = sumUnreadMap(next);
      setTotalUnread(total);
      NotificationManager.updateBadge(total);
      return next;
    });
  }, []);

  const refreshUnreadCount = useCallback(async () => {
    if (!currentUserId) {
      setTotalUnread(0);
      setUnreadByConversation({});
      return;
    }

    const now = Date.now();
    if (now - lastRefreshAtRef.current < UNREAD_MIN_REFRESH_INTERVAL_MS) {
      return;
    }
    if (inFlightRef.current) {
      return;
    }

    inFlightRef.current = true;
    lastRefreshAtRef.current = now;

    try {
      const { data: conversations } = await supabase
        .from('conversations')
        .select('id')
        .or(`user1_id.eq.${currentUserId},user2_id.eq.${currentUserId}`)
        .limit(200);

      if (!conversations || conversations.length === 0) {
        setTotalUnread(0);
        setUnreadByConversation({});
        NotificationManager.updateBadge(0);
        return;
      }

      const conversationIds = conversations.map((c) => c.id);

      const { data: unreadRows, error } = await supabase
        .from('messages')
        .select('conversation_id')
        .in('conversation_id', conversationIds)
        .neq('sender_id', currentUserId)
        .eq('is_read', false);

      if (error) {
        throw error;
      }

      const countByConv: Record<string, number> = {};
      for (const row of unreadRows || []) {
        countByConv[row.conversation_id] = (countByConv[row.conversation_id] || 0) + 1;
      }

      const merged = applyClearedConversationPins(
        countByConv,
        clearedUntilByConversationRef.current,
        NotificationManager.getActiveConversationId()
      );

      const total = sumUnreadMap(merged);
      setTotalUnread(total);
      setUnreadByConversation(merged);
      NotificationManager.updateBadge(total);
    } catch (error) {
      console.error('Error fetching unread counts:', error);
    } finally {
      inFlightRef.current = false;
    }
  }, [currentUserId]);

  const scheduleRefreshUnreadCount = useCallback(() => {
    if (refreshTimeoutRef.current) return;
    refreshTimeoutRef.current = window.setTimeout(() => {
      refreshTimeoutRef.current = null;
      void refreshUnreadCount();
    }, UNREAD_REFRESH_DEBOUNCE_MS);
  }, [refreshUnreadCount]);

  useEffect(() => {
    void refreshUnreadCount();
  }, [refreshUnreadCount]);

  useEffect(() => {
    if (!currentUserId) return;

    const handleRefresh = () => {
      scheduleRefreshUnreadCount();
    };

    const handleConversationOpened = (event: Event) => {
      const conversationId = (event as CustomEvent<{ conversationId?: string }>).detail
        ?.conversationId;
      if (conversationId) {
        clearConversationUnread(conversationId);
      }
    };

    const handleConversationClosed = () => {
      scheduleRefreshUnreadCount();
    };

    const handleConversationUnreadCleared = (event: Event) => {
      const conversationId = (event as CustomEvent<{ conversationId?: string }>).detail
        ?.conversationId;
      if (conversationId) {
        clearConversationUnread(conversationId);
      }
    };

    window.addEventListener('unread-refresh-requested', handleRefresh);
    window.addEventListener('conversation-opened', handleConversationOpened as EventListener);
    window.addEventListener('conversation-closed', handleConversationClosed);
    window.addEventListener(
      'conversation-unread-cleared',
      handleConversationUnreadCleared as EventListener
    );

    return () => {
      window.removeEventListener('unread-refresh-requested', handleRefresh);
      window.removeEventListener('conversation-opened', handleConversationOpened as EventListener);
      window.removeEventListener('conversation-closed', handleConversationClosed);
      window.removeEventListener(
        'conversation-unread-cleared',
        handleConversationUnreadCleared as EventListener
      );
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [currentUserId, scheduleRefreshUnreadCount, clearConversationUnread]);

  const value = useMemo(
    () => ({ totalUnread, unreadByConversation, refreshUnreadCount, clearConversationUnread }),
    [totalUnread, unreadByConversation, refreshUnreadCount, clearConversationUnread]
  );

  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
};

export const useUnread = () => {
  const context = useContext(UnreadContext);
  if (!context) {
    throw new Error('useUnread must be used within UnreadProvider');
  }
  return context;
};
