import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VolumeX, Volume2, User, UserMinus, Ban } from 'lucide-react';
import { NotificationManager } from '../lib/notifications';
import { toast } from '../lib/toast';

export type ConversationActionTarget = {
  conversationId: string;
  otherUser: {
    id: string;
    name: string;
    username?: string;
    imageUrl?: string;
  };
  x: number;
  y: number;
};

interface ConversationActionsMenuProps {
  target: ConversationActionTarget;
  onClose: () => void;
  onViewProfile?: () => void;
  onRemoveFriend?: () => void | Promise<void>;
  onBlockUser?: () => void | Promise<void>;
}

export function ConversationActionsMenu({
  target,
  onClose,
  onViewProfile,
  onRemoveFriend,
  onBlockUser,
}: ConversationActionsMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: target.x, y: target.y });
  const [muteInChat, setMuteInChat] = useState(() =>
    NotificationManager.isConversationSoundMutedWhenInChat(target.conversationId)
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
    const next = !muteInChat;
    NotificationManager.setConversationSoundMutedWhenInChat(target.conversationId, next);
    setMuteInChat(next);
    toast.success(next ? t('chat.muteSoundInChatEnabled') : t('chat.muteSoundInChatDisabled'));
    onClose();
  };

  const items = [
    {
      key: 'mute',
      label: muteInChat ? t('chat.unmuteSoundInChat') : t('chat.muteSoundInChat'),
      icon: muteInChat ? Volume2 : VolumeX,
      onClick: handleToggleMute,
    },
    onViewProfile
      ? {
          key: 'profile',
          label: t('chat.viewProfile'),
          icon: User,
          onClick: () => {
            onViewProfile();
            onClose();
          },
        }
      : null,
    onRemoveFriend
      ? {
          key: 'remove',
          label: t('chat.deleteFriend'),
          icon: UserMinus,
          onClick: () => {
            void onRemoveFriend();
            onClose();
          },
          destructive: true,
        }
      : null,
    onBlockUser
      ? {
          key: 'block',
          label: t('profile.blockUser'),
          icon: Ban,
          onClick: () => {
            void onBlockUser();
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

  return (
    <div
      ref={menuRef}
      className="fixed z-[220] min-w-[240px] max-w-[min(92vw,320px)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-white/10 dark:bg-[#1e1f22]"
      style={{ left: position.x, top: position.y }}
      role="menu"
      aria-label={target.otherUser.name}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="px-3 py-2 border-b border-gray-100 dark:border-white/10">
        <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">
          {target.otherUser.name}
        </p>
        {target.otherUser.username ? (
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            @{target.otherUser.username}
          </p>
        ) : null}
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

export function openConversationActionsMenuFromEvent(
  event: React.MouseEvent | React.PointerEvent,
  conversationId: string,
  otherUser: ConversationActionTarget['otherUser']
): ConversationActionTarget {
  const clientX = 'clientX' in event ? event.clientX : 0;
  const clientY = 'clientY' in event ? event.clientY : 0;
  return {
    conversationId,
    otherUser,
    x: clientX,
    y: clientY,
  };
}
