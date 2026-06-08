import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Download, Pencil, Reply, SmilePlus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIsMdUp } from '../ui/use-mobile';
import { CHAT_MESSAGE_BUBBLE_CONTEXT_TARGET_CLASS } from './chatMessageStyles';
import { EmojiPickerPopover } from './EmojiPickerPopover';
import { getRecentReactionEmojis } from '../../hooks/useRecentReactionEmojis';

const MENU_Z_PANEL = 401;
const OPEN_GRACE_MS = 320;

const DEFAULT_QUICK_EMOJIS = ['👍', '❤️', '😂', '🔥'];

interface MessageContextMenuProps {
  x: number;
  y: number;
  canDelete: boolean;
  onReply: () => void;
  onDelete: () => void;
  onClose: () => void;
  onCopy?: () => void;
  onDownload?: () => void;
  onEdit?: () => void;
  onReact?: (emoji: string) => void;
}

export function MessageContextMenu({
  x,
  y,
  canDelete,
  onReply,
  onDelete,
  onClose,
  onCopy,
  onDownload,
  onEdit,
  onReact,
}: MessageContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const openedAtRef = useRef(Date.now());
  const [position, setPosition] = useState({ x, y });
  const [showPicker, setShowPicker] = useState(false);
  const [pickerPos, setPickerPos] = useState({ x: 0, y: 0 });

  // Resolve quick emojis: last-4 recents or defaults
  const recents = getRecentReactionEmojis();
  const quickEmojis = recents.length > 0 ? recents : DEFAULT_QUICK_EMOJIS;

  useLayoutEffect(() => {
    openedAtRef.current = Date.now();
  }, [x, y]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    const padding = 8;
    let nextX = x;
    let nextY = y;

    if (nextX + rect.width > window.innerWidth - padding) {
      nextX = window.innerWidth - rect.width - padding;
    }
    if (nextY + rect.height > window.innerHeight - padding) {
      nextY = window.innerHeight - rect.height - padding;
    }

    setPosition({ x: Math.max(padding, nextX), y: Math.max(padding, nextY) });
  }, [x, y]);

  useEffect(() => {
    if (showPicker) return; // keep menu open while picker is open
    const handlePointerDown = (event: PointerEvent) => {
      if (Date.now() - openedAtRef.current < OPEN_GRACE_MS) return;
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, showPicker]);

  const handleAddEmoji = useCallback((e: React.MouseEvent | React.PointerEvent) => {
    const btn = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPickerPos({ x: btn.left, y: btn.bottom + 4 });
    setShowPicker(true);
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div
        ref={menuRef}
        className="fixed min-w-[200px] max-w-[min(92vw,280px)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-white/10 dark:bg-[#1e1f22]"
        style={{ left: position.x, top: position.y, zIndex: MENU_Z_PANEL }}
        role="menu"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        {onReact ? (
          <>
            {/* Quick-react row */}
            <div
              className="flex items-center justify-between gap-0.5 border-b border-gray-100 px-2 py-2 dark:border-white/8"
              role="group"
              aria-label={t('chat.quickReactions')}
            >
              {quickEmojis.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  role="menuitem"
                  aria-label={t('chat.reactWith', { emoji })}
                  onClick={() => {
                    onReact(emoji);
                    onClose();
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-xl transition-all hover:bg-gray-100 active:scale-90 dark:hover:bg-white/10"
                >
                  {emoji}
                </button>
              ))}
              {/* Add Emoji button */}
              <button
                type="button"
                role="menuitem"
                aria-label={t('chat.addEmoji')}
                onClick={handleAddEmoji}
                className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition-all hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/10 active:scale-90"
              >
                <SmilePlus className="h-5 w-5" aria-hidden />
              </button>
            </div>
          </>
        ) : null}

        <div className="py-1">
          {onEdit ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => { onEdit(); onClose(); }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-800 transition-colors hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-white/5"
            >
              <Pencil className="h-4 w-4 shrink-0" aria-hidden />
              <span>{t('chat.editMessage')}</span>
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onReply();
              onClose();
            }}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-800 transition-colors hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-white/5"
          >
            <Reply className="h-4 w-4 shrink-0" aria-hidden />
            <span>{t('chat.replyToMessage')}</span>
          </button>
          {onCopy ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onCopy();
                onClose();
              }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-800 transition-colors hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-white/5"
            >
              <Copy className="h-4 w-4 shrink-0" aria-hidden />
              <span>{t('chat.copyMessage')}</span>
            </button>
          ) : null}
          {onDownload ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onDownload();
                onClose();
              }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-800 transition-colors hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-white/5"
            >
              <Download className="h-4 w-4 shrink-0" aria-hidden />
              <span>{t('chat.downloadMedia', 'Download')}</span>
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onDelete();
                onClose();
              }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              <Trash2 className="h-4 w-4 shrink-0" aria-hidden />
              <span>{t('chat.deleteMessage')}</span>
            </button>
          ) : null}
        </div>
      </div>

      {showPicker ? (
        <EmojiPickerPopover
          x={pickerPos.x}
          y={pickerPos.y}
          onEmojiSelect={(emoji) => {
            onReact?.(emoji);
            onClose();
          }}
          onClose={() => setShowPicker(false)}
        />
      ) : null}
    </>,
    document.body
  );
}

interface MessageContextMenuWrapperProps {
  children: ReactNode;
  canDelete: boolean;
  onReply: () => void;
  onDelete: () => void;
  onCopy?: () => void;
  onDownload?: () => void;
  onEdit?: () => void;
  onReact?: (emoji: string) => void;
}

/** Desktop only: right-click on the message bubble opens reply/delete. Mobile uses swipe-to-reply. */
export function MessageContextMenuWrapper({
  children,
  canDelete,
  onReply,
  onDelete,
  onCopy,
  onDownload,
  onEdit,
  onReact,
}: MessageContextMenuWrapperProps) {
  const isMdUp = useIsMdUp();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const openMenu = useCallback((clientX: number, clientY: number) => {
    setMenu({ x: clientX, y: clientY });
  }, []);

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if (!isMdUp) return;
      event.preventDefault();
      event.stopPropagation();
      openMenu(event.clientX, event.clientY);
    },
    [isMdUp, openMenu],
  );

  return (
    <>
      <div
        className={CHAT_MESSAGE_BUBBLE_CONTEXT_TARGET_CLASS}
        data-message-bubble
        onContextMenuCapture={isMdUp ? handleContextMenu : undefined}
      >
        {children}
      </div>
      {menu ? (
        <MessageContextMenu
          x={menu.x}
          y={menu.y}
          canDelete={canDelete}
          onReply={onReply}
          onDelete={onDelete}
          onCopy={onCopy}
          onDownload={onDownload}
          onEdit={onEdit}
          onReact={onReact}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </>
  );
}
