import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Reply, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface MessageContextMenuProps {
  x: number;
  y: number;
  canDelete: boolean;
  onReply: () => void;
  onDelete: () => void;
  onClose: () => void;
}

function MessageContextMenu({
  x,
  y,
  canDelete,
  onReply,
  onDelete,
  onClose,
}: MessageContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

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
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-[300] cursor-default bg-transparent"
        aria-label="Close message menu"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        ref={menuRef}
        className="fixed z-[301] min-w-[180px] max-w-[min(92vw,280px)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-white/10 dark:bg-[#1e1f22]"
        style={{ left: position.x, top: position.y }}
        role="menu"
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="py-1">
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
    </>,
    document.body
  );
}

interface MessageContextMenuWrapperProps {
  children: ReactNode;
  canDelete: boolean;
  onReply: () => void;
  onDelete: () => void;
}

export function MessageContextMenuWrapper({
  children,
  canDelete,
  onReply,
  onDelete,
}: MessageContextMenuWrapperProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  return (
    <>
      <div
        className="w-full"
        onContextMenuCapture={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
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
          onClose={() => setMenu(null)}
        />
      ) : null}
    </>
  );
}
