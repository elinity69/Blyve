-- Reply-to-message support for DMs and group channels

alter table public.messages
  add column if not exists reply_to_message_id uuid references public.messages(id) on delete set null;

alter table public.group_messages
  add column if not exists reply_to_message_id uuid references public.group_messages(id) on delete set null;

create index if not exists messages_reply_to_message_id_idx
  on public.messages (reply_to_message_id)
  where reply_to_message_id is not null;

create index if not exists group_messages_reply_to_message_id_idx
  on public.group_messages (reply_to_message_id)
  where reply_to_message_id is not null;

drop function if exists public.send_message_safe(uuid, text);

create or replace function public.send_message_safe(
  p_conversation_id uuid,
  p_content text,
  p_reply_to_message_id uuid default null
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

  if p_reply_to_message_id is not null then
    if not exists (
      select 1
      from public.messages m
      where m.id = p_reply_to_message_id
        and m.conversation_id = p_conversation_id
    ) then
      return jsonb_build_object('success', false, 'message', 'Invalid reply target');
    end if;
  end if;

  insert into public.messages (conversation_id, sender_id, content, reply_to_message_id)
  values (p_conversation_id, v_uid, v_text, p_reply_to_message_id)
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

grant execute on function public.send_message_safe(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
