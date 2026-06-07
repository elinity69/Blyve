import { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

type TypingListener = (isPartnerTyping: boolean) => void;

interface ChannelEntry {
  channel: RealtimeChannel;
  listeners: Set<TypingListener>;
  partnerTyping: boolean;
  partnerTimeoutId: number | null;
  ready: Promise<void>;
}

const channels = new Map<string, ChannelEntry>();
const PARTNER_IDLE_MS = 3500;

function destroyChannel(conversationId: string) {
  const entry = channels.get(conversationId);
  if (!entry) return;

  if (entry.partnerTimeoutId) {
    window.clearTimeout(entry.partnerTimeoutId);
    entry.partnerTimeoutId = null;
  }

  // If partner was typing when the channel is torn down, clear the preview state.
  if (entry.partnerTyping) {
    window.dispatchEvent(
      new CustomEvent('typing-status-changed', {
        detail: { conversationId, isTyping: false },
      })
    );
  }

  supabase.removeChannel(entry.channel);
  channels.delete(conversationId);
}

function notify(conversationId: string, isTyping: boolean) {
  const entry = channels.get(conversationId);
  if (!entry || entry.partnerTyping === isTyping) return;

  entry.partnerTyping = isTyping;
  window.dispatchEvent(
    new CustomEvent('typing-status-changed', {
      detail: { conversationId, isTyping },
    })
  );

  for (const listener of entry.listeners) {
    listener(isTyping);
  }
}

function schedulePartnerStop(conversationId: string) {
  const entry = channels.get(conversationId);
  if (!entry) return;

  if (entry.partnerTimeoutId) {
    window.clearTimeout(entry.partnerTimeoutId);
  }

  entry.partnerTimeoutId = window.setTimeout(() => {
    notify(conversationId, false);
  }, PARTNER_IDLE_MS);
}

function ensureChannel(conversationId: string): ChannelEntry {
  const existing = channels.get(conversationId);
  if (existing) {
    const state = existing.channel.state;
    if (state === 'closed' || state === 'errored') {
      supabase.removeChannel(existing.channel);
      channels.delete(conversationId);
    } else {
      return existing;
    }
  }

  const channel = supabase.channel(`typing:${conversationId}`, {
    config: { broadcast: { self: false } },
  });

  const entry: ChannelEntry = {
    channel,
    listeners: new Set(),
    partnerTyping: false,
    partnerTimeoutId: null,
    ready: Promise.resolve(),
  };

  channel.on('broadcast', { event: 'typing' }, ({ payload }) => {
    const data = payload as { user_id?: string; typing?: boolean } | undefined;
    if (!data?.user_id || data.typing == null) return;

    if (data.typing) {
      notify(conversationId, true);
      schedulePartnerStop(conversationId);
    } else {
      if (entry.partnerTimeoutId) {
        window.clearTimeout(entry.partnerTimeoutId);
        entry.partnerTimeoutId = null;
      }
      notify(conversationId, false);
    }
  });

  entry.ready = new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve();
    });
  });

  channels.set(conversationId, entry);
  return entry;
}

export function subscribeTypingBroadcast(
  conversationId: string,
  listener: TypingListener
): () => void {
  const entry = ensureChannel(conversationId);
  entry.listeners.add(listener);
  listener(entry.partnerTyping);

  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0) {
      destroyChannel(conversationId);
    }
  };
}

export async function publishTypingBroadcast(
  conversationId: string,
  userId: string,
  typing: boolean
) {
  const entry = ensureChannel(conversationId);
  await entry.ready;

  await entry.channel.send({
    type: 'broadcast',
    event: 'typing',
    payload: { user_id: userId, typing },
  });
}
