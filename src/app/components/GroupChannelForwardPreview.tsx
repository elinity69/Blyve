import { ArrowLeft } from 'lucide-react';
import { getOptimizedImageUrl } from '../lib/images';

function groupAccentHue(groupId: string): number {
  let h = 0;
  for (let i = 0; i < groupId.length; i += 1) h += groupId.charCodeAt(i);
  return 200 + (h % 140);
}

/** Static shell for mobile forward-pull cache — no Supabase / edge requests. */
export function GroupChannelForwardPreview({
  groupId,
  groupName,
  channelName,
  channelIconUrl,
  onBack,
}: {
  groupId: string;
  groupName: string;
  channelName: string;
  channelIconUrl?: string | null;
  onBack: () => void;
}) {
  const channelLabel = channelName ? `#${channelName}` : '#general';
  const hue = groupAccentHue(groupId);
  const groupInitial = (groupName?.trim().charAt(0) || '?').toUpperCase();
  const channelIconSrc = channelIconUrl ? getOptimizedImageUrl(channelIconUrl, 120) : null;

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
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0 overflow-hidden"
            style={
              channelIconSrc
                ? undefined
                : { background: `linear-gradient(145deg, hsl(${hue}, 42%, 42%), hsl(${hue}, 45%, 32%))` }
            }
            aria-hidden
          >
            {channelIconSrc ? (
              <img src={channelIconSrc} alt="" className="w-full h-full object-cover" />
            ) : (
              groupInitial
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white truncate">{groupName}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{channelLabel}</p>
          </div>
        </div>
      </div>
      <div className="flex flex-1 min-h-0" aria-hidden />
    </div>
  );
}
