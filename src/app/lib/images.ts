export const getOptimizedImageUrl = (url: string | null | undefined, width: number) => {
  if (!url) return url || '';
  const isSupabase = url.includes('/storage/v1/object/public/');
  if (!isSupabase) return url;

  try {
    const u = new URL(url);
    const hasTransform =
      u.searchParams.has('width') ||
      u.searchParams.has('quality') ||
      u.searchParams.has('resize');
    if (hasTransform) {
      u.searchParams.set('width', String(width));
      u.searchParams.set('quality', '80');
      u.searchParams.set('resize', 'cover');
      return u.toString();
    }
  } catch {
    // ignore invalid URL, fall through to append
  }

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}width=${width}&quality=80&resize=cover`;
};
