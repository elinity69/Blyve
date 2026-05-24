-- call_participants in Realtime (IncomingCallPopup + invite_status pending)

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'call_participants'
  ) then
    alter publication supabase_realtime add table public.call_participants;
  end if;
end $$;

notify pgrst, 'reload schema';
