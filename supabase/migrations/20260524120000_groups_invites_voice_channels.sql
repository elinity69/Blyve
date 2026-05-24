-- Blyve: group invites, text/voice channel types, voice presence, group realtime

-- ----------------------------------------------------------------------------
-- 1. Channel types (text | voice)
-- ----------------------------------------------------------------------------
alter table public.group_channels
  add column if not exists type text not null default 'text';

alter table public.group_channels
  drop constraint if exists group_channels_type_check;

alter table public.group_channels
  add constraint group_channels_type_check
  check (type in ('text', 'voice'));

comment on column public.group_channels.type is 'text = chat channel, voice = Jitsi voice channel';

update public.group_channels
set type = 'text'
where type is null or type = '';

create or replace function public.ensure_default_group_channel()
returns trigger
language plpgsql
security definer
set search_path to public
set row_security to off
as $$
begin
  insert into public.group_channels (group_id, name, position, type)
  values (new.id, 'general', 0, 'text');
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Group invites
-- ----------------------------------------------------------------------------
create table if not exists public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  code text not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz,
  max_uses int,
  use_count int not null default 0,
  created_at timestamptz not null default now(),
  constraint group_invites_code_length check (char_length(code) between 6 and 32),
  constraint group_invites_max_uses_positive check (max_uses is null or max_uses > 0)
);

create unique index if not exists idx_group_invites_code_unique on public.group_invites (upper(code));
create index if not exists idx_group_invites_group_id on public.group_invites (group_id);

comment on table public.group_invites is 'Shareable invite codes for private (and public) Blyve groups.';

-- ----------------------------------------------------------------------------
-- 3. Voice channel sessions + presence
-- ----------------------------------------------------------------------------
alter table public.call_sessions
  add column if not exists channel_id uuid references public.group_channels(id) on delete set null;

create index if not exists idx_call_sessions_channel_id on public.call_sessions (channel_id);

create unique index if not exists idx_call_sessions_active_voice_channel
  on public.call_sessions (channel_id)
  where channel_id is not null and status in ('joining', 'active');

create table if not exists public.voice_channel_presence (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  channel_id uuid not null references public.group_channels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  call_session_id uuid not null references public.call_sessions(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (channel_id, user_id)
);

create index if not exists idx_voice_presence_channel on public.voice_channel_presence (channel_id);
create index if not exists idx_voice_presence_group on public.voice_channel_presence (group_id);
create index if not exists idx_voice_presence_session on public.voice_channel_presence (call_session_id);

comment on table public.voice_channel_presence is 'Who is currently connected to a group voice channel.';

-- ----------------------------------------------------------------------------
-- 4. Helpers
-- ----------------------------------------------------------------------------
create or replace function public.is_group_member(p_group_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = coalesce(p_user_id, auth.uid())
  );
$$;

create or replace function public.is_group_admin(p_group_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.user_id = coalesce(p_user_id, auth.uid())
      and gm.role = 'admin'
  )
  or exists (
    select 1
    from public.groups g
    where g.id = p_group_id
      and g.creator_id = coalesce(p_user_id, auth.uid())
  );
$$;

revoke all on function public.is_group_member(uuid, uuid) from public;
grant execute on function public.is_group_member(uuid, uuid) to authenticated, service_role;

revoke all on function public.is_group_admin(uuid, uuid) from public;
grant execute on function public.is_group_admin(uuid, uuid) to authenticated, service_role;

create or replace function public.generate_group_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_exists boolean;
begin
  loop
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    select exists(select 1 from public.group_invites gi where upper(gi.code) = v_code) into v_exists;
    exit when not v_exists;
  end loop;
  return v_code;
end;
$$;

revoke all on function public.generate_group_invite_code() from public;
grant execute on function public.generate_group_invite_code() to authenticated, service_role;

create or replace function public.consume_group_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_invite public.group_invites%rowtype;
  v_normalized text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  v_normalized := upper(trim(coalesce(p_code, '')));
  if length(v_normalized) < 6 then
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;

  select *
  into v_invite
  from public.group_invites gi
  where upper(gi.code) = v_normalized
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  if v_invite.max_uses is not null and v_invite.use_count >= v_invite.max_uses then
    return jsonb_build_object('ok', false, 'error', 'max_uses_reached');
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_invite.group_id, v_user, 'member')
  on conflict (group_id, user_id) do nothing;

  update public.group_invites
  set use_count = use_count + 1
  where id = v_invite.id;

  return jsonb_build_object(
    'ok', true,
    'group_id', v_invite.group_id,
    'already_member', public.is_group_member(v_invite.group_id, v_user)
  );
end;
$$;

revoke all on function public.consume_group_invite(text) from public;
grant execute on function public.consume_group_invite(text) to authenticated, service_role;

-- Voice channel join authorization in get_call_session_for_join
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
      or (
        cs.channel_id is not null
        and cs.group_id is not null
        and public.is_group_member(cs.group_id, auth.uid())
      )
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
    'started_at', v_session.started_at,
    'group_id', v_session.group_id,
    'channel_id', v_session.channel_id,
    'context_type', v_session.context_type
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. RLS: group_invites
-- ----------------------------------------------------------------------------
alter table public.group_invites enable row level security;

drop policy if exists "Admins view group invites" on public.group_invites;
create policy "Admins view group invites"
  on public.group_invites
  for select
  to authenticated
  using (public.is_group_admin(group_id));

drop policy if exists "Admins create group invites" on public.group_invites;
create policy "Admins create group invites"
  on public.group_invites
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and public.is_group_admin(group_id)
  );

drop policy if exists "Admins delete group invites" on public.group_invites;
create policy "Admins delete group invites"
  on public.group_invites
  for delete
  to authenticated
  using (public.is_group_admin(group_id));

-- ----------------------------------------------------------------------------
-- 6. RLS: voice_channel_presence
-- ----------------------------------------------------------------------------
alter table public.voice_channel_presence enable row level security;

drop policy if exists "Members view voice presence" on public.voice_channel_presence;
create policy "Members view voice presence"
  on public.voice_channel_presence
  for select
  to authenticated
  using (public.is_group_member(group_id));

drop policy if exists "Users manage own voice presence" on public.voice_channel_presence;
create policy "Users manage own voice presence"
  on public.voice_channel_presence
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and public.is_group_member(group_id)
  );

-- ----------------------------------------------------------------------------
-- 7. RLS: group_channels update/delete
-- ----------------------------------------------------------------------------
drop policy if exists "Update group channels as admin" on public.group_channels;
create policy "Update group channels as admin"
  on public.group_channels
  for update
  to authenticated
  using (public.is_group_admin(group_id))
  with check (public.is_group_admin(group_id));

drop policy if exists "Delete group channels as admin" on public.group_channels;
create policy "Delete group channels as admin"
  on public.group_channels
  for delete
  to authenticated
  using (
    public.is_group_admin(group_id)
    and name <> 'general'
  );

-- ----------------------------------------------------------------------------
-- 8. Realtime
-- ----------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.group_messages;
  exception when duplicate_object then
    null;
  end;

  begin
    alter publication supabase_realtime add table public.group_channels;
  exception when duplicate_object then
    null;
  end;

  begin
    alter publication supabase_realtime add table public.voice_channel_presence;
  exception when duplicate_object then
    null;
  end;
end $$;

alter table public.group_messages replica identity full;
alter table public.group_channels replica identity full;
alter table public.voice_channel_presence replica identity full;

notify pgrst, 'reload schema';
