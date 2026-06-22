import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Download } from 'lucide-react';
import type { ParsedEmbed } from '../../lib/linkEmbeds';
import { copyTextToClipboard } from '../../lib/copyToClipboard';
import { downloadEmbedMedia, embedSupportsDownload } from '../../lib/embedDownload';
import { toast } from '../../lib/toast';

interface EmbedContextMenuProps {
  embed: ParsedEmbed;
  x: number;
  y: number;
  onClose: () => void;
}

function EmbedContextMenu({ embed, x, y, onClose }: EmbedContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  const [saving, setSaving] = useState(false);
  const canSave = embedSupportsDownload(embed.kind);

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

  const handleCopyLink = async () => {
    const ok = await copyTextToClipboard(embed.url);
    if (ok) {
      toast.success(t('chat.embedCopyLinkSuccess'));
    } else {
      toast.error(t('chat.embedCopyLinkFailed'));
    }
    onClose();
  };

  const handleSaveMedia = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const ok = await downloadEmbedMedia(embed);
      if (ok) {
        toast.success(t('chat.embedSaveMediaSuccess'));
        onClose();
      } else {
        toast.error(t('chat.embedSaveMediaFailed'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-[220] min-w-[180px] max-w-[min(92vw,280px)] overflow-y-auto max-h-[calc(100vh-16px)] rounded-xl border border-gray-200 bg-white shadow-xl dark:border-white/10 dark:bg-[#1e1f22]"
      style={{ left: position.x, top: position.y }}
      role="menu"
      aria-label={t('chat.embedCopyLink')}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="py-1">
        {canSave ? (
          <button
            type="button"
            role="menuitem"
            disabled={saving}
            onClick={() => void handleSaveMedia()}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-800 transition-colors hover:bg-gray-50 disabled:opacity-60 dark:text-gray-100 dark:hover:bg-white/5"
          >
            <Download className="h-4 w-4 shrink-0" aria-hidden />
            <span>{t('chat.embedSaveMedia')}</span>
          </button>
        ) : null}
        <button
          type="button"
          role="menuitem"
          onClick={() => void handleCopyLink()}
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-gray-800 transition-colors hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-white/5"
        >
          <Copy className="h-4 w-4 shrink-0" aria-hidden />
          <span>{t('chat.embedCopyLink')}</span>
        </button>
      </div>
    </div>
  );
}

interface EmbedContextMenuWrapperProps {
  embed: ParsedEmbed;
  children: ReactNode;
}

export function EmbedContextMenuWrapper({ embed, children }: EmbedContextMenuWrapperProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  return (
    <>
      <div
        className="w-full"
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        {children}
      </div>
      {menu ? (
        <EmbedContextMenu embed={embed} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />
      ) : null}
    </>
  );
}
