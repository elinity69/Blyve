import { supabase } from './supabase';

export async function fetchConversationLastViewedAt(
  conversationId: string,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('conversation_views')
    .select('last_viewed_at')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.warn('fetchConversationLastViewedAt:', error.message);
    return null;
  }

  return data?.last_viewed_at ?? null;
}

export async function upsertConversationLastViewedAt(
  conversationId: string,
  userId: string,
  lastViewedAt: string,
): Promise<void> {
  const { error } = await supabase.from('conversation_views').upsert(
    {
      user_id: userId,
      conversation_id: conversationId,
      last_viewed_at: lastViewedAt,
    },
    { onConflict: 'conversation_id,user_id' },
  );

  if (error) {
    console.warn('upsertConversationLastViewedAt:', error.message);
  }
}
