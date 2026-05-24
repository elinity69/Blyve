-- Fix infinite recursion in call_participants SELECT policy.
-- Root cause: policy "Select call participants in my calls" queried
-- public.call_participants inside a policy on the same table.
-- Depending on planner/RLS evaluation, this can recurse indefinitely.

create or replace function public.is_call_participant(p_call_session_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.call_participants cp
    where cp.call_session_id = p_call_session_id
      and cp.user_id = auth.uid()
  );
$$;

revoke all on function public.is_call_participant(uuid) from public;
grant execute on function public.is_call_participant(uuid) to authenticated;

drop policy if exists "Select own call participants rows" on public.call_participants;
drop policy if exists "Select call participants in my calls" on public.call_participants;

create policy "Select own call participants rows"
  on public.call_participants
  for select
  to authenticated
  using (user_id = auth.uid());

create policy "Select call participants in my calls"
  on public.call_participants
  for select
  to authenticated
  using (public.is_call_participant(call_session_id));

notify pgrst, 'reload schema';
