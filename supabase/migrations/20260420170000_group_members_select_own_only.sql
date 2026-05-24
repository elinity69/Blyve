-- Final fix for infinite recursion on group_members:
-- Any SELECT policy that scans group_members (IN/EXISTS subquery) re-enters RLS.
-- Policy: users may only read their own membership rows.
-- Listing all members of a group is done in Edge with service role after auth check.

drop policy if exists "group_members_select_for_members" on public.group_members;

create policy "group_members_select_own_rows"
  on public.group_members
  for select
  to authenticated
  using (user_id = auth.uid());

-- INSERT: allow creator row (trigger) without querying group_members first;
-- keep join-public-group and admin-invite paths.
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
    or exists (
      select 1
      from public.group_members gm
      where gm.group_id = group_members.group_id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  );
