import { getOptimizedImageUrl } from '../../lib/images';

interface MessageRowAvatarProps {
  imageUrl?: string | null;
  label: string;
  align?: 'start' | 'end';
}

export function MessageRowAvatar({ imageUrl, label, align = 'start' }: MessageRowAvatarProps) {
  const src = imageUrl ? getOptimizedImageUrl(imageUrl, 56) : null;
  const initial = (label.trim().charAt(0) || '?').toUpperCase();

  return (
    <div
      className={`flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-200 text-[11px] font-semibold text-gray-600 dark:bg-gray-700 dark:text-gray-300 ${
        align === 'end' ? 'self-end' : 'self-start'
      }`}
      aria-hidden
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        initial
      )}
    </div>
  );
}
