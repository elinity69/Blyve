/** Project ref for display/debug — derived from `VITE_SUPABASE_URL` (no secrets). */

function projectRefFromSupabaseUrl(url: string | undefined): string {
  if (!url?.trim()) return '';
  try {
    const host = new URL(url.trim()).hostname;
    const sub = host.split('.')[0];
    return sub && host.endsWith('.supabase.co') ? sub : '';
  } catch {
    return '';
  }
}

export const projectId = projectRefFromSupabaseUrl(import.meta.env.VITE_SUPABASE_URL);
