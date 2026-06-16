import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { MessageGroupPosition } from '../../lib/messageGrouping';
import { CHAT_MESSAGE_BUBBLE_SHELL_CLASS } from './chatMessageStyles';
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
  isPending?: boolean;
  readLabel?: string;
  children: React.ReactNode;
}

export function MessageBubble({
  position,
  isMe,
  time,
  isRead,
  isPending,
  readLabel,
  children,
}: MessageBubbleProps) {
  const tailClass = getMessageBubbleTailClass(position, isMe);

  return (
    <div className={CHAT_MESSAGE_BUBBLE_SHELL_CLASS}>
      <div
        className={`relative px-3 py-1.5 ${getMessageBubbleRadius(position, isMe)} ${getMessageBubbleColors(isMe)} ${tailClass}`}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="min-w-0">{children}</div>
          {time ? (
            <span
              className={`inline-flex shrink-0 items-center gap-0.5 self-end whitespace-nowrap text-[10px] leading-none ${
                isMe ? 'text-white/75 dark:text-[#8fa4b8]' : 'text-gray-500 dark:text-[#6b7d8f]'
              }`}
            >
              {time}
              {isMe ? (
                <div className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                  <svg
                    className={`h-full w-full ${
                      !isPending && isRead ? 'text-[#34b7f1] drop-shadow-sm' : 'text-white/45'
                    }`}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={!isPending && isRead ? 2.5 : 2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {/* First check (left) - Always visible */}
                    <path d="M18 6 7 17l-5-5" />
                    {/* Second check (right) - Fades in when sent */}
                    <AnimatePresence>
                      {!isPending && (
                        <motion.path
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.8 }}
                          d="M22 10l-11 11-5-5"
                        />
                      )}
                    </AnimatePresence>
                  </svg>
                </div>
              ) : null}
            </span>
          ) : null}
          {readLabel ? (
            <span
              className={`self-end whitespace-nowrap text-[10px] leading-none tabular-nums ${
                isMe ? 'text-white/65 dark:text-[#8fa4b8]/90' : 'text-gray-500 dark:text-[#6b7d8f]'
              }`}
            >
              {readLabel}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
