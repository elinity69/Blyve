import { CheckCheck } from 'lucide-react';

interface MessageEmbedTimeFooterProps {
  time?: string;
  isMe?: boolean;
  isRead?: boolean;
}

/** Timestamp for borderless embed-only messages (no chat bubble). */
export function MessageEmbedTimeFooter({ time, isMe = false, isRead = false }: MessageEmbedTimeFooterProps) {
  if (!time) return null;

  return (
    <span
      className={`mt-1 inline-flex items-center gap-0.5 px-0.5 text-[10px] leading-none tabular-nums ${
        isMe ? 'text-gray-500 dark:text-[#6b7d8f]' : 'text-gray-500 dark:text-[#6b7d8f]'
      }`}
    >
      {time}
      {isMe ? (
        <CheckCheck
          className={`h-3.5 w-3.5 shrink-0 ${isRead ? 'text-[#34b7f1]' : 'text-gray-400 dark:text-[#6b7d8f]'}`}
          strokeWidth={isRead ? 2.5 : 2}
          aria-hidden
        />
      ) : null}
    </span>
  );
}
