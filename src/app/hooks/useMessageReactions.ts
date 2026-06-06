/**
 * Fetches, subscribes, and toggles reactions for a single message.
 *
 * - One realtime channel per message (scoped, low overhead).
 * - Optimistic toggle: updates local state immediately, reconciles on error.
 * - Deduplicates realtime events to prevent double-apply.
 * - Fetches display names for tooltip ("👍 Alice, Bob").
 * - Fires an in-app notification toast when someone else reacts to the current
 *   user's own message (requires isOwnMessage = true from the caller).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { getCachedUser } from '../lib/authSession';
import { recordRecentReactionEmoji } from './useRecentReactionEmojis';
import { toast } from '../lib/toast';

export interface MessageReaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

/** Aggregated reaction for display */
export interface ReactionSummary {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  /** user_ids who reacted — used for tooltip names + dedup */
  userIds: Set<string>;
  /** display names for tooltip — populated async after initial fetch */
  reactorNames: string[];
}

interface ProfileRow {
  id: string;
  display_name: string | null;
  name: string | null;
  username: string | null;
}

// Module-level name cache so all message rows share it (avoids N×profile fetches).
const profileNameCache = new Map<string, string>();

async function fetchNames(userIds: string[]): Promise<void> {
  const missing = userIds.filter((id) => !profileNameCache.has(id));
  if (!missing.length) return;
  const { data } = await supabase
    .from('profiles')
    .select('id, display_name, name, username')
    .in('id', missing);
  for (const row of (data ?? []) as ProfileRow[]) {
    profileNameCache.set(row.id, row.display_name || row.name || row.username || '…');
  }
}

function resolveNames(userIds: Set<string>): string[] {
  return [...userIds].map((id) => profileNameCache.get(id) ?? '…');
}

function aggregate(
  reactions: MessageReaction[],
  currentUserId: string | null
): ReactionSummary[] {
  const map = new Map<string, ReactionSummary>();
  for (const r of reactions) {
    let entry = map.get(r.emoji);
    if (!entry) {
      entry = { emoji: r.emoji, count: 0, reactedByMe: false, userIds: new Set(), reactorNames: [] };
      map.set(r.emoji, entry);
    }
    entry.count += 1;
    entry.userIds.add(r.user_id);
    if (r.user_id === currentUserId) entry.reactedByMe = true;
  }
  // Populate names from cache (synchronous — may be partial until fetch resolves)
  for (const entry of map.values()) {
    entry.reactorNames = resolveNames(entry.userIds);
  }
  return Array.from(map.values());
}

interface UseMessageReactionsOptions {
  /** Pass true when the message belongs to the current user — enables reaction notifications. */
  isOwnMessage?: boolean;
}

export function useMessageReactions(
  messageId: string | null,
  options: UseMessageReactionsOptions = {}
) {
  const { isOwnMessage = false } = options;
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [summaries, setSummaries] = useState<ReactionSummary[]>([]);
  const currentUserIdRef = useRef<string | null>(null);
  const pendingRef = useRef<Set<string>>(new Set());
  // Track which (emoji, userId) combos we've already notified for.
  const notifiedRef = useRef<Set<string>>(new Set());
  // Guard: skip notifications fired during initial load.
  const initialLoadDoneRef = useRef(false);

  useEffect(() => {
    currentUserIdRef.current = getCachedUser()?.id ?? null;
  }, []);

  // Initial fetch
  useEffect(() => {
    if (!messageId) {
      setReactions([]);
      setSummaries([]);
      initialLoadDoneRef.current = false;
      return;
    }

    initialLoadDoneRef.current = false;
    let cancelled = false;

    supabase
      .from('message_reactions')
      .select('id, message_id, user_id, emoji, created_at')
      .eq('message_id', messageId)
      .then(async ({ data }) => {
        if (cancelled || !data) return;
        const rows = data as MessageReaction[];
        // Pre-fetch all names so tooltip is ready immediately.
        const allIds = [...new Set(rows.map((r) => r.user_id))];
        await fetchNames(allIds);
        if (cancelled) return;
        // Seed notifiedRef so existing reactions don't re-notify.
        for (const r of rows) notifiedRef.current.add(r.emoji + ':' + r.user_id);
        setReactions(rows);
        setSummaries(aggregate(rows, currentUserIdRef.current));
        initialLoadDoneRef.current = true;
      });

    return () => { cancelled = true; };
  }, [messageId]);

  // Realtime subscription
  useEffect(() => {
    if (!messageId) return;

    const channel = supabase
      .channel(`reactions:${messageId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'message_reactions',
          filter: `message_id=eq.${messageId}`,
        },
        async (payload) => {
          const r = payload.new as MessageReaction;
          // Skip our own optimistic write
          if (pendingRef.current.has(r.emoji + ':' + r.user_id)) return;

          // Fetch name if needed, then re-render
          await fetchNames([r.user_id]);

          setReactions((prev) => {
            if (prev.some((x) => x.id === r.id)) return prev;
            const next = [...prev, r];
            setSummaries(aggregate(next, currentUserIdRef.current));
            return next;
          });

          // Notification: someone else reacted to our message
          const notifyKey = r.emoji + ':' + r.user_id;
          if (
            isOwnMessage &&
            initialLoadDoneRef.current &&
            r.user_id !== currentUserIdRef.current &&
            !notifiedRef.current.has(notifyKey)
          ) {
            notifiedRef.current.add(notifyKey);
            const reactorName = profileNameCache.get(r.user_id) ?? '…';
            toast.info(`${r.emoji} ${reactorName}`);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'message_reactions',
          filter: `message_id=eq.${messageId}`,
        },
        (payload) => {
          const old = payload.old as { id?: string; emoji?: string; user_id?: string };
          if (!old?.id) return;
          if (old.emoji && old.user_id && pendingRef.current.has(old.emoji + ':' + old.user_id)) return;
          // Remove from notified so future re-reactions can notify again
          if (old.emoji && old.user_id) {
            notifiedRef.current.delete(old.emoji + ':' + old.user_id);
          }
          setReactions((prev) => {
            const next = prev.filter((x) => x.id !== old.id);
            setSummaries(aggregate(next, currentUserIdRef.current));
            return next;
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [messageId, isOwnMessage]);

  const toggleReaction = useCallback(
    async (emoji: string): Promise<void> => {
      if (!messageId) return;
      const userId = currentUserIdRef.current ?? getCachedUser()?.id;
      if (!userId) return;

      const pendingKey = emoji + ':' + userId;
      const existingIdx = reactions.findIndex(
        (r) => r.emoji === emoji && r.user_id === userId
      );
      const isRemoving = existingIdx !== -1;

      pendingRef.current.add(pendingKey);
      if (isRemoving) {
        const removed = reactions[existingIdx];
        setReactions((prev) => {
          const next = prev.filter((r) => r.id !== removed.id);
          setSummaries(aggregate(next, userId));
          return next;
        });
        const { error } = await supabase
          .from('message_reactions')
          .delete()
          .eq('id', removed.id);
        pendingRef.current.delete(pendingKey);
        if (error) {
          setReactions((prev) => {
            const next = [...prev, removed];
            setSummaries(aggregate(next, userId));
            return next;
          });
        }
      } else {
        const optimistic: MessageReaction = {
          id: `opt-${Date.now()}`,
          message_id: messageId,
          user_id: userId,
          emoji,
          created_at: new Date().toISOString(),
        };
        // Ensure own name is in cache for tooltip
        await fetchNames([userId]);
        setReactions((prev) => {
          const next = [...prev, optimistic];
          setSummaries(aggregate(next, userId));
          return next;
        });
        recordRecentReactionEmoji(emoji);
        // Seed notified so the realtime echo doesn't double-toast
        notifiedRef.current.add(pendingKey);

        const { data, error } = await supabase
          .from('message_reactions')
          .upsert(
            { message_id: messageId, user_id: userId, emoji },
            { onConflict: 'message_id,user_id,emoji', ignoreDuplicates: false }
          )
          .select('id, message_id, user_id, emoji, created_at')
          .single();
        pendingRef.current.delete(pendingKey);
        if (error) {
          setReactions((prev) => {
            const next = prev.filter((r) => r.id !== optimistic.id);
            setSummaries(aggregate(next, userId));
            return next;
          });
        } else if (data) {
          setReactions((prev) => {
            const next = prev.map((r) =>
              r.id === optimistic.id ? (data as MessageReaction) : r
            );
            setSummaries(aggregate(next, userId));
            return next;
          });
        }
      }
    },
    [messageId, reactions]
  );

  return { summaries, toggleReaction };
}
