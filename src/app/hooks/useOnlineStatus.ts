import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';
import { debounce } from '../lib/requestThrottle';

// Track online users via Supabase Presence
export function useOnlineStatus(userId: string | null) {
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [ghostModeUsers, setGhostModeUsers] = useState<Set<string>>(new Set());
  const channelRef = useRef<RealtimeChannel | null>(null);

  const loadGhostModeStatus = useCallback(async (userIds: string[]) => {
    const unique = [...new Set(userIds)].slice(0, 50);
    if (unique.length === 0) return;

    try {
      const { data } = await supabase
        .from('profiles')
        .select('id, ghost_mode')
        .in('id', unique);

      if (data) {
        setGhostModeUsers((prev) => {
          const next = new Set(prev);
          for (const row of data) {
            if (row.ghost_mode) {
              next.add(row.id);
            } else {
              next.delete(row.id);
            }
          }
          return next;
        });
      }
    } catch (error) {
      console.error('Error loading ghost mode status:', error);
    }
  }, []);

  const debouncedLoadGhostMode = useMemo(
    () => debounce((ids: string[]) => {
      void loadGhostModeStatus(ids);
    }, 600),
    [loadGhostModeStatus]
  );

  const onlineUsersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`online-users-global`)
      .on('presence', { event: 'sync' }, () => {
        const presenceState = channel.presenceState();
        const online = new Set<string>();
        const userIds: string[] = [];
        
        Object.keys(presenceState).forEach((key) => {
          const presences = presenceState[key] as { user_id?: string }[];
          presences.forEach((presence) => {
            if (presence.user_id) {
              online.add(presence.user_id);
              userIds.push(presence.user_id);
            }
          });
        });
        
        onlineUsersRef.current = online;
        setOnlineUsers(online);
        if (userIds.length > 0) {
          debouncedLoadGhostMode(userIds);
        }
      })
      .on('presence', { event: 'join' }, ({ newPresences }) => {
        const online = new Set(onlineUsersRef.current);
        const userIds: string[] = [];
        newPresences.forEach((presence) => {
          const userId = (presence as { user_id?: string }).user_id;
          if (userId) {
            online.add(userId);
            userIds.push(userId);
          }
        });
        onlineUsersRef.current = online;
        setOnlineUsers(online);
        if (userIds.length > 0) {
          debouncedLoadGhostMode(userIds);
        }
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        const online = new Set(onlineUsersRef.current);
        leftPresences.forEach((presence) => {
          const userId = (presence as { user_id?: string }).user_id;
          if (userId) {
            online.delete(userId);
          }
        });
        onlineUsersRef.current = online;
        setOnlineUsers(online);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Track current user as online
          await channel.track({
            user_id: userId,
            online_at: new Date().toISOString(),
          });
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        channelRef.current.untrack();
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [userId, debouncedLoadGhostMode]);

  const isOnline = useCallback(
    (checkUserId: string | null, checkUserGhostMode?: boolean): boolean => {
      if (!checkUserId) return false;
      // Ghost mode users appear offline to others
      if (checkUserGhostMode !== undefined && checkUserGhostMode) {
        return false;
      }
      // Check if user is actually online and not in ghost mode
      return onlineUsers.has(checkUserId) && !ghostModeUsers.has(checkUserId);
    },
    [onlineUsers, ghostModeUsers]
  );

  return { isOnline, onlineUsers, ghostModeUsers };
}

