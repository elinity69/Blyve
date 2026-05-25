import { MessageRowAvatar } from './MessageRowAvatar';

interface MessageRowAvatarSlotProps {
  visible: boolean;
  imageUrl?: string | null;
  label: string;
}

/** Avatar at group end (Telegram-style), fixed-width spacer when grouped. */
export function MessageRowAvatarSlot({ visible, imageUrl, label }: MessageRowAvatarSlotProps) {
  if (visible) {
    return <MessageRowAvatar imageUrl={imageUrl} label={label} align="end" />;
  }
  return <div className="w-7 shrink-0 self-end" aria-hidden />;
}
