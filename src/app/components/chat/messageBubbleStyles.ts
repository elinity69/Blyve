import type { MessageGroupPosition } from '../../lib/messageGrouping';

export function getMessageBubbleRadius(
  position: MessageGroupPosition,
  isMe: boolean
): string {
  if (isMe) {
    switch (position) {
      case 'single':
        return 'rounded-[14px] rounded-br-[5px]';
      case 'start':
        return 'rounded-[14px] rounded-br-[8px]';
      case 'middle':
        return 'rounded-[14px] rounded-tr-[8px] rounded-br-[8px]';
      case 'end':
        return 'rounded-[14px] rounded-tr-[8px] rounded-br-[5px]';
    }
  }

  switch (position) {
    case 'single':
      return 'rounded-[14px] rounded-bl-[5px]';
    case 'start':
      return 'rounded-[14px] rounded-bl-[8px]';
    case 'middle':
      return 'rounded-[14px] rounded-tl-[8px] rounded-bl-[8px]';
    case 'end':
      return 'rounded-[14px] rounded-tl-[8px] rounded-bl-[5px]';
  }
}

export function getMessageBubbleColors(isMe: boolean): string {
  if (isMe) {
    return 'bg-[#3faf95] text-white dark:bg-[var(--chat-bubble-me,#243752)] dark:text-[var(--chat-bubble-me-text,#dce6ef)]';
  }
  return 'bg-[#e8eaed] text-gray-900 dark:bg-[var(--chat-bubble-other,#1a222d)] dark:text-[var(--chat-bubble-other-text,#b4c0cc)]';
}

export function getMessageBubbleTailClass(position: MessageGroupPosition, isMe: boolean): string {
  if (position !== 'single' && position !== 'end') return '';
  return isMe ? 'message-bubble-tail-me' : 'message-bubble-tail-other';
}
