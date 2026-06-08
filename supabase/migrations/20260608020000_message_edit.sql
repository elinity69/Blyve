-- Add edited_at to DM messages so the "edited" indicator can be shown in the UI.

alter table public.messages
  add column if not exists edited_at timestamptz;

-- RPC: let the message sender update content in place.
create or replace function public.update_message_safe(
  p_message_id uuid,
  p_content    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_text text := trim(coalesce(p_content, ''));
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'message', 'Not authenticated');
  end if;

  if length(v_text) = 0 then
    return jsonb_build_object('success', false, 'message', 'Empty content');
  end if;

  update public.messages
  set content   = v_text,
      edited_at = now()
  where id        = p_message_id
    and sender_id = v_uid;

  if not found then
    return jsonb_build_object('success', false, 'message', 'Message not found or not yours');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.update_message_safe(uuid, text) to authenticated;

notify pgrst, 'reload schema';
