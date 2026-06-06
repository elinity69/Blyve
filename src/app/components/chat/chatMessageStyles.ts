/** Shared chat message styles (DM + group) — grouped bubble layout. */
export const CHAT_MESSAGE_LIST_CLASS =
  'min-h-0 flex-1 max-w-full overflow-x-hidden overflow-y-auto overflow-anchor-none overscroll-y-contain blyve-screen-bg px-2 pt-2 pb-3 scroll-pb-3';

/** Gap between the last message bubble and the typing indicator. */
export const CHAT_TYPING_CLEARANCE_EXTRA_PX = 12;

/** Total vertical space to reserve when a typing indicator is visible. */
export function measureTypingIndicatorClearance(element: HTMLElement): number {
  const style = getComputedStyle(element);
  const marginTop = parseFloat(style.marginTop) || 0;
  const marginBottom = parseFloat(style.marginBottom) || 0;
  const height = element.getBoundingClientRect().height;
  return Math.ceil(height + marginTop + marginBottom + CHAT_TYPING_CLEARANCE_EXTRA_PX);
}
/** Space above a new group; no bottom margin so follow-ups stay tight. */
export const CHAT_MESSAGE_ROW_CLASS = 'w-full mt-2 mb-0 px-0.5';
/** Extra space when the previous message was from someone else. */
export const CHAT_MESSAGE_ROW_NEW_SENDER_CLASS = 'w-full mt-3.5 mb-0 px-0.5';
export const CHAT_MESSAGE_ROW_GROUPED_CLASS = 'w-full mt-0.5 mb-0 px-0.5';
export const CHAT_MESSAGE_ROW_INNER_CLASS = 'flex w-full items-end gap-2';
export const CHAT_MESSAGE_ROW_INNER_GROUPED_CLASS = 'flex w-full items-end gap-2';
export const CHAT_MESSAGE_BUBBLE_TEXT_CLASS =
  'max-w-full text-[15px] leading-[1.3] whitespace-pre-wrap break-words [overflow-wrap:anywhere]';
export const CHAT_MESSAGE_BUBBLE_TEXT_GROUPED_CLASS =
  'max-w-full text-[15px] leading-[1.25] whitespace-pre-wrap break-words [overflow-wrap:anywhere]';

/** Bubble width cap (fixed rem — never use max-w-full / % here; flex parents are ~500px+ wide). */
export const CHAT_MESSAGE_BUBBLE_MAX_WIDTH_CLASS = 'max-w-80';
/** Shrink-wrap to content, capped at 20rem (MessageBubble root). */
export const CHAT_MESSAGE_BUBBLE_SHELL_CLASS = `relative w-max min-w-[3rem] ${CHAT_MESSAGE_BUBBLE_MAX_WIDTH_CLASS}`;
/** Context-menu target: no box of its own — avoids an extra full-width block in the row. */
export const CHAT_MESSAGE_BUBBLE_CONTEXT_TARGET_CLASS = 'contents';
/** Stacked quote + bubble + footer (voice/media). */
export const CHAT_MESSAGE_BODY_STACK_CLASS = `flex w-max flex-col ${CHAT_MESSAGE_BUBBLE_MAX_WIDTH_CLASS}`;
/** Align bubble + reply control to the correct side inside the full-width message column. */
export const CHAT_MESSAGE_BUBBLE_ROW_ALIGN_CLASS = 'flex w-full min-w-0';

export function getChatMessageRowClass(
  isGroupStart: boolean,
  isNewSender: boolean
): string {
  if (!isGroupStart) return CHAT_MESSAGE_ROW_GROUPED_CLASS;
  if (isNewSender) return CHAT_MESSAGE_ROW_NEW_SENDER_CLASS;
  return CHAT_MESSAGE_ROW_CLASS;
}

export function getChatMessageBubbleRowAlignClass(isMe: boolean): string {
  return `${CHAT_MESSAGE_BUBBLE_ROW_ALIGN_CLASS} ${isMe ? 'justify-end' : 'justify-start'}`;
}
