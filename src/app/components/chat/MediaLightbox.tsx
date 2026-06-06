import { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Download, ExternalLink } from 'lucide-react';
import { openExternalLink } from '../../lib/openExternalLink';

export type LightboxMedia =
  | { type: 'image'; src: string; alt?: string; openUrl?: string }
  | { type: 'gif-video'; src: string; openUrl?: string }
  | { type: 'video'; src: string; openUrl?: string };

interface MediaLightboxProps {
  media: LightboxMedia;
  onClose: () => void;
}

export function MediaLightbox({ media, onClose }: MediaLightboxProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal
    >
      {/* Top toolbar */}
      <div
        className="absolute left-0 right-0 top-0 flex items-center justify-between px-4 py-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          {media.openUrl ? (
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
              onClick={(e) => openExternalLink(e, media.openUrl!)}
              title="Open original"
            >
              <ExternalLink className="h-4 w-4" aria-hidden />
            </button>
          ) : null}
          <a
            href={media.type === 'gif-video' ? media.openUrl ?? media.src : media.src}
            download
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
            title="Download"
            onClick={(e) => e.stopPropagation()}
          >
            <Download className="h-4 w-4" aria-hidden />
          </a>
        </div>
        <button
          type="button"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-sm transition-colors hover:bg-white/20"
          onClick={onClose}
          title="Close"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      {/* Media content */}
      <div
        className="flex max-h-[90vh] max-w-[90vw] items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {media.type === 'image' && (
          <img
            src={media.src}
            alt={media.alt ?? ''}
            draggable={false}
            className="max-h-[85vh] max-w-[85vw] rounded-xl object-contain shadow-2xl"
          />
        )}
        {media.type === 'gif-video' && (
          <video
            src={media.src}
            autoPlay
            loop
            muted
            playsInline
            className="max-h-[85vh] max-w-[85vw] rounded-xl object-contain shadow-2xl"
          />
        )}
        {media.type === 'video' && (
          <video
            src={media.src}
            controls
            playsInline
            autoPlay
            className="max-h-[85vh] max-w-[85vw] rounded-xl shadow-2xl"
          />
        )}
      </div>

      {/* Click outside hint */}
      <p className="absolute bottom-4 left-1/2 -translate-x-1/2 select-none text-xs text-white/40">
        Click outside or press Esc to close
      </p>
    </div>,
    document.body
  );
}
