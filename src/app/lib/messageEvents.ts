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

let lastUnreadRefreshDispatchAt = 0;

export function dispatchUnreadRefreshRequest() {
  const now = Date.now();
  if (now - lastUnreadRefreshDispatchAt < 400) {
    return;
  }
  lastUnreadRefreshDispatchAt = now;
  window.dispatchEvent(new CustomEvent('unread-refresh-requested'));
}
