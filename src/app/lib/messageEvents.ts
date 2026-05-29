export interface MessageEventPayload {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

export function dispatchConversationPreviewUpdate(
  conversationId: string,
  content: string,
  created_at: string
) {
  window.dispatchEvent(
    new CustomEvent('conversation-preview-update', {
      detail: { conversationId, content, created_at },
    })
  );
}

/** Reload the DM conversation list (new chats, membership changes). */
export function dispatchConversationListReloadRequested() {
  window.dispatchEvent(new CustomEvent('conversation-list-reload-requested'));
}

import { NotificationManager } from './notifications';

let lastUnreadRefreshDispatchAt = 0;
let lastUnreadClearDispatchAt = 0;

/** Optimistically zero a conversation in UnreadContext (no server refetch). */
export function dispatchConversationUnreadCleared(conversationId: string) {
  const now = Date.now();
  if (now - lastUnreadClearDispatchAt < 100) {
    return;
  }
  lastUnreadClearDispatchAt = now;
  window.dispatchEvent(
    new CustomEvent('conversation-unread-cleared', {
      detail: { conversationId },
    })
  );
}

export function dispatchUnreadRefreshRequest(options?: {
  /** While this DM is open: clear local unread only (no list refetch — avoids loops). */
  exceptConversationId?: string;
}) {
  if (
    options?.exceptConversationId &&
    NotificationManager.getActiveConversationId() === options.exceptConversationId
  ) {
    dispatchConversationUnreadCleared(options.exceptConversationId);
    return;
  }

  const now = Date.now();
  if (now - lastUnreadRefreshDispatchAt < 400) {
    return;
  }
  lastUnreadRefreshDispatchAt = now;
  window.dispatchEvent(new CustomEvent('unread-refresh-requested'));
}
