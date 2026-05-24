-- RPC used by api.sendMessageSafe / useChat (PostgREST: send_message_safe).
-- Some DBs have conversations without preview columns — add them before the RPC body runs.

alter table public.conversations add column if not exists last_message text;
alter table public.conversations add column if not exists last_message_at timestamptz;
alter table public.conversations add column if not exists updated_at timestamptz default now();

create or replace function public.send_message_safe(
  p_conversation_id uuid,
  p_content text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_mid uuid;
  v_text text := trim(coalesce(p_content, ''));
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'message', 'Not authenticated');
  end if;

  if length(v_text) = 0 then
    return jsonb_build_object('success', false, 'message', 'Empty content');
  end if;

  if not exists (
    select 1
    from public.conversations c
    where c.id = p_conversation_id
      and (c.user1_id = v_uid or c.user2_id = v_uid)
  ) then
    return jsonb_build_object('success', false, 'message', 'Not a participant');
  end if;

  insert into public.messages (conversation_id, sender_id, content)
  values (p_conversation_id, v_uid, v_text)
  returning id into v_mid;

  update public.conversations
  set
    last_message = v_text,
    last_message_at = now(),
    updated_at = now()
  where id = p_conversation_id;

  return jsonb_build_object('success', true, 'message_id', v_mid);
end;
$$;

grant execute on function public.send_message_safe(uuid, text) to authenticated;

notify pgrst, 'reload schema';
