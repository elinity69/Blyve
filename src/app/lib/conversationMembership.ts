import { supabase } from './supabase';

const CACHE_TTL_MS = 15_000;
const DEFAULT_LIMIT = 200;

interface CacheEntry {
  userId: string;
  ids: string[];
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
let inFlight: Promise<string[]> | null = null;
let inFlightUserId: string | null = null;

export function invalidateConversationMembershipCache(userId?: string) {
  if (!userId || cache?.userId === userId) {
    cache = null;
  }
  if (!userId || inFlightUserId === userId) {
    inFlight = null;
    inFlightUserId = null;
  }
}

export function seedConversationIdsCache(userId: string, ids: string[]) {
  cache = { userId, ids: [...ids], fetchedAt: Date.now() };
}

/** Add a conversation id locally (e.g. chat opened) without refetching the full list. */
export function addConversationIdToCache(userId: string, conversationId: string): boolean {
  if (!cache || cache.userId !== userId) return false;
  if (cache.ids.includes(conversationId)) return false;
  cache.ids = [conversationId, ...cache.ids];
  return true;
}

export async function fetchConversationIds(
  userId: string,
  options?: { limit?: number; force?: boolean }
): Promise<string[]> {
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const force = options?.force ?? false;
  const now = Date.now();

  if (
    !force &&
    cache &&
    cache.userId === userId &&
    now - cache.fetchedAt < CACHE_TTL_MS
  ) {
    return cache.ids.slice(0, limit);
  }

  if (inFlight && inFlightUserId === userId && !force) {
    const ids = await inFlight;
    return ids.slice(0, limit);
  }

  inFlightUserId = userId;
  inFlight = (async () => {
    const { data, error } = await supabase
      .from('conversations')
      .select('id')
      .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
      .order('updated_at', { ascending: false })
      .limit(DEFAULT_LIMIT);

    if (error) throw error;

    const ids = (data || []).map((row) => row.id);
    cache = { userId, ids, fetchedAt: Date.now() };
    return ids;
  })();

  try {
    const ids = await inFlight;
    return ids.slice(0, limit);
  } finally {
    inFlight = null;
    inFlightUserId = null;
  }
}
