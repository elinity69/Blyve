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
    <div className="mb-1.5 flex items-center gap-1.5 rounded-lg border border-blyve/30 bg-blyve/10 px-2 py-1 dark:border-blyve/15 dark:bg-blyve/8">
      <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-blyve" />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium text-blyve">
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
