import { ArrowLeft } from 'lucide-react';
import { getOptimizedImageUrl } from '../lib/images';

/** Static shell for mobile forward-pull cache — no live ChatScreen / subscriptions. */
export function DmChatForwardPreview({
  displayName,
  imageUrl,
  isOnline,
  onBack,
}: {
  displayName: string;
  imageUrl?: string;
  isOnline?: boolean;
  onBack: () => void;
}) {
  const avatarSrc = imageUrl ? getOptimizedImageUrl(imageUrl, 120) : null;
  const initial = (displayName?.trim().charAt(0) || '?').toUpperCase();

  return (
    <div className="relative flex h-full min-h-0 w-full max-w-full flex-col overflow-hidden blyve-screen-bg">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 blyve-border-subtle blyve-screen-bg shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full shrink-0"
            style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent', cursor: 'pointer' }}
          >
            <ArrowLeft className="w-6 h-6 text-gray-900 dark:text-white" />
          </button>
          <div className="relative shrink-0">
            <div className="w-10 h-10 rounded-full bg-blyve/20 flex items-center justify-center text-sm font-bold text-blyve overflow-hidden">
              {avatarSrc ? (
                <img src={avatarSrc} alt="" className="w-full h-full object-cover" />
              ) : (
                initial
              )}
            </div>
            {isOnline ? (
              <span
                className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-green-500 dark:border-[#0d0d0d]"
                aria-hidden
              />
            ) : null}
          </div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-white truncate">{displayName}</h2>
        </div>
      </div>
      <div className="flex flex-1 min-h-0" aria-hidden />
    </div>
  );
}
