import { motion, AnimatePresence } from 'framer-motion';

interface MessageEmbedTimeFooterProps {
  time?: string;
  isMe?: boolean;
  isRead?: boolean;
  isPending?: boolean;
  readLabel?: string;
}

/** Timestamp for borderless embed-only messages (no chat bubble). */
export function MessageEmbedTimeFooter({
  time,
  isMe = false,
  isRead = false,
  isPending = false,
  readLabel,
}: MessageEmbedTimeFooterProps) {
  if (!time && !readLabel) return null;

  return (
    <span
      className={`mt-1 inline-flex flex-col items-end gap-0.5 px-0.5 text-[10px] leading-none tabular-nums ${
        isMe ? 'text-gray-500 dark:text-[#6b7d8f]' : 'text-gray-500 dark:text-[#6b7d8f]'
      }`}
    >
      {time ? (
        <span className="inline-flex items-center gap-0.5">
          {time}
          {isMe ? (
            <div className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
              <svg
                className={`h-full w-full ${
                  !isPending && isRead ? 'text-[#34b7f1]' : 'text-gray-400 dark:text-[#6b7d8f]'
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
      {readLabel ? <span>{readLabel}</span> : null}
    </span>
  );
}
