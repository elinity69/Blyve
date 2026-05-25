import { Reply } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface MessageRowReplyButtonProps {
  onReply: () => void;
}

export function MessageRowReplyButton({ onReply }: MessageRowReplyButtonProps) {
  const { t } = useTranslation();

  return (
    <button
      type="button"
      onClick={onReply}
      className="hidden shrink-0 rounded-full bg-white/95 p-1.5 text-gray-500 opacity-0 shadow-sm transition-opacity group-hover/bubble:opacity-100 hover:text-orange-500 dark:bg-[#1e1e1e] dark:text-[#8b949e] dark:hover:text-orange-400 md:block"
      aria-label={t('chat.replyToMessage')}
    >
      <Reply className="h-3.5 w-3.5" />
    </button>
  );
}
