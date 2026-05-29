import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { initAuthSession, resolveAuthUser } from '../lib/authSession';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Conversation } from './useChat';
import { onAppForeground, shouldResubscribeRealtimeChannel } from '../lib/realtimeReconnect';

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const reloadTimeoutRef = useRef<number | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  const loadConversationsRef = useRef<() => Promise<void>>(async () => {});
  const resubscribeTimeoutRef = useRef<number | null>(null);
  const channelHealthyRef = useRef(false);

  conversationsRef.current = conversations;

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

      // 2. Load Blocked Users (two queries — stable vs .or() on some PostgREST versions)
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

      const enrichedConversations = visibleConvs.map((conv) => {
        const otherUserId = conv.user1_id === user.id ? conv.user2_id : conv.user1_id;
        const profile = profileMap.get(otherUserId);

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
          has_messages: !!conv.last_message,
        };
      });

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

  loadConversationsRef.current = loadConversations;

  const scheduleReload = useCallback(() => {
    if (reloadTimeoutRef.current) return;

    reloadTimeoutRef.current = window.setTimeout(() => {
      reloadTimeoutRef.current = null;
      void loadConversationsRef.current();
    }, 500);
  }, []);

  const applyConversationPreview = useCallback(
    (conversationId: string, content: string, created_at: string) => {
      if (!conversationsRef.current.some((c) => c.id === conversationId)) {
        scheduleReload();
        return;
      }

      setConversations((prev) => {
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
    [scheduleReload]
  );

  const handleConversationChange = useCallback(
    (payload: { new: Record<string, unknown> }) => {
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
        return;
      }

      scheduleReload();
    },
    [applyConversationPreview, scheduleReload]
  );

  useEffect(() => {
    void loadConversations();
    let cancelled = false;

    const scheduleResubscribe = (setupFn: () => Promise<void>) => {
      if (resubscribeTimeoutRef.current) {
        window.clearTimeout(resubscribeTimeoutRef.current);
      }
      resubscribeTimeoutRef.current = window.setTimeout(() => {
        resubscribeTimeoutRef.current = null;
        if (!cancelled) {
          void setupFn();
        }
      }, 800);
    };

    const setupPreviewChannel = async () => {
      const session = await initAuthSession();
      const user = session?.user;
      if (!user || cancelled) return;

      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }

      const channel = supabase
        .channel(`preview_list_${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'conversations',
            filter: `user1_id=eq.${user.id}`,
          },
          () => {
            scheduleReload();
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'conversations',
            filter: `user2_id=eq.${user.id}`,
          },
          () => {
            scheduleReload();
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'conversations',
            filter: `user1_id=eq.${user.id}`,
          },
          handleConversationChange
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'conversations',
            filter: `user2_id=eq.${user.id}`,
          },
          handleConversationChange
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            channelHealthyRef.current = true;
            return;
          }

          if (shouldResubscribeRealtimeChannel(status)) {
            channelHealthyRef.current = false;
            scheduleResubscribe(setupPreviewChannel);
            return;
          }

          if (import.meta.env.DEV) {
            console.log(`📡 Conversation preview channel: ${status}`);
          }
        });

      channelRef.current = channel;
    };

    void setupPreviewChannel();

    const unsubscribeForeground = onAppForeground(() => {
      scheduleReload();
      if (!channelHealthyRef.current) {
        scheduleResubscribe(setupPreviewChannel);
      }
    });

    const handleListReload = () => {
      scheduleReload();
    };

    window.addEventListener('conversation-list-reload-requested', handleListReload);

    return () => {
      cancelled = true;
      unsubscribeForeground();
      window.removeEventListener('conversation-list-reload-requested', handleListReload);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      if (reloadTimeoutRef.current) {
        window.clearTimeout(reloadTimeoutRef.current);
        reloadTimeoutRef.current = null;
      }
      if (resubscribeTimeoutRef.current) {
        window.clearTimeout(resubscribeTimeoutRef.current);
        resubscribeTimeoutRef.current = null;
      }
    };
  }, [handleConversationChange, loadConversations, scheduleReload]);

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
