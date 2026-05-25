export interface ReadReceiptMessage {
  sender_id: string;
  read_at?: string | null;
  is_read?: boolean | null;
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
