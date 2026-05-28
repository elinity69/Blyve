import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface GroupTyper {
  userId: string;
  displayName: string;
}

type GroupTypingListener = (typers: GroupTyper[]) => void;

interface TyperState {
  displayName: string;
  timeoutId: number | null;
}

interface ChannelEntry {
  channel: RealtimeChannel;
  listeners: Set<GroupTypingListener>;
  typers: Map<string, TyperState>;
  ready: Promise<void>;
}

const channels = new Map<string, ChannelEntry>();
const TYPER_IDLE_MS = 3500;

function channelKey(groupId: string, channelId: string): string {
  return `${groupId}:${channelId}`;
}

function listTypers(entry: ChannelEntry): GroupTyper[] {
  return [...entry.typers.entries()].map(([userId, state]) => ({
    userId,
    displayName: state.displayName,
  }));
}

function notify(groupId: string, channelId: string) {
  const entry = channels.get(channelKey(groupId, channelId));
  if (!entry) return;

  const typers = listTypers(entry);
  window.dispatchEvent(
    new CustomEvent('group-typing-status-changed', {
      detail: { groupId, channelId, typers },
    })
  );

  for (const listener of entry.listeners) {
    listener(typers);
  }
}

function clearTyperTimeout(state: TyperState) {
  if (state.timeoutId) {
    window.clearTimeout(state.timeoutId);
    state.timeoutId = null;
  }
}

function removeTyper(groupId: string, channelId: string, userId: string) {
  const entry = channels.get(channelKey(groupId, channelId));
  if (!entry) return;

  const state = entry.typers.get(userId);
  if (!state) return;

  clearTyperTimeout(state);
  entry.typers.delete(userId);
  notify(groupId, channelId);
}

function scheduleTyperStop(groupId: string, channelId: string, userId: string) {
  const entry = channels.get(channelKey(groupId, channelId));
  if (!entry) return;

  const state = entry.typers.get(userId);
  if (!state) return;

  clearTyperTimeout(state);
  state.timeoutId = window.setTimeout(() => {
    removeTyper(groupId, channelId, userId);
  }, TYPER_IDLE_MS);
}

function setTyper(
  groupId: string,
  channelId: string,
  userId: string,
  displayName: string,
  typing: boolean
) {
  const entry = channels.get(channelKey(groupId, channelId));
  if (!entry) return;

  if (typing) {
    const existing = entry.typers.get(userId);
    if (existing) {
      existing.displayName = displayName;
      scheduleTyperStop(groupId, channelId, userId);
    } else {
      entry.typers.set(userId, { displayName, timeoutId: null });
      scheduleTyperStop(groupId, channelId, userId);
    }
    notify(groupId, channelId);
    return;
  }

  removeTyper(groupId, channelId, userId);
}

function destroyChannel(groupId: string, channelId: string) {
  const key = channelKey(groupId, channelId);
  const entry = channels.get(key);
  if (!entry) return;

  for (const state of entry.typers.values()) {
    if (state.timeoutId) {
      window.clearTimeout(state.timeoutId);
    }
  }
  entry.typers.clear();
  supabase.removeChannel(entry.channel);
  channels.delete(key);
}

function ensureChannel(groupId: string, channelId: string): ChannelEntry {
  const key = channelKey(groupId, channelId);
  const existing = channels.get(key);
  if (existing) {
    const state = existing.channel.state;
    if (state === 'closed' || state === 'errored') {
      supabase.removeChannel(existing.channel);
      channels.delete(key);
    } else {
      return existing;
    }
  }

  const channel = supabase.channel(`group-typing:${groupId}:${channelId}`, {
    config: { broadcast: { self: false } },
  });

  const entry: ChannelEntry = {
    channel,
    listeners: new Set(),
    typers: new Map(),
    ready: Promise.resolve(),
  };

  channel.on('broadcast', { event: 'typing' }, ({ payload }) => {
    const data = payload as {
      user_id?: string;
      display_name?: string;
      typing?: boolean;
    } | undefined;
    if (!data?.user_id || data.typing == null) return;

    const name = String(data.display_name || '').trim() || 'Someone';
    setTyper(groupId, channelId, data.user_id, name, data.typing);
  });

  entry.ready = new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve();
    });
  });

  channels.set(key, entry);
  return entry;
}

export function subscribeGroupTypingBroadcast(
  groupId: string,
  channelId: string,
  listener: GroupTypingListener
): () => void {
  const entry = ensureChannel(groupId, channelId);
  entry.listeners.add(listener);
  listener(listTypers(entry));

  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0) {
      destroyChannel(groupId, channelId);
    }
  };
}

export async function publishGroupTypingBroadcast(
  groupId: string,
  channelId: string,
  userId: string,
  displayName: string,
  typing: boolean
) {
  const entry = ensureChannel(groupId, channelId);
  await entry.ready;

  await entry.channel.send({
    type: 'broadcast',
    event: 'typing',
    payload: {
      user_id: userId,
      display_name: displayName,
      typing,
    },
  });
}

export function formatGroupTypingLabel(
  names: string[],
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (names.length === 0) return '';
  if (names.length === 1) return t('groups.typingOne', { name: names[0] });
  if (names.length === 2) {
    return t('groups.typingTwo', { name1: names[0], name2: names[1] });
  }
  return t('groups.typingMany', { names: names.join(', ') });
}
