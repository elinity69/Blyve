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

export function dispatchUnreadRefreshRequest() {
  window.dispatchEvent(new CustomEvent('unread-refresh-requested'));
}
