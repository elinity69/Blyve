export interface ReplyTarget {
  id: string;
  content: string;
  senderId: string;
  senderLabel: string;
}

export interface ReplyQuoteData {
  senderLabel: string;
  content: string;
  messageId: string;
}

export function truncateReplyPreview(content: string, max = 120): string {
  const normalized = content.trim().replace(/\s+/g, ' ');
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}

export function buildReplyTarget(
  message: { id: string; content: string; sender_id: string },
  senderLabel: string
): ReplyTarget {
  return {
    id: message.id,
    content: truncateReplyPreview(message.content),
    senderId: message.sender_id,
    senderLabel,
  };
}

export function resolveReplyQuote<T extends { id: string; content: string; sender_id: string }>(
  replyToMessageId: string | null | undefined,
  messages: T[],
  getSenderLabel: (senderId: string, message?: T) => string,
  fallbackLabel: string
): ReplyQuoteData | null {
  if (!replyToMessageId) return null;
  const parent = messages.find((m) => m.id === replyToMessageId);
  if (!parent) {
    return {
      messageId: replyToMessageId,
      senderLabel: fallbackLabel,
      content: '',
    };
  }
  return {
    messageId: parent.id,
    senderLabel: getSenderLabel(parent.sender_id, parent),
    content: truncateReplyPreview(parent.content),
  };
}

export function scrollToMessage(messageId: string): void {
  const el = document.querySelector(`[data-message-id="${messageId}"]`);
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-orange-500/60', 'rounded-xl');
    window.setTimeout(() => {
      el.classList.remove('ring-2', 'ring-orange-500/60', 'rounded-xl');
    }, 1200);
  }
}
