import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link2, LogOut, Pencil, Trash2, Volume2, VolumeX } from 'lucide-react';
import { NotificationManager } from '../lib/notifications';
import { toast } from '../lib/toast';
import { getOptimizedImageUrl } from '../lib/images';

export type GroupActionTarget = {
  groupId: string;
  groupName: string;
  iconUrl?: string | null;
  description?: string | null;
  isPrivate?: boolean;
  isAdmin: boolean;
  x: number;
  y: number;
};

interface GroupActionsMenuProps {
  target: GroupActionTarget;
  onClose: () => void;
  onEdit?: () => void;
  onInvite?: () => void;
  onLeave?: () => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}

export function GroupActionsMenu({
  target,
  onClose,
  onEdit,
  onInvite,
  onLeave,
  onDelete,
}: GroupActionsMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: target.x, y: target.y });
  const [mutedInServer, setMutedInServer] = useState(() =>
    NotificationManager.isGroupNotificationsMutedWhenActive(target.groupId)
  );

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    const rect = menu.getBoundingClientRect();
    const padding = 8;
    let x = target.x;
    let y = target.y;

    if (x + rect.width > window.innerWidth - padding) {
      x = window.innerWidth - rect.width - padding;
    }
    if (y + rect.height > window.innerHeight - padding) {
      y = window.innerHeight - rect.height - padding;
    }

    setPosition({ x: Math.max(padding, x), y: Math.max(padding, y) });
  }, [target.x, target.y]);

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

  const handleToggleMute = () => {
    const next = !mutedInServer;
    NotificationManager.setGroupNotificationsMutedWhenActive(target.groupId, next);
    setMutedInServer(next);
    toast.success(
      next ? t('groups.muteNotificationsInServerEnabled') : t('groups.muteNotificationsInServerDisabled')
    );
    onClose();
  };

  const items = [
    {
      key: 'mute',
      label: mutedInServer
        ? t('groups.unmuteNotificationsInServer')
        : t('groups.muteNotificationsInServer'),
      icon: mutedInServer ? Volume2 : VolumeX,
      onClick: handleToggleMute,
    },
    target.isAdmin && onEdit
      ? {
          key: 'edit',
          label: t('groups.editServer'),
          icon: Pencil,
          onClick: () => {
            onEdit();
            onClose();
          },
        }
      : null,
    onInvite
      ? {
          key: 'invite',
          label: t('groups.serverInvite'),
          icon: Link2,
          onClick: () => {
            onInvite();
            onClose();
          },
        }
      : null,
    onLeave
      ? {
          key: 'leave',
          label: t('groups.leave'),
          icon: LogOut,
          onClick: () => {
            void onLeave();
            onClose();
          },
          destructive: true,
        }
      : null,
    target.isAdmin && onDelete
      ? {
          key: 'delete',
          label: t('groups.deleteServer'),
          icon: Trash2,
          onClick: () => {
            void onDelete();
            onClose();
          },
          destructive: true,
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string;
    label: string;
    icon: typeof VolumeX;
    onClick: () => void;
    destructive?: boolean;
  }>;

  const iconSrc = target.iconUrl ? getOptimizedImageUrl(target.iconUrl, 96) : null;
  const initial = (target.groupName.trim().charAt(0) || '?').toUpperCase();

  return (
    <div
      ref={menuRef}
      className="fixed z-[220] min-w-[260px] max-w-[min(92vw,340px)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-white/10 dark:bg-[#1e1f22]"
      style={{ left: position.x, top: position.y }}
      role="menu"
      aria-label={target.groupName}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="px-3 py-2 border-b border-gray-100 dark:border-white/10 flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl overflow-hidden shrink-0 bg-[#313338] flex items-center justify-center text-sm font-bold text-white">
          {iconSrc ? (
            <img src={iconSrc} alt="" className="w-full h-full object-cover" />
          ) : (
            initial
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{target.groupName}</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400">{t('groups.tabGroups')}</p>
        </div>
      </div>
      <div className="py-1">
        {items.map(({ key, label, icon: Icon, onClick, destructive }) => (
          <button
            key={key}
            type="button"
            role="menuitem"
            onClick={onClick}
            className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors ${
              destructive
                ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30'
                : 'text-gray-800 hover:bg-gray-50 dark:text-gray-100 dark:hover:bg-white/5'
            }`}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function openGroupActionsMenuFromEvent(
  event: React.MouseEvent | React.PointerEvent,
  group: {
    id: string;
    name: string;
    icon_url?: string | null;
    description?: string | null;
    is_private?: boolean;
  },
  isAdmin: boolean,
): GroupActionTarget {
  const clientX = 'clientX' in event ? event.clientX : 0;
  const clientY = 'clientY' in event ? event.clientY : 0;
  return {
    groupId: group.id,
    groupName: group.name,
    iconUrl: group.icon_url,
    description: group.description,
    isPrivate: group.is_private,
    isAdmin,
    x: clientX,
    y: clientY,
  };
}
