-- Fix RLS on group_members for SELECT: the previous "View group members" policy
-- referenced group_members inside a subquery while evaluating group_members rows,
-- which can cause infinite recursion or empty results for GET /blyve/groups
-- (Edge: .from('group_members').eq('user_id', user.id)).

drop policy if exists "View group members" on public.group_members;

-- Always allow users to read their own membership rows (required for "my groups" list).
create policy "Select own group memberships"
  on public.group_members
  for select
  to authenticated
  using (user_id = auth.uid());

-- Allow reading other members' rows in groups where the current user is a member.
-- Inner query only touches rows with user_id = auth.uid(), which the policy above allows.
create policy "Select other members in shared groups"
  on public.group_members
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.group_members as my_membership
      where my_membership.group_id = group_members.group_id
        and my_membership.user_id = auth.uid()
    )
  );
