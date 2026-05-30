export interface ReadReceiptMessage {
  id?: string;
  sender_id: string;
  created_at: string;
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

export function getUnreadMessageIdsFromOthers(
  messages: ReadReceiptMessage[],
  currentUserId: string | null | undefined
): string[] {
  if (!currentUserId) return [];
  return messages
    .filter(
      (message) =>
        message.sender_id !== currentUserId && !message.is_read && !message.read_at
    )
    .map((message) => message.id!)
    .filter(Boolean)
    .sort();
}

export function getUnreadBatchKey(
  messages: ReadReceiptMessage[],
  currentUserId: string | null | undefined
): string {
  return getUnreadMessageIdsFromOthers(messages, currentUserId).join(',');
}

export function hasUnreadMessagesFromOthers(
  messages: ReadReceiptMessage[],
  currentUserId: string | null | undefined
): boolean {
  return getUnreadMessageIdsFromOthers(messages, currentUserId).length > 0;
}

function readReceiptMs(message: ReadReceiptMessage): number {
  if (message.read_at) {
    const ms = new Date(message.read_at).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  if (message.is_read) {
    const ms = new Date(message.created_at).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}

/** Latest read receipt timestamp among own messages (for “Gelesen” label). */
export function getLatestOwnReadAt(
  messages: ReadReceiptMessage[],
  currentUserId: string
): string | null {
  let bestMs = 0;
  let bestAt: string | null = null;

  for (const message of messages) {
    if (message.sender_id !== currentUserId) continue;
    const ms = readReceiptMs(message);
    if (ms > bestMs) {
      bestMs = ms;
      bestAt = message.read_at ?? message.created_at;
    }
  }

  return bestAt;
}

/** Own messages at or before the latest read receipt count as read. */
export function isOutgoingMessageRead(
  message: ReadReceiptMessage,
  messages: ReadReceiptMessage[],
  currentUserId: string
): boolean {
  if (message.sender_id !== currentUserId) return false;

  let latestReadMs = 0;
  for (const row of messages) {
    if (row.sender_id !== currentUserId) continue;
    latestReadMs = Math.max(latestReadMs, readReceiptMs(row));
  }

  if (latestReadMs === 0) return false;

  const messageMs = new Date(message.created_at).getTime();
  return !Number.isNaN(messageMs) && messageMs <= latestReadMs;
}
