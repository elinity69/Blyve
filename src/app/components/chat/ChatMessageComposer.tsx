import { useState, type ReactNode, type RefObject } from 'react';
import { ImageIcon, Loader2, Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { FavoriteEmbedsPicker } from './FavoriteEmbedsPicker';
import { useFavoriteEmbeds } from '../../hooks/useFavoriteEmbeds';

interface ChatMessageComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  onSendUrl: (url: string) => void | Promise<void>;
  placeholder: string;
  sending: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  replyBar?: ReactNode;
  typingIndicator?: ReactNode;
}

export function ChatMessageComposer({
  value,
  onChange,
  onSend,
  onSendUrl,
  placeholder,
  sending,
  inputRef,
  replyBar,
  typingIndicator,
}: ChatMessageComposerProps) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const { syncStatus, isCloudEnabled } = useFavoriteEmbeds();
  const showSyncDot = isCloudEnabled && syncStatus === 'syncing';

  return (
    <div className="relative z-20 shrink-0 border-t border-gray-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-[#1f1f1f] dark:bg-[#0d0d0d] md:dark:bg-[#0e0e0e]">
      {typingIndicator}
      {replyBar}
      <div className="relative flex w-full items-center gap-2">
        <FavoriteEmbedsPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={(url) => void onSendUrl(url)}
        />
        <button
          type="button"
          aria-label={t('chat.openFavoriteEmbeds')}
          aria-expanded={pickerOpen}
          className={`relative shrink-0 rounded-full p-2.5 transition-colors ${
            pickerOpen
              ? 'bg-orange-100 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400'
              : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10'
          }`}
          onClick={() => setPickerOpen((open) => !open)}
          style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
        >
          <ImageIcon className="h-5 w-5" aria-hidden />
          {showSyncDot ? (
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-orange-500 ring-2 ring-white dark:ring-[#0d0d0d]" />
          ) : null}
        </button>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void onSend();
            }
          }}
          placeholder={placeholder}
          className="flex-1 rounded-full bg-gray-100 px-4 py-2 text-gray-900 focus:outline-none dark:bg-[#1a1a1a] dark:text-[#dce6ef]"
          style={{
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
            fontSize: '16px',
          }}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void onSend()}
          disabled={!value.trim() || sending}
          className="flex items-center justify-center rounded-full bg-gradient-to-br from-orange-500 via-red-500 to-pink-500 p-3 disabled:opacity-50"
          style={{
            touchAction: 'manipulation',
            WebkitTapHighlightColor: 'transparent',
            cursor: 'pointer',
          }}
        >
          {sending ? (
            <Loader2 className="h-5 w-5 animate-spin text-white" />
          ) : (
            <Send className="h-5 w-5 text-white" />
          )}
        </button>
      </div>
    </div>
  );
}
