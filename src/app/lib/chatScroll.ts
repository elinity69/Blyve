/** Shared threshold for “stuck to bottom” across chat scroll helpers. */
export const CHAT_NEAR_BOTTOM_PX = 96;

interface ScrollTargetMessage {
  id: string;
  sender_id: string;
  created_at: string;
  is_read?: boolean | null;
}

/** Scroll until scrollHeight stabilizes (images, embeds, fonts). */
export function scrollContainerToBottomStable(
  container: HTMLElement,
  maxFrames = 12,
): void {
  let frames = 0;
  let lastHeight = -1;

  const tick = () => {
    const height = container.scrollHeight;
    container.scrollTop = height;

    if (height !== lastHeight && frames < maxFrames) {
      lastHeight = height;
      frames += 1;
      requestAnimationFrame(tick);
      return;
    }

    const endMarker = container.querySelector('[data-chat-scroll-end]');
    if (endMarker instanceof HTMLElement) {
      endMarker.scrollIntoView({ block: 'end', behavior: 'auto' });
    }
  };

  requestAnimationFrame(tick);
}

export function scrollContainerToMessage(
  container: HTMLElement,
  messageId: string,
): boolean {
  const target = container.querySelector(`[data-message-id="${messageId}"]`);
  if (!(target instanceof HTMLElement)) return false;
  target.scrollIntoView({ block: 'start', behavior: 'auto' });
  return true;
}

export function findFirstUnreadMessageId(
  messages: ScrollTargetMessage[],
  currentUserId: string,
  lastViewedAt: string | null | undefined,
): string | null {
  const viewedMs = lastViewedAt ? new Date(lastViewedAt).getTime() : 0;

  for (const message of messages) {
    if (message.sender_id === currentUserId) continue;
    if (!message.is_read) return message.id;
    if (lastViewedAt && new Date(message.created_at).getTime() > viewedMs) {
      return message.id;
    }
  }

  return null;
}

export function isNearBottom(
  container: HTMLElement,
  thresholdPx = CHAT_NEAR_BOTTOM_PX,
): boolean {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight < thresholdPx
  );
}
