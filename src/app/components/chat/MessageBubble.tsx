import React from 'react';
import { CheckCheck } from 'lucide-react';
import type { MessageGroupPosition } from '../../lib/messageGrouping';
import {
  getMessageBubbleColors,
  getMessageBubbleRadius,
  getMessageBubbleTailClass,
} from './messageBubbleStyles';

interface MessageBubbleProps {
  position: MessageGroupPosition;
  isMe: boolean;
  time?: string;
  isRead?: boolean;
  children: React.ReactNode;
}

export function MessageBubble({
  position,
  isMe,
  time,
  isRead,
  children,
}: MessageBubbleProps) {
  const tailClass = getMessageBubbleTailClass(position, isMe);

  return (
    <div className="relative w-fit max-w-full min-w-[3rem] sm:max-w-[min(100%,20rem)]">
      <div
        className={`relative px-3 py-1.5 ${getMessageBubbleRadius(position, isMe)} ${getMessageBubbleColors(isMe)} ${tailClass}`}
      >
        <div className="flex w-fit max-w-full items-end gap-1.5">
          <div className="min-w-0">{children}</div>
          {time ? (
            <span
              className={`inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap pb-px text-[10px] leading-none ${
                isMe ? 'text-white/75 dark:text-[#8fa4b8]' : 'text-gray-500 dark:text-[#6b7d8f]'
              }`}
            >
              {time}
              {isMe ? (
                <CheckCheck
                  className={`h-3.5 w-3.5 shrink-0 ${
                    isRead ? 'text-[#34b7f1] drop-shadow-sm' : 'text-white/45'
                  }`}
                  strokeWidth={isRead ? 2.5 : 2}
                  aria-hidden
                />
              ) : null}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
