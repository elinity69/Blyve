/** Shared chat message styles (DM + group) — grouped bubble layout. */
export const CHAT_MESSAGE_LIST_CLASS =
  'min-h-0 flex-1 max-w-full overflow-x-hidden overflow-y-auto overflow-anchor-none overscroll-y-contain blyve-screen-bg px-2 pt-2 pb-1 scroll-pb-2';

/** Extra space below the list when a typing bubble sits above the composer. */
export const CHAT_TYPING_CLEARANCE_EXTRA_PX = 4;
/** Space above a new group; no bottom margin so follow-ups stay tight. */
export const CHAT_MESSAGE_ROW_CLASS = 'w-full mt-2 mb-0 px-0.5';
/** Extra space when the previous message was from someone else. */
export const CHAT_MESSAGE_ROW_NEW_SENDER_CLASS = 'w-full mt-3.5 mb-0 px-0.5';
export const CHAT_MESSAGE_ROW_GROUPED_CLASS = 'w-full mt-0.5 mb-0 px-0.5';
export const CHAT_MESSAGE_ROW_INNER_CLASS = 'flex w-full items-end gap-2';
export const CHAT_MESSAGE_ROW_INNER_GROUPED_CLASS = 'flex w-full items-end gap-2';
export const CHAT_MESSAGE_BUBBLE_TEXT_CLASS =
  'text-[15px] leading-[1.3] whitespace-pre-wrap break-words';
export const CHAT_MESSAGE_BUBBLE_TEXT_GROUPED_CLASS =
  'text-[15px] leading-[1.25] whitespace-pre-wrap break-words';

export function getChatMessageRowClass(
  isGroupStart: boolean,
  isNewSender: boolean
): string {
  if (!isGroupStart) return CHAT_MESSAGE_ROW_GROUPED_CLASS;
  if (isNewSender) return CHAT_MESSAGE_ROW_NEW_SENDER_CLASS;
  return CHAT_MESSAGE_ROW_CLASS;
}
