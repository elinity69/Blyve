import type { QueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { api } from './api';
import type { Message } from '../hooks/useChat';

export const DM_MESSAGES_PAGE_SIZE = 50;

const MESSAGE_COLUMNS =
  'id, conversation_id, sender_id, content, created_at, is_read, read_at, reply_to_message_id';

export const dmMessagesQueryKey = (conversationId: string) =>
  ['messages', conversationId] as const;

export async function fetchDmMessages(
  conversationId: string,
  pageSize = DM_MESSAGES_PAGE_SIZE
): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(pageSize);

  if (error) throw error;
  return (data || []).slice().reverse() as Message[];
}

export function prefetchDmMessages(
  queryClient: QueryClient,
  conversationId: string
): Promise<void> {
  return queryClient.prefetchQuery({
    queryKey: dmMessagesQueryKey(conversationId),
    queryFn: () => fetchDmMessages(conversationId),
    staleTime: 60_000,
  });
}

export const groupMessagesQueryKey = (groupId: string, channelId: string) =>
  ['groupMessages', groupId, channelId] as const;

export async function fetchGroupChannelMessages(groupId: string, channelId: string) {
  const data = await api.getGroupMessages(groupId, channelId);
  return (data?.messages || []) as Record<string, unknown>[];
}

export function prefetchGroupChannelMessages(
  queryClient: QueryClient,
  groupId: string,
  channelId: string
): Promise<void> {
  return queryClient.prefetchQuery({
    queryKey: groupMessagesQueryKey(groupId, channelId),
    queryFn: () => fetchGroupChannelMessages(groupId, channelId),
    staleTime: 60_000,
  });
}

export function prefetchRecentDmMessages(
  queryClient: QueryClient,
  conversationIds: string[],
  limit = 5
): void {
  for (const conversationId of conversationIds.slice(0, limit)) {
    void prefetchDmMessages(queryClient, conversationId);
  }
}

export interface GroupChannelListItem {
  id: string;
  group_id: string;
  name: string;
  position: number;
  type?: 'text' | 'voice';
  icon_url?: string | null;
}

export const groupChannelsQueryKey = (groupId: string) =>
  ['groupChannels', groupId] as const;

export async function fetchGroupChannels(groupId: string): Promise<GroupChannelListItem[]> {
  const data = await api.getGroupChannels(groupId);
  return (data?.channels || []) as GroupChannelListItem[];
}

export async function prefetchGroupChannels(
  queryClient: QueryClient,
  groupId: string
): Promise<void> {
  await queryClient.prefetchQuery({
    queryKey: groupChannelsQueryKey(groupId),
    queryFn: () => fetchGroupChannels(groupId),
    staleTime: 60_000,
  });

  const channels =
    queryClient.getQueryData<GroupChannelListItem[]>(groupChannelsQueryKey(groupId)) ?? [];
  for (const channel of channels.filter((ch) => (ch.type ?? 'text') === 'text').slice(0, 3)) {
    void prefetchGroupChannelMessages(queryClient, groupId, channel.id);
  }
}

export function prefetchAllGroupChannels(
  queryClient: QueryClient,
  groupIds: string[]
): void {
  for (const groupId of groupIds) {
    void prefetchGroupChannels(queryClient, groupId);
  }
}
