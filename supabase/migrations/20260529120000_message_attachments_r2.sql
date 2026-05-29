-- Chat media metadata (files live in Cloudflare R2; keys + URLs stored here)

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references auth.users (id) on delete cascade,
  storage_key text not null,
  bucket_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  kind text not null check (kind in ('image', 'gif', 'video', 'audio', 'file')),
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  public_url text,
  original_filename text,
  width int,
  height int,
  duration_ms int,
  conversation_id uuid references public.conversations (id) on delete set null,
  group_id uuid references public.groups (id) on delete set null,
  channel_id uuid references public.group_channels (id) on delete set null,
  dm_message_id uuid references public.messages (id) on delete set null,
  group_message_id uuid references public.group_messages (id) on delete set null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint message_attachments_context_check check (
    (conversation_id is not null and group_id is null and channel_id is null)
    or (conversation_id is null and group_id is not null and channel_id is not null)
  )
);

create index if not exists message_attachments_uploader_status_idx
  on public.message_attachments (uploader_id, status);

create index if not exists message_attachments_dm_message_idx
  on public.message_attachments (dm_message_id)
  where dm_message_id is not null;

create index if not exists message_attachments_group_message_idx
  on public.message_attachments (group_message_id)
  where group_message_id is not null;

alter table public.message_attachments enable row level security;

create policy message_attachments_select_own_or_ready_participant
  on public.message_attachments
  for select
  to authenticated
  using (
    uploader_id = auth.uid()
    or (
      status = 'ready'
      and (
        (
          conversation_id is not null
          and exists (
            select 1
            from public.conversations c
            where c.id = message_attachments.conversation_id
              and (c.user1_id = auth.uid() or c.user2_id = auth.uid())
          )
        )
        or (
          group_id is not null
          and exists (
            select 1
            from public.group_members gm
            where gm.group_id = message_attachments.group_id
              and gm.user_id = auth.uid()
          )
        )
      )
    )
  );

create policy message_attachments_insert_own
  on public.message_attachments
  for insert
  to authenticated
  with check (uploader_id = auth.uid());

create policy message_attachments_update_own_pending
  on public.message_attachments
  for update
  to authenticated
  using (uploader_id = auth.uid() and status = 'pending')
  with check (uploader_id = auth.uid());

create policy message_attachments_update_own_ready_link
  on public.message_attachments
  for update
  to authenticated
  using (uploader_id = auth.uid() and status = 'ready')
  with check (uploader_id = auth.uid());

-- Link ready attachments after send (DM)
create or replace function public.link_dm_message_attachments(
  p_message_id uuid,
  p_attachment_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_conversation_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('success', false, 'message', 'Not authenticated');
  end if;

  if p_attachment_ids is null or cardinality(p_attachment_ids) = 0 then
    return jsonb_build_object('success', true);
  end if;

  select m.conversation_id into v_conversation_id
  from public.messages m
  where m.id = p_message_id and m.sender_id = v_uid;

  if v_conversation_id is null then
    return jsonb_build_object('success', false, 'message', 'Message not found');
  end if;

  update public.message_attachments a
  set dm_message_id = p_message_id
  where a.id = any (p_attachment_ids)
    and a.uploader_id = v_uid
    and a.status = 'ready'
    and a.conversation_id = v_conversation_id
    and a.dm_message_id is null;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.link_dm_message_attachments(uuid, uuid[]) to authenticated;

-- Extend send_message_safe: optional attachments, caption-only allowed with attachments
drop function if exists public.send_message_safe(uuid, text, uuid);

create or replace function public.send_message_safe(
  p_conversation_id uuid,
  p_content text,
  p_reply_to_message_id uuid default null,
  p_attachment_ids uuid[] default null
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
  v_has_attachments boolean := p_attachment_ids is not null and cardinality(p_attachment_ids) > 0;
  v_preview text;
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
      return jsonb_build_object('success', false, 'message', 'Invalid reply target');
    end if;
  end if;

  if v_has_attachments then
    if exists (
      select 1
      from unnest(p_attachment_ids) as aid(id)
      left join public.message_attachments a on a.id = aid.id
      where a.id is null
        or a.uploader_id <> v_uid
        or a.status <> 'ready'
        or a.conversation_id is distinct from p_conversation_id
        or a.dm_message_id is not null
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
    last_message = v_preview,
    last_message_at = now(),
    updated_at = now()
  where id = p_conversation_id;

  return jsonb_build_object('success', true, 'message_id', v_mid);
end;
$$;

grant execute on function public.send_message_safe(uuid, text, uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
