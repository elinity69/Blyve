import { CornerDownRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ReplyTarget } from '../../lib/messageReply';

interface MessageReplyComposerBarProps {
  target: ReplyTarget;
  onCancel: () => void;
}

export function MessageReplyComposerBar({ target, onCancel }: MessageReplyComposerBarProps) {
  const { t } = useTranslation();

  return (
    <div className="mb-1.5 flex items-center gap-1.5 rounded-lg border border-orange-200/60 bg-orange-50/80 px-2 py-1 dark:border-orange-500/15 dark:bg-orange-500/8">
      <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-orange-500" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium text-orange-600 dark:text-orange-400">
          {t('chat.replyingTo', { name: target.senderLabel })}
        </p>
        <p className="truncate text-xs text-gray-700 dark:text-gray-300">{target.content}</p>
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="shrink-0 rounded-full p-1 text-gray-500 hover:bg-black/5 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white"
        aria-label={t('chat.cancelReply')}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
