import type { QueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { api } from './api';
import { createPrefetchRegistry } from './requestThrottle';
import type { Message } from '../hooks/useChat';

const dmPrefetchRegistry = createPrefetchRegistry();
const groupChannelsPrefetchRegistry = createPrefetchRegistry();
const groupMessagesPrefetchRegistry = createPrefetchRegistry();

const PREFETCH_STALE_MS = 1000 * 60 * 10;

export const DM_MESSAGES_PAGE_SIZE = 50;

const MESSAGE_COLUMNS =
  'id, conversation_id, sender_id, content, created_at, is_read, read_at, reply_to_message_id';

export const dmMessagesQueryKey = (conversationId: string) =>
  ['messages', conversationId] as const;

export function applyReadStateToDmMessages(
  messages: Message[],
  conversationId: string,
  readerUserId: string,
  readAt: string
): Message[] {
  return messages.map((message) =>
    message.conversation_id === conversationId &&
    message.sender_id !== readerUserId &&
    !message.is_read
      ? { ...message, is_read: true, read_at: readAt }
      : message
  );
}

export function mergeDmMessagesById(existing: Message[], incoming: Message[]): Message[] {
  if (!incoming.length) return existing;
  if (!existing.length) return incoming;

  const byId = new Map<string, Message>();
  for (const message of existing) {
    byId.set(message.id, message);
  }
  for (const message of incoming) {
    byId.set(message.id, message);
  }

  return Array.from(byId.values()).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

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
  const key = `dm:${conversationId}`;
  if (dmPrefetchRegistry.has(key)) {
    return Promise.resolve();
  }
  dmPrefetchRegistry.run(key, () => {});
  return queryClient.prefetchQuery({
    queryKey: dmMessagesQueryKey(conversationId),
    queryFn: () => fetchDmMessages(conversationId),
    staleTime: PREFETCH_STALE_MS,
  });
}

/** Force a network fetch when opening a chat (toast, list tap, etc.). */
export async function ensureFreshDmMessages(
  queryClient: QueryClient,
  conversationId: string,
): Promise<Message[]> {
  dmPrefetchRegistry.clearKey(`dm:${conversationId}`);
  await queryClient.invalidateQueries({ queryKey: dmMessagesQueryKey(conversationId) });
  return queryClient.fetchQuery({
    queryKey: dmMessagesQueryKey(conversationId),
    queryFn: () => fetchDmMessages(conversationId),
    staleTime: 0,
  });
}

export function appendDmMessageToCache(
  queryClient: QueryClient,
  message: Message,
): void {
  queryClient.setQueryData<Message[]>(dmMessagesQueryKey(message.conversation_id), (cached) => {
    if (!cached?.length) return cached;
    if (cached.some((row) => row.id === message.id)) return cached;
    return mergeDmMessagesById(cached, [message]);
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
  const key = `group-msg:${groupId}:${channelId}`;
  if (groupMessagesPrefetchRegistry.has(key)) {
    return Promise.resolve();
  }
  groupMessagesPrefetchRegistry.run(key, () => {});
  return queryClient.prefetchQuery({
    queryKey: groupMessagesQueryKey(groupId, channelId),
    queryFn: () => fetchGroupChannelMessages(groupId, channelId),
    staleTime: PREFETCH_STALE_MS,
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
  const key = `group-ch:${groupId}`;
  if (groupChannelsPrefetchRegistry.has(key)) {
    return;
  }
  groupChannelsPrefetchRegistry.run(key, () => {});
  await queryClient.prefetchQuery({
    queryKey: groupChannelsQueryKey(groupId),
    queryFn: () => fetchGroupChannels(groupId),
    staleTime: PREFETCH_STALE_MS,
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
