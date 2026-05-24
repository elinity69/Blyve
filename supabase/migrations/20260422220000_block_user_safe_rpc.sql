-- RPC used by api.blockUser (PostgREST: block_user_safe).

create or replace function public.block_user_safe(target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'message', 'Not authenticated');
  end if;

  if target_id is null or target_id = v_uid then
    return jsonb_build_object('success', false, 'message', 'Invalid target');
  end if;

  insert into public.blocked_users (blocker_id, blocked_user_id)
  values (v_uid, target_id)
  on conflict (blocker_id, blocked_user_id) do nothing;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.block_user_safe(uuid) to authenticated;

notify pgrst, 'reload schema';
