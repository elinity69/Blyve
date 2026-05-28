export interface ReadReceiptMessage {
  sender_id: string;
  read_at?: string | null;
  is_read?: boolean | null;
}

/** True when a realtime/db UPDATE only changed read receipt fields. */
export function isMessageReadReceiptUpdate(
  oldRow: Record<string, unknown> | null | undefined,
  newRow: Record<string, unknown> | null | undefined
): boolean {
  if (!oldRow || !newRow) return false;

  const stableKeys = [
    'content',
    'sender_id',
    'conversation_id',
    'created_at',
    'reply_to_message_id',
  ] as const;

  for (const key of stableKeys) {
    if (oldRow[key] !== newRow[key]) return false;
  }

  return oldRow.is_read !== newRow.is_read || oldRow.read_at !== newRow.read_at;
}

export function hasUnreadMessagesFromOthers(
  messages: ReadReceiptMessage[],
  currentUserId: string | null | undefined
): boolean {
  if (!currentUserId) return false;
  return messages.some(
    (message) => message.sender_id !== currentUserId && !message.is_read && !message.read_at
  );
}

/** If the last own message is read, all earlier own messages count as read too. */
export function isOutgoingMessageRead(
  message: ReadReceiptMessage,
  messages: ReadReceiptMessage[],
  currentUserId: string
): boolean {
  if (message.sender_id !== currentUserId) return false;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const lastOwn = messages[i];
    if (lastOwn.sender_id !== currentUserId) continue;
    if (lastOwn.read_at || lastOwn.is_read) return true;
    break;
  }

  return !!(message.read_at || message.is_read);
}
