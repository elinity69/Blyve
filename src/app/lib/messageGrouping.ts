/** Discord-style message grouping (same sender, within time window, no reply break). */
const GROUP_TIME_GAP_MS = 7 * 60 * 1000;

export interface GroupableMessage {
  sender_id: string;
  created_at: string;
  reply_to_message_id?: string | null;
}

export function isMessageGroupStart(
  current: GroupableMessage,
  prev: GroupableMessage | null
): boolean {
  if (!prev) return true;
  if (prev.sender_id !== current.sender_id) return true;
  if (current.reply_to_message_id) return true;
  const gap =
    new Date(current.created_at).getTime() - new Date(prev.created_at).getTime();
  return gap > GROUP_TIME_GAP_MS;
}

/** True when this row starts a block from a different sender than the previous message. */
export function isNewSenderGroupStart(
  current: GroupableMessage,
  prev: GroupableMessage | null
): boolean {
  return !!prev && prev.sender_id !== current.sender_id;
}

export function isMessageGroupEnd(
  current: GroupableMessage,
  next: GroupableMessage | null
): boolean {
  if (!next) return true;
  return isMessageGroupStart(next, current);
}

/** True when this row is part of a multi-message bundle (tight spacing). */
export function isMessageBundled(
  current: GroupableMessage,
  prev: GroupableMessage | null,
  next: GroupableMessage | null
): boolean {
  return !isMessageGroupEnd(current, next) || !isMessageGroupStart(current, prev);
}

export type MessageGroupPosition = 'single' | 'start' | 'middle' | 'end';

export function getMessageGroupPosition(
  current: GroupableMessage,
  prev: GroupableMessage | null,
  next: GroupableMessage | null
): MessageGroupPosition {
  const start = isMessageGroupStart(current, prev);
  const end = isMessageGroupEnd(current, next);
  if (start && end) return 'single';
  if (start) return 'start';
  if (end) return 'end';
  return 'middle';
}

export function formatMessageTime(
  iso: string,
  locale: string,
  hour12: boolean
): string {
  return new Date(iso).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12,
  });
}
