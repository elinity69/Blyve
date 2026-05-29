-- DM message delete (own messages only, conversation participants).

create or replace function public.delete_message_safe(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_conversation_id uuid;
  v_deleted_at timestamptz;
  v_last_content text;
  v_last_at timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'message', 'Not authenticated');
  end if;

  select m.conversation_id, m.created_at
  into v_conversation_id, v_deleted_at
  from public.messages m
  where m.id = p_message_id
    and m.sender_id = v_uid;

  if v_conversation_id is null then
    return jsonb_build_object('success', false, 'message', 'Message not found or not allowed');
  end if;

  if not exists (
    select 1
    from public.conversations c
    where c.id = v_conversation_id
      and (c.user1_id = v_uid or c.user2_id = v_uid)
  ) then
    return jsonb_build_object('success', false, 'message', 'Not a participant');
  end if;

  delete from public.messages
  where id = p_message_id
    and sender_id = v_uid;

  select m.content, m.created_at
  into v_last_content, v_last_at
  from public.messages m
  where m.conversation_id = v_conversation_id
  order by m.created_at desc
  limit 1;

  update public.conversations
  set
    last_message = v_last_content,
    last_message_at = coalesce(v_last_at, v_deleted_at),
    updated_at = now()
  where id = v_conversation_id;

  return jsonb_build_object(
    'success', true,
    'conversation_id', v_conversation_id,
    'last_message', v_last_content,
    'last_message_at', v_last_at
  );
end;
$$;

grant execute on function public.delete_message_safe(uuid) to authenticated;

notify pgrst, 'reload schema';
