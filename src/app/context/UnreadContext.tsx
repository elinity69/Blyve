import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { NotificationManager } from '../lib/notifications';
import { supabase } from '../lib/supabase';

interface UnreadContextType {
  totalUnread: number;
  unreadByConversation: Record<string, number>;
  refreshUnreadCount: () => Promise<void>;
}

const UnreadContext = createContext<UnreadContextType | undefined>(undefined);

export const UnreadProvider = ({ 
  children, 
  currentUserId 
}: { 
  children: ReactNode; 
  currentUserId: string | null;
}) => {
  const [totalUnread, setTotalUnread] = useState(0);
  const [unreadByConversation, setUnreadByConversation] = useState<Record<string, number>>({});

  const refreshUnreadCount = useCallback(async () => {
    if (!currentUserId) {
      setTotalUnread(0);
      setUnreadByConversation({});
      return;
    }

    try {
      // Get all conversations where user is a participant
      const { data: conversations } = await supabase
        .from('conversations')
        .select('id')
        .or(`user1_id.eq.${currentUserId},user2_id.eq.${currentUserId}`);

      if (!conversations || conversations.length === 0) {
        setTotalUnread(0);
        setUnreadByConversation({});
        NotificationManager.updateBadge(0);
        return;
      }

      const conversationIds = conversations.map(c => c.id);

      // Get total unread count (messages where sender is NOT current user and is_read is false)
      const { count: total } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .in('conversation_id', conversationIds)
        .neq('sender_id', currentUserId)
        .eq('is_read', false);

      setTotalUnread(total || 0);
      NotificationManager.updateBadge(total || 0);

      // Get unread count per conversation
      const { data: messages } = await supabase
        .from('messages')
        .select('conversation_id')
        .in('conversation_id', conversationIds)
        .neq('sender_id', currentUserId)
        .eq('is_read', false);

      if (messages) {
        const countByConv: Record<string, number> = {};
        messages.forEach(msg => {
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

  // Initial load
  useEffect(() => {
    refreshUnreadCount();
  }, [refreshUnreadCount]);

  // Subscribe to refresh requests from the message realtime hub
  useEffect(() => {
    if (!currentUserId) return;

    const handleRefresh = () => {
      void refreshUnreadCount();
    };

    window.addEventListener('unread-refresh-requested', handleRefresh);
    return () => {
      window.removeEventListener('unread-refresh-requested', handleRefresh);
    };
  }, [currentUserId, refreshUnreadCount]);

  // Subscribe to real-time changes (fallback if hub misses an event)
  useEffect(() => {
    if (!currentUserId) return;

    const channel = supabase
      .channel(`unread-updates-${currentUserId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
        },
        async (payload) => {
          const message = payload.new || payload.old;
          if (!message) return;

          const { data: conversation } = await supabase
            .from('conversations')
            .select('user1_id, user2_id')
            .eq('id', message.conversation_id)
            .single();

          if (
            conversation &&
            (conversation.user1_id === currentUserId || conversation.user2_id === currentUserId)
          ) {
            void refreshUnreadCount();
          }
        }
      )
      .subscribe((status) => {
        console.log(`📡 Unread channel: ${status}`);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, refreshUnreadCount]);

  return (
    <UnreadContext.Provider value={{ totalUnread, unreadByConversation, refreshUnreadCount }}>
      {children}
    </UnreadContext.Provider>
  );
};

export const useUnread = () => {
  const context = useContext(UnreadContext);
  if (!context) {
    throw new Error('useUnread must be used within UnreadProvider');
  }
  return context;
};
