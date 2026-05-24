-- Replace group_members SELECT policies: two separate policies with EXISTS(self-join)
-- can still trigger "infinite recursion detected in policy for relation group_members".
-- One policy: own rows OR rows in groups you belong to, using IN (subquery) where the
-- subquery only selects rows with user_id = auth.uid() (those rows match the first arm).

drop policy if exists "View group members" on public.group_members;
drop policy if exists "Select own group memberships" on public.group_members;
drop policy if exists "Select other members in shared groups" on public.group_members;

create policy "group_members_select_for_members"
  on public.group_members
  for select
  to authenticated
  using (
    user_id = auth.uid()
    OR group_id IN (
      SELECT gm.group_id
      FROM public.group_members AS gm
      WHERE gm.user_id = auth.uid()
    )
  );
