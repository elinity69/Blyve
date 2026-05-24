-- Group default channel: RLS + trigger (trigger order vs creator membership).

drop policy if exists "Insert group channels as admin" on public.group_channels;

create policy "Insert group channels as admin"
  on public.group_channels
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.groups g
      where g.id = group_channels.group_id
        and g.creator_id = auth.uid()
    )
    or exists (
      select 1
      from public.group_members gm
      where gm.group_id = group_channels.group_id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  );

-- Harden trigger: default channel insert must succeed regardless of trigger order vs
-- add_group_creator_as_member.
create or replace function public.ensure_default_group_channel()
returns trigger
language plpgsql
security definer
set search_path to public
set row_security to off
as $$
begin
  insert into public.group_channels (group_id, name, position)
  values (new.id, 'general', 0);
  return new;
end;
$$;

notify pgrst, 'reload schema';
