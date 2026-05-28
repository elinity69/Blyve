import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo, useRef } from 'react';
import { NotificationManager } from '../lib/notifications';
import { supabase } from '../lib/supabase';

interface UnreadContextType {
  totalUnread: number;
  unreadByConversation: Record<string, number>;
  refreshUnreadCount: () => Promise<void>;
}

const UnreadContext = createContext<UnreadContextType | undefined>(undefined);

const UNREAD_REFRESH_DEBOUNCE_MS = 500;
const UNREAD_MIN_REFRESH_INTERVAL_MS = 2500;

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

      const total = unreadRows?.length ?? 0;
      setTotalUnread(total);
      setUnreadByConversation(countByConv);
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

    window.addEventListener('unread-refresh-requested', handleRefresh);
    return () => {
      window.removeEventListener('unread-refresh-requested', handleRefresh);
      if (refreshTimeoutRef.current) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [currentUserId, scheduleRefreshUnreadCount]);

  const value = useMemo(
    () => ({ totalUnread, unreadByConversation, refreshUnreadCount }),
    [totalUnread, unreadByConversation, refreshUnreadCount]
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
