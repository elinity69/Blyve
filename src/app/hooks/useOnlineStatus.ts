import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

// Track online users via Supabase Presence
export function useOnlineStatus(userId: string | null) {
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [ghostModeUsers, setGhostModeUsers] = useState<Set<string>>(new Set());
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Load ghost mode status for users
  const loadGhostModeStatus = useCallback(async (userIds: string[]) => {
    try {
      const { data } = await supabase
        .from('profiles')
        .select('id, ghost_mode')
        .in('id', userIds);

      if (data) {
        const ghostUsers = new Set(
          data.filter((p) => p.ghost_mode).map((p) => p.id)
        );
        setGhostModeUsers(ghostUsers);
      }
    } catch (error) {
      console.error('Error loading ghost mode status:', error);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;

    // Track current user as online
    const channel = supabase
      .channel('online-users')
      .on('presence', { event: 'sync' }, () => {
        const presenceState = channel.presenceState();
        const online = new Set<string>();
        const userIds: string[] = [];
        
        Object.keys(presenceState).forEach((key) => {
          const presences = presenceState[key] as any[];
          presences.forEach((presence) => {
            if (presence.user_id) {
              online.add(presence.user_id);
              userIds.push(presence.user_id);
            }
          });
        });
        
        setOnlineUsers(online);
        // Load ghost mode for online users
        if (userIds.length > 0) {
          loadGhostModeStatus(userIds);
        }
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        const online = new Set(onlineUsers);
        const userIds: string[] = [];
        newPresences.forEach((presence: any) => {
          if (presence.user_id) {
            online.add(presence.user_id);
            userIds.push(presence.user_id);
          }
        });
        setOnlineUsers(online);
        if (userIds.length > 0) {
          loadGhostModeStatus(userIds);
        }
      })
      .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        const online = new Set(onlineUsers);
        leftPresences.forEach((presence: any) => {
          if (presence.user_id) {
            online.delete(presence.user_id);
          }
        });
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
  }, [userId, loadGhostModeStatus]);

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

