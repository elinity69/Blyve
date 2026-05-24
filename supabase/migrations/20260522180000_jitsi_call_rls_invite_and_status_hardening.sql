-- Invite-token join RLS (security definer RPCs) + call_events creator read + status helpers

-- ----------------------------------------------------------------------------
-- 1) Authorized session read for join (participant, creator, or valid invite token)
-- ----------------------------------------------------------------------------
create or replace function public.get_call_session_for_join(
  p_session_id uuid,
  p_invite_token_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.call_sessions%rowtype;
  v_token_ok boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Unauthorized';
  end if;

  if p_invite_token_hash is not null and length(trim(p_invite_token_hash)) > 0 then
    select exists (
      select 1
      from public.call_invite_tokens t
      where t.call_session_id = p_session_id
        and t.token_hash = p_invite_token_hash
        and t.expires_at > now()
        and t.use_count < t.max_uses
    ) into v_token_ok;
  end if;

  select *
  into v_session
  from public.call_sessions cs
  where cs.id = p_session_id
    and (
      cs.creator_id = auth.uid()
      or public.is_call_participant(p_session_id)
      or v_token_ok
    );

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_session.id,
    'status', v_session.status,
    'room_name', v_session.room_name,
    'call_type', v_session.call_type,
    'creator_id', v_session.creator_id,
    'started_at', v_session.started_at
  );
end;
$$;

revoke all on function public.get_call_session_for_join(uuid, text) from public;
grant execute on function public.get_call_session_for_join(uuid, text) to authenticated;
grant execute on function public.get_call_session_for_join(uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 2) Atomically consume invite token on successful join authorization
-- ----------------------------------------------------------------------------
create or replace function public.consume_call_invite_token(
  p_call_session_id uuid,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.call_invite_tokens%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select *
  into v_row
  from public.call_invite_tokens
  where call_session_id = p_call_session_id
    and token_hash = p_token_hash
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  if v_row.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  if v_row.use_count >= v_row.max_uses then
    return jsonb_build_object('ok', false, 'error', 'already_used');
  end if;

  update public.call_invite_tokens
  set
    use_count = use_count + 1,
    used_at = coalesce(used_at, now()),
    used_by = auth.uid()
  where id = v_row.id;

  return jsonb_build_object(
    'ok', true,
    'token_id', v_row.id,
    'use_count', v_row.use_count + 1,
    'max_uses', v_row.max_uses
  );
end;
$$;

revoke all on function public.consume_call_invite_token(uuid, text) from public;
grant execute on function public.consume_call_invite_token(uuid, text) to authenticated;
grant execute on function public.consume_call_invite_token(uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 3) call_events — creator may read timeline (host UX / debugging)
-- ----------------------------------------------------------------------------
drop policy if exists "Select call events for participants" on public.call_events;
create policy "Select call events for participants"
  on public.call_events
  for select
  to authenticated
  using (
    public.is_call_participant(call_session_id)
    or exists (
      select 1
      from public.call_sessions cs
      where cs.id = call_events.call_session_id
        and cs.creator_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 4) call_participants — invitee may insert self (token join path)
--    (policy already exists; ensure host insert unchanged)
-- ----------------------------------------------------------------------------
drop policy if exists "Invitee can insert self via token join" on public.call_participants;
create policy "Invitee can insert self via token join"
  on public.call_participants
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and role = 'participant'
    and exists (
      select 1
      from public.call_invite_tokens t
      where t.call_session_id = call_participants.call_session_id
        and t.expires_at > now()
        and t.use_count < t.max_uses
    )
  );

notify pgrst, 'reload schema';
