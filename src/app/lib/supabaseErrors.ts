/**
 * Supabase JS returns PostgrestError / StorageError as plain objects, not `Error` instances.
 * `err instanceof Error` is often false — use this to show real messages in the UI.
 */
export function formatSupabaseClientError(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const msg = typeof o.message === 'string' ? o.message : '';
    const details = typeof o.details === 'string' ? o.details : '';
    const hint = typeof o.hint === 'string' ? o.hint : '';
    const combined = [msg, details, hint].filter(Boolean).join(' — ');
    if (combined) return combined;
    if (typeof o.error === 'string' && o.error) return o.error;
  }
  return '';
}
