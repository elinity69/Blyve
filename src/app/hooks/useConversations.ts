import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Conversation } from './useChat';

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const reloadTimeoutRef = useRef<number | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      setError(null);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // 1. Load Conversations
      const { data: convsData, error: convsError } = await supabase
        .from('conversations')
        .select('id,user1_id,user2_id,created_at,updated_at,last_message,last_message_at')
        .or(`user1_id.eq.${user.id},user2_id.eq.${user.id}`)
        .order('updated_at', { ascending: false, nullsFirst: false })
        .limit(200);

      if (convsError) throw convsError;

      // 2. Load My Views (Last time I opened each chat)
      const { data: viewsData, error: viewsError } = await supabase
        .from('conversation_views')
        .select('conversation_id, last_viewed_at')
        .eq('user_id', user.id);

      if (viewsError) {
        console.warn('conversation_views:', viewsError.message);
      }

      const viewsMap = new Map();
      viewsData?.forEach((v) => viewsMap.set(v.conversation_id, v.last_viewed_at));

      // 3. Load Blocked Users (two queries — stable vs .or() on some PostgREST versions)
      const [asBlocker, asBlocked] = await Promise.all([
        supabase
          .from('blocked_users')
          .select('blocker_id, blocked_user_id')
          .eq('blocker_id', user.id),
        supabase
          .from('blocked_users')
          .select('blocker_id, blocked_user_id')
          .eq('blocked_user_id', user.id),
      ]);
      const blockedErr = asBlocker.error || asBlocked.error;
      if (blockedErr) {
        console.warn('blocked_users:', blockedErr.message);
      }
      const blockedData = [...(asBlocker.data || []), ...(asBlocked.data || [])];

      const blockedIds = new Set<string>();
      blockedData?.forEach((b) => { blockedIds.add(b.blocker_id); blockedIds.add(b.blocked_user_id); });

      // 4. Process Conversations
      const enrichedConversations = await Promise.all(
        (convsData || []).map(async (conv) => {
          const otherUserId = conv.user1_id === user.id ? conv.user2_id : conv.user1_id;
          if (blockedIds.has(otherUserId)) return null;

          const { data: profile } = await supabase
            .from('profiles')
            .select('id, name, display_name, username, images, ghost_mode, age, avatar_url')
            .eq('id', otherUserId)
            .single();

          // CLIENT-SIDE UNREAD CALCULATION (Navbar Logic)
          const lastViewedAt = viewsMap.get(conv.id);

          // Count messages newer than my last view
          let unreadCount = 0;
          if (conv.last_message) {
            const query = supabase
              .from('messages')
              .select('*', { count: 'exact', head: true })
              .eq('conversation_id', conv.id)
              .neq('sender_id', user.id);

            // If I have viewed it, only count newer messages
            if (lastViewedAt) {
              query.gt('created_at', lastViewedAt);
            }
            // If never viewed, count all (default behavior of query)

            const { count } = await query;
            unreadCount = count || 0;
          }

          return {
            ...conv,
            other_user: {
              id: otherUserId,
              name: profile?.display_name || profile?.name || 'Unknown',
              display_name: profile?.display_name || profile?.name || undefined,
              username: profile?.username || undefined,
              imageUrl: profile?.images?.[0] || profile?.avatar_url,
              is_online: false,
              ghost_mode: profile?.ghost_mode || false,
              age: profile?.age,
            },
            unread_count: unreadCount,
            has_messages: !!conv.last_message,
          };
        })
      );

      const validConvs = enrichedConversations.filter(Boolean) as Conversation[];

      const sortByActivity = (a: Conversation, b: Conversation) => {
        const dateA = new Date(a.last_message_at || a.updated_at || 0).getTime();
        const dateB = new Date(b.last_message_at || b.updated_at || 0).getTime();
        return dateB - dateA;
      };

      setConversations(validConvs.sort(sortByActivity));
    } catch (err: any) {
      console.error('Load Error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const scheduleReload = useCallback(() => {
    if (reloadTimeoutRef.current) return;

    reloadTimeoutRef.current = window.setTimeout(() => {
      reloadTimeoutRef.current = null;
      void loadConversations();
    }, 250);
  }, [loadConversations]);

  useEffect(() => {
    loadConversations();
    let channel: RealtimeChannel | null = null;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;

      const setupPreviewChannel = async () => {
        channel = supabase
          .channel(`preview_list_${user.id}`)
          // Conversation updates (trigger keeps last_message in sync server-side)
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'conversations' },
            () => scheduleReload()
          )
          // Read status changes: reload to keep unread badges in sync
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'conversation_views',
              filter: `user_id=eq.${user.id}`,
            },
            () => scheduleReload()
          )
          .subscribe((status) => {
            console.log(`📡 Conversation preview channel: ${status}`);
          });

        channelRef.current = channel;
      };

      setupPreviewChannel().catch((err) =>
        console.error('Error setting up preview channel:', err)
      );
    });

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      if (reloadTimeoutRef.current) {
        window.clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = null;
      }
    };
  }, [loadConversations]);

  // Listen to global preview update events from notification hook
  useEffect(() => {
    const handlePreviewUpdate = (event: Event) => {
      const custom = event as CustomEvent<{
        conversationId: string;
        content: string;
        created_at: string;
      }>;
      const { conversationId, content, created_at } = custom.detail || ({} as any);
      if (!conversationId) return;

      setConversations((prev) => {
        if (!prev || prev.length === 0) return prev;

        const convExists = prev.some((c) => c.id === conversationId);
        if (!convExists) return prev;

        const updated = prev.map((conv) => {
          if (conv.id === conversationId) {
            const currentLast = new Date(conv.last_message_at || 0).getTime();
            const newTime = new Date(created_at).getTime();
            if (newTime > currentLast) {
              return {
                ...conv,
                last_message: content || 'New message',
                last_message_at: created_at,
                updated_at: created_at,
                has_messages: true,
              };
            }
          }
          return conv;
        });

        return [...updated].sort((a, b) => {
          const dateA = new Date(a.last_message_at || a.updated_at || 0).getTime();
          const dateB = new Date(b.last_message_at || b.updated_at || 0).getTime();
          return dateB - dateA;
        });
      });
    };

    window.addEventListener('conversation-preview-update', handlePreviewUpdate as EventListener);
    return () => {
      window.removeEventListener('conversation-preview-update', handlePreviewUpdate as EventListener);
    };
  }, []);

  return { conversations, loading, error, reload: loadConversations };
}
