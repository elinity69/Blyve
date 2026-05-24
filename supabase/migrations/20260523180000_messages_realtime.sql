-- Enable Supabase Realtime for direct messages and conversation metadata.
-- Required for live chat, preview updates, unread badges, and notification sounds.

do $$
begin
  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object then
    null;
  end;

  begin
    alter publication supabase_realtime add table public.conversations;
  exception when duplicate_object then
    null;
  end;

  begin
    alter publication supabase_realtime add table public.conversation_views;
  exception when duplicate_object then
    null;
  end;
end $$;

alter table public.messages replica identity full;
alter table public.conversations replica identity full;
