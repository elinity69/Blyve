-- Fix: messages sent by the current user were inserted with is_read=true/read_at=now()
-- to prevent a false unread badge on new-device login.
-- That was unnecessary because the unread count query already filters
-- .neq('sender_id', currentUserId), so own messages are excluded regardless of is_read.
-- Side-effect of is_read=true on send: the "read" tick showed instantly on every sent
-- message even though the recipient had not yet opened the chat.
-- Fix: insert with default is_read=false/read_at=null. The neq(sender_id) filter handles badges.

create or replace function public.send_message_safe(
  p_conversation_id uuid,
  p_content         text,
  p_reply_to_message_id uuid default null,
  p_attachment_ids  uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid            uuid    := auth.uid();
  v_mid            uuid;
  v_text           text    := trim(coalesce(p_content, ''));
  v_has_attachments boolean := p_attachment_ids is not null and cardinality(p_attachment_ids) > 0;
  v_preview        text;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'message', 'Not authenticated');
  end if;

  if length(v_text) = 0 and not v_has_attachments then
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
      return jsonb_build_object('success', false, 'message', 'Reply target not found');
    end if;
  end if;

  if v_has_attachments then
    if exists (
      select 1 from public.message_attachments a
      where a.id = any (p_attachment_ids)
        and (
          a.uploader_id <> v_uid
          or a.status <> 'ready'
          or a.conversation_id is distinct from p_conversation_id
          or a.dm_message_id is not null
        )
    ) then
      return jsonb_build_object('success', false, 'message', 'Invalid attachments');
    end if;
  end if;

  if length(v_text) = 0 and v_has_attachments then
    select coalesce(a.public_url, '📎 Anhang')
    into v_preview
    from public.message_attachments a
    where a.id = p_attachment_ids[1]
    limit 1;
  else
    v_preview := v_text;
  end if;

  -- is_read / read_at intentionally omitted (default false / null).
  -- The unread count query uses .neq('sender_id', currentUserId) which already
  -- excludes the sender's own messages — no need to mark them pre-read.
  -- Setting is_read=true here caused the read tick to appear instantly on every
  -- sent message before the recipient had opened the chat.
  insert into public.messages (conversation_id, sender_id, content, reply_to_message_id)
  values (p_conversation_id, v_uid, coalesce(nullif(v_text, ''), v_preview), p_reply_to_message_id)
  returning id into v_mid;

  if v_has_attachments then
    update public.message_attachments a
    set dm_message_id = v_mid
    where a.id = any (p_attachment_ids)
      and a.uploader_id = v_uid
      and a.status = 'ready'
      and a.conversation_id = p_conversation_id;
  end if;

  update public.conversations
  set
    last_message    = v_preview,
    last_message_at = now(),
    updated_at      = now()
  where id = p_conversation_id;

  return jsonb_build_object('success', true, 'message_id', v_mid);
end;
$$;

grant execute on function public.send_message_safe(uuid, text, uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
