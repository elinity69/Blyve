-- Fix 500 on group_members / groups (infinite RLS recursion).
-- Keep SELECT on group_members to own rows only; use security-definer helpers elsewhere.

create or replace function public.is_group_member(p_group_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = coalesce(p_user_id, auth.uid())
  );
$$;

create or replace function public.is_group_admin(p_group_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = coalesce(p_user_id, auth.uid())
      and gm.role = 'admin'
  )
  or exists (
    select 1
    from public.groups g
    where g.id = p_group_id
      and g.creator_id = coalesce(p_user_id, auth.uid())
  );
$$;

grant execute on function public.is_group_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_group_admin(uuid, uuid) to authenticated, service_role;

drop policy if exists "View group members" on public.group_members;
drop policy if exists "Select own group memberships" on public.group_members;
drop policy if exists "Select other members in shared groups" on public.group_members;
drop policy if exists "group_members_select_for_members" on public.group_members;
drop policy if exists "group_members_select_own_rows" on public.group_members;

create policy "group_members_select_own_rows"
  on public.group_members
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Insert group members" on public.group_members;
create policy "Insert group members"
  on public.group_members
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.groups g
      where g.id = group_members.group_id
        and g.creator_id = auth.uid()
        and group_members.user_id = auth.uid()
    )
    or (
      user_id = auth.uid()
      and exists (
        select 1
        from public.groups g
        where g.id = group_members.group_id
          and g.is_private = false
      )
    )
    or public.is_group_admin(group_members.group_id, auth.uid())
  );

drop policy if exists "Delete group members" on public.group_members;
create policy "Delete group members"
  on public.group_members
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_group_admin(group_members.group_id, auth.uid())
  );

drop policy if exists "View groups" on public.groups;
create policy "View groups"
  on public.groups
  for select
  to authenticated
  using (
    is_private = false
    or public.is_group_member(id, auth.uid())
  );

drop policy if exists "Update groups as admin" on public.groups;
create policy "Update groups as admin"
  on public.groups
  for update
  to authenticated
  using (public.is_group_admin(id, auth.uid()))
  with check (public.is_group_admin(id, auth.uid()));

drop policy if exists "Delete groups as admin" on public.groups;
create policy "Delete groups as admin"
  on public.groups
  for delete
  to authenticated
  using (public.is_group_admin(id, auth.uid()));

drop policy if exists "View group channels" on public.group_channels;
create policy "View group channels"
  on public.group_channels
  for select
  to authenticated
  using (public.is_group_member(group_id, auth.uid()));

drop policy if exists "View group messages" on public.group_messages;
create policy "View group messages"
  on public.group_messages
  for select
  to authenticated
  using (public.is_group_member(group_id, auth.uid()));

drop policy if exists "Insert group messages" on public.group_messages;
create policy "Insert group messages"
  on public.group_messages
  for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_group_member(group_id, auth.uid())
  );

drop policy if exists "Delete group messages" on public.group_messages;
create policy "Delete group messages"
  on public.group_messages
  for delete
  to authenticated
  using (
    sender_id = auth.uid()
    or public.is_group_admin(group_id, auth.uid())
  );

notify pgrst, 'reload schema';
