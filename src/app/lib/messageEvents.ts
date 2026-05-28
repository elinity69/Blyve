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

import { NotificationManager } from './notifications';

let lastUnreadRefreshDispatchAt = 0;

export function dispatchUnreadRefreshRequest(options?: {
  /** Skip list-wide unread refetch while this DM is open (prevents remount/refetch loops). */
  exceptConversationId?: string;
}) {
  if (
    options?.exceptConversationId &&
    NotificationManager.getActiveConversationId() === options.exceptConversationId
  ) {
    return;
  }

  const now = Date.now();
  if (now - lastUnreadRefreshDispatchAt < 400) {
    return;
  }
  lastUnreadRefreshDispatchAt = now;
  window.dispatchEvent(new CustomEvent('unread-refresh-requested'));
}
