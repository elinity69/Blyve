-- Broadcast call_sessions row changes (e.g. status -> ended) so clients can clear UI without polling only.
-- Safe if the table is already in the publication (skip duplicate add).

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'call_sessions'
  ) then
    alter publication supabase_realtime add table public.call_sessions;
  end if;
end $$;
