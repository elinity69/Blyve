import { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo, useRef } from 'react';
import { NotificationManager } from '../lib/notifications';
import { supabase } from '../lib/supabase';

interface UnreadContextType {
  totalUnread: number;
  unreadByConversation: Record<string, number>;
  refreshUnreadCount: () => Promise<void>;
}

const UnreadContext = createContext<UnreadContextType | undefined>(undefined);

const UNREAD_REFRESH_DEBOUNCE_MS = 400;

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

  const refreshUnreadCount = useCallback(async () => {
    if (!currentUserId) {
      setTotalUnread(0);
      setUnreadByConversation({});
      return;
    }

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

      const { count: total } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .in('conversation_id', conversationIds)
        .neq('sender_id', currentUserId)
        .eq('is_read', false);

      setTotalUnread(total || 0);
      NotificationManager.updateBadge(total || 0);

      const { data: messages } = await supabase
        .from('messages')
        .select('conversation_id')
        .in('conversation_id', conversationIds)
        .neq('sender_id', currentUserId)
        .eq('is_read', false);

      if (messages) {
        const countByConv: Record<string, number> = {};
        messages.forEach((msg) => {
          countByConv[msg.conversation_id] = (countByConv[msg.conversation_id] || 0) + 1;
        });
        setUnreadByConversation(countByConv);
      } else {
        setUnreadByConversation({});
      }
    } catch (error) {
      console.error('Error fetching unread counts:', error);
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
