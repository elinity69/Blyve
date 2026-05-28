import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { initAuthSession, resolveAuthUser } from '../lib/authSession';
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
      const user = await resolveAuthUser();
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

      const visibleConvs = (convsData || []).filter((conv) => {
        const otherUserId = conv.user1_id === user.id ? conv.user2_id : conv.user1_id;
        return !blockedIds.has(otherUserId);
      });

      const otherUserIds = [
        ...new Set(
          visibleConvs.map((conv) =>
            conv.user1_id === user.id ? conv.user2_id : conv.user1_id
          )
        ),
      ];

      const profileMap = new Map<string, {
        id: string;
        name: string | null;
        display_name: string | null;
        username: string | null;
        images: string[] | null;
        ghost_mode: boolean | null;
        age: number | null;
        avatar_url: string | null;
      }>();

      if (otherUserIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, name, display_name, username, images, ghost_mode, age, avatar_url')
          .in('id', otherUserIds);
        for (const profile of profiles || []) {
          profileMap.set(profile.id, profile);
        }
      }

      const enrichedConversations = await Promise.all(
        visibleConvs.map(async (conv) => {
          const otherUserId = conv.user1_id === user.id ? conv.user2_id : conv.user1_id;
          const profile = profileMap.get(otherUserId);
          const lastViewedAt = viewsMap.get(conv.id);

          let unreadCount = 0;
          if (conv.last_message) {
            const query = supabase
              .from('messages')
              .select('*', { count: 'exact', head: true })
              .eq('conversation_id', conv.id)
              .neq('sender_id', user.id);

            if (lastViewedAt) {
              query.gt('created_at', lastViewedAt);
            }

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

  const applyConversationPreview = useCallback(
    (conversationId: string, content: string, created_at: string) => {
      setConversations((prev) => {
        if (!prev.some((c) => c.id === conversationId)) return prev;

        const updated = prev.map((conv) => {
          if (conv.id !== conversationId) return conv;
          const currentLast = new Date(conv.last_message_at || 0).getTime();
          const newTime = new Date(created_at).getTime();
          if (newTime <= currentLast) return conv;
          return {
            ...conv,
            last_message: content || 'New message',
            last_message_at: created_at,
            updated_at: created_at,
            has_messages: true,
          };
        });

        return [...updated].sort((a, b) => {
          const dateA = new Date(a.last_message_at || a.updated_at || 0).getTime();
          const dateB = new Date(b.last_message_at || b.updated_at || 0).getTime();
          return dateB - dateA;
        });
      });
    },
    []
  );

  const scheduleReload = useCallback(() => {
    if (reloadTimeoutRef.current) return;

    reloadTimeoutRef.current = window.setTimeout(() => {
      reloadTimeoutRef.current = null;
      void loadConversations();
    }, 500);
  }, [loadConversations]);

  useEffect(() => {
    void loadConversations();
    let channel: RealtimeChannel | null = null;

    const setupPreviewChannel = async () => {
      const session = await initAuthSession();
      const user = session?.user;
      if (!user) return;

      channel = supabase
        .channel(`preview_list_${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'conversations',
            filter: `user1_id=eq.${user.id}`,
          },
          (payload) => {
            const updated = payload.new as {
              id?: string;
              last_message?: string;
              last_message_at?: string;
            };
            if (updated?.id && updated.last_message && updated.last_message_at) {
              applyConversationPreview(
                updated.id,
                updated.last_message,
                updated.last_message_at
              );
            } else {
              scheduleReload();
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'conversations',
            filter: `user2_id=eq.${user.id}`,
          },
          (payload) => {
            const updated = payload.new as {
              id?: string;
              last_message?: string;
              last_message_at?: string;
            };
            if (updated?.id && updated.last_message && updated.last_message_at) {
              applyConversationPreview(
                updated.id,
                updated.last_message,
                updated.last_message_at
              );
            } else {
              scheduleReload();
            }
          }
        )
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
  }, [applyConversationPreview, loadConversations, scheduleReload]);

  useEffect(() => {
    const handlePreviewUpdate = (event: Event) => {
      const custom = event as CustomEvent<{
        conversationId: string;
        content: string;
        created_at: string;
      }>;
      const { conversationId, content, created_at } = custom.detail || ({} as any);
      if (!conversationId) return;
      applyConversationPreview(conversationId, content, created_at);
    };

    window.addEventListener('conversation-preview-update', handlePreviewUpdate as EventListener);
    return () => {
      window.removeEventListener('conversation-preview-update', handlePreviewUpdate as EventListener);
    };
  }, [applyConversationPreview]);

  return { conversations, loading, error, reload: loadConversations };
}
