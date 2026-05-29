import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ParsedEmbed } from '../../lib/linkEmbeds';
import { useFavoriteEmbeds } from '../../hooks/useFavoriteEmbeds';
import { toast } from '../../lib/toast';

interface EmbedFavoriteButtonProps {
  embed: ParsedEmbed;
}

export function EmbedFavoriteButton({ embed }: EmbedFavoriteButtonProps) {
  const { t } = useTranslation();
  const { isFavorited, toggleFavorite } = useFavoriteEmbeds();
  const favorited = isFavorited(embed.url);

  return (
    <button
      type="button"
      aria-label={favorited ? t('chat.unfavoriteEmbed') : t('chat.favoriteEmbed')}
      aria-pressed={favorited}
      className="absolute right-2 top-2 z-20 rounded-full bg-black/55 p-1.5 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void toggleFavorite(embed).then((added) => {
          toast.success(added ? t('chat.favoriteEmbedAdded') : t('chat.favoriteEmbedRemoved'));
        });
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <Star
        className={`h-4 w-4 ${favorited ? 'fill-yellow-400 text-yellow-400' : 'text-white'}`}
        aria-hidden
      />
    </button>
  );
}
