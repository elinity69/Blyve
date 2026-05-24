-- ============================================================================
-- Blyve Calls — COMPLETE SQL (LiveKit + Jitsi parallel)
-- ============================================================================
-- Tabellen : call_sessions, call_participants, call_events, call_invite_tokens
-- RPCs     : is_call_participant, generate_call_room_name,
--            get_call_session_for_join, consume_call_invite_token
-- Edge     : createCallSession, acceptCall, joinCall, invite, endCall
-- Client   : room_name + jitsiDomain nur via joinCall / accept (Jitsi)
--
-- Voraussetzung: public.profiles, public.conversations, public.groups existieren.
-- Ausführung    : Supabase SQL Editor (frische DB) ODER schrittweise via migrations/.
-- Idempotent    : CREATE IF NOT EXISTS + DROP POLICY IF EXISTS wo nötig.
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- 1) HELPER — RLS ohne Rekursion auf call_participants
-- ============================================================================
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
grant execute on function public.is_call_participant(uuid) to service_role;

-- ============================================================================
-- 2) call_sessions
-- ============================================================================
create table if not exists public.call_sessions (
  id uuid primary key default gen_random_uuid(),

  call_type text not null
    check (call_type in ('audio', 'video', 'screen')),

  context_type text not null
    check (context_type in ('direct', 'group')),

  conversation_id uuid null
    references public.conversations (id) on delete set null,
  group_id uuid null
    references public.groups (id) on delete cascade,

  creator_id uuid not null
    references public.profiles (id) on delete cascade,

  room_name text not null unique,

  status text not null default 'ringing'
    check (status in (
      'ringing',
      'joining',
      'active',
      'ended',
      'missed',
      'cancelled',
      'declined'
    )),

  started_at timestamptz null,
  ended_at timestamptz null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint call_sessions_room_name_length
    check (char_length(room_name) between 3 and 120),

  constraint call_sessions_context_check check (
    (context_type = 'direct' and conversation_id is not null and group_id is null)
    or
    (context_type = 'group' and group_id is not null and conversation_id is null)
  )
);

comment on table public.call_sessions is
  'Call-Session (LiveKit + Jitsi). room_name serverseitig; Jitsi-Raum erst nach joinCall freigeben.';
comment on column public.call_sessions.room_name is
  'Server-generierter Raum-Slug (blyve_<hex>). Nicht clientseitig setzen.';
comment on column public.call_sessions.creator_id is
  'User der den Call initiiert hat.';
comment on column public.call_sessions.status is
  'ringing → joining → active → ended|missed|cancelled|declined';

-- Status-Constraint aktualisieren falls alte Migration ohne "joining"
alter table public.call_sessions drop constraint if exists call_sessions_status_check;
alter table public.call_sessions add constraint call_sessions_status_check
  check (status in (
    'ringing', 'joining', 'active', 'ended', 'missed', 'cancelled', 'declined'
  ));

-- ============================================================================
-- 3) call_participants
-- ============================================================================
create table if not exists public.call_participants (
  id uuid primary key default gen_random_uuid(),

  call_session_id uuid not null
    references public.call_sessions (id) on delete cascade,
  user_id uuid not null
    references public.profiles (id) on delete cascade,

  role text not null default 'participant'
    check (role in ('host', 'participant')),

  invite_status text not null default 'pending'
    check (invite_status in (
      'pending',
      'accepted',
      'joining',
      'declined',
      'missed',
      'left',
      'removed'
    )),

  joined_at timestamptz null,
  left_at timestamptz null,

  is_muted boolean not null default false,
  is_camera_on boolean not null default true,
  is_screen_sharing boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (call_session_id, user_id)
);

comment on table public.call_participants is
  'Teilnehmer + Invite-Status pro Session.';
comment on column public.call_participants.invite_status is
  'pending → joining/accepted → left | declined | missed | removed';

alter table public.call_participants drop constraint if exists call_participants_invite_status_check;
alter table public.call_participants add constraint call_participants_invite_status_check
  check (invite_status in (
    'pending', 'accepted', 'joining', 'declined', 'missed', 'left', 'removed'
  ));

-- ============================================================================
-- 4) call_events
-- ============================================================================
create table if not exists public.call_events (
  id uuid primary key default gen_random_uuid(),

  call_session_id uuid not null
    references public.call_sessions (id) on delete cascade,
  user_id uuid null
    references public.profiles (id) on delete set null,

  event_type text not null check (
    event_type in (
      'created',
      'ringing',
      'accepted',
      'declined',
      'joined',
      'left',
      'ended',
      'missed',
      'screen_started',
      'screen_stopped'
    )
  ),

  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.call_events is 'Audit-/Event-Timeline für Calls.';

-- ============================================================================
-- 5) call_invite_tokens (Invite-Link: /call/join?session=&token=)
-- ============================================================================
create table if not exists public.call_invite_tokens (
  id uuid primary key default gen_random_uuid(),

  call_session_id uuid not null
    references public.call_sessions (id) on delete cascade,

  token_hash text not null unique,

  created_by uuid not null
    references public.profiles (id) on delete cascade,

  expires_at timestamptz not null,
  used_at timestamptz null,
  used_by uuid null
    references public.profiles (id) on delete set null,

  max_uses integer not null default 1
    check (max_uses >= 1),

  use_count integer not null default 0
    check (use_count >= 0),

  created_at timestamptz not null default now(),

  constraint call_invite_tokens_use_count_lte_max
    check (use_count <= max_uses)
);

comment on table public.call_invite_tokens is
  'Invite-Tokens (Hash at rest). Plain-Token nur einmal in inviteLink zurück.';

-- ============================================================================
-- 6) updated_at Trigger
-- ============================================================================
create or replace function public.set_call_tables_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_call_sessions_updated_at on public.call_sessions;
create trigger set_call_sessions_updated_at
  before update on public.call_sessions
  for each row execute function public.set_call_tables_updated_at();

drop trigger if exists set_call_participants_updated_at on public.call_participants;
create trigger set_call_participants_updated_at
  before update on public.call_participants
  for each row execute function public.set_call_tables_updated_at();

-- ============================================================================
-- 7) RPC — serverseitiger Jitsi-Raumname (nicht aus Session-ID ableitbar)
-- ============================================================================
create or replace function public.generate_call_room_name()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate text;
begin
  loop
    candidate := 'blyve_' || replace(gen_random_uuid()::text, '-', '');
    exit when not exists (
      select 1 from public.call_sessions cs where cs.room_name = candidate
    );
  end loop;
  return candidate;
end;
$$;

revoke all on function public.generate_call_room_name() from public;
grant execute on function public.generate_call_room_name() to authenticated;
grant execute on function public.generate_call_room_name() to service_role;

-- ============================================================================
-- 8) RPC — joinCall: Session lesen (Creator | Teilnehmer | gültiger Invite-Token)
-- ============================================================================
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

  select * into v_session
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

-- ============================================================================
-- 9) RPC — joinCall: Invite-Token atomisch verbrauchen
-- ============================================================================
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

  select * into v_row
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

-- ============================================================================
-- 10) INDEXES
-- ============================================================================
create index if not exists idx_call_sessions_creator_id
  on public.call_sessions (creator_id);
create index if not exists idx_call_sessions_group_id
  on public.call_sessions (group_id);
create index if not exists idx_call_sessions_conversation_id
  on public.call_sessions (conversation_id);
create index if not exists idx_call_sessions_status
  on public.call_sessions (status);
create index if not exists idx_call_sessions_created_at
  on public.call_sessions (created_at desc);

create index if not exists idx_call_participants_call_session_id
  on public.call_participants (call_session_id);
create index if not exists idx_call_participants_user_id
  on public.call_participants (user_id);
create index if not exists idx_call_participants_call_user
  on public.call_participants (call_session_id, user_id);
create index if not exists idx_call_participants_invite_status
  on public.call_participants (user_id, invite_status)
  where left_at is null;

create index if not exists idx_call_events_call_session_id
  on public.call_events (call_session_id);
create index if not exists idx_call_events_created_at
  on public.call_events (created_at desc);

create index if not exists idx_call_invite_tokens_session_id
  on public.call_invite_tokens (call_session_id);
create index if not exists idx_call_invite_tokens_expires_at
  on public.call_invite_tokens (expires_at);
create index if not exists idx_call_invite_tokens_token_hash
  on public.call_invite_tokens (token_hash);

-- ============================================================================
-- 11) ROW LEVEL SECURITY
-- ============================================================================
alter table public.call_sessions enable row level security;
alter table public.call_participants enable row level security;
alter table public.call_events enable row level security;
alter table public.call_invite_tokens enable row level security;

-- ---- call_sessions ----
drop policy if exists "Select call sessions for participants" on public.call_sessions;
create policy "Select call sessions for participants"
  on public.call_sessions for select to authenticated
  using (
    creator_id = auth.uid()
    or public.is_call_participant(id)
  );

drop policy if exists "Create call sessions" on public.call_sessions;
create policy "Create call sessions"
  on public.call_sessions for insert to authenticated
  with check (creator_id = auth.uid());

drop policy if exists "Update own created call sessions" on public.call_sessions;
create policy "Update own created call sessions"
  on public.call_sessions for update to authenticated
  using (
    creator_id = auth.uid()
    or exists (
      select 1 from public.call_participants cp
      where cp.call_session_id = call_sessions.id
        and cp.user_id = auth.uid()
        and cp.role = 'host'
    )
  )
  with check (
    creator_id = auth.uid()
    or exists (
      select 1 from public.call_participants cp
      where cp.call_session_id = call_sessions.id
        and cp.user_id = auth.uid()
        and cp.role = 'host'
    )
  );

-- ---- call_participants ----
drop policy if exists "Select own call participants rows" on public.call_participants;
create policy "Select own call participants rows"
  on public.call_participants for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "Select call participants in my calls" on public.call_participants;
create policy "Select call participants in my calls"
  on public.call_participants for select to authenticated
  using (public.is_call_participant(call_session_id));

drop policy if exists "Insert self into call participants" on public.call_participants;
create policy "Insert self into call participants"
  on public.call_participants for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Host can insert participants" on public.call_participants;
create policy "Host can insert participants"
  on public.call_participants for insert to authenticated
  with check (
    exists (
      select 1 from public.call_sessions cs
      where cs.id = call_participants.call_session_id
        and cs.creator_id = auth.uid()
    )
  );

drop policy if exists "Invitee can insert self via token join" on public.call_participants;
create policy "Invitee can insert self via token join"
  on public.call_participants for insert to authenticated
  with check (
    user_id = auth.uid()
    and role = 'participant'
    and exists (
      select 1 from public.call_invite_tokens t
      where t.call_session_id = call_participants.call_session_id
        and t.expires_at > now()
        and t.use_count < t.max_uses
    )
  );

drop policy if exists "Update own participant row" on public.call_participants;
create policy "Update own participant row"
  on public.call_participants for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Host can update participants" on public.call_participants;
create policy "Host can update participants"
  on public.call_participants for update to authenticated
  using (
    exists (
      select 1 from public.call_sessions cs
      where cs.id = call_participants.call_session_id
        and cs.creator_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.call_sessions cs
      where cs.id = call_participants.call_session_id
        and cs.creator_id = auth.uid()
    )
  );

-- ---- call_events ----
drop policy if exists "Select call events for participants" on public.call_events;
create policy "Select call events for participants"
  on public.call_events for select to authenticated
  using (
    public.is_call_participant(call_session_id)
    or exists (
      select 1 from public.call_sessions cs
      where cs.id = call_events.call_session_id
        and cs.creator_id = auth.uid()
    )
  );

drop policy if exists "Insert call events for participants" on public.call_events;
create policy "Insert call events for participants"
  on public.call_events for insert to authenticated
  with check (
    user_id = auth.uid()
    or user_id is null
    or exists (
      select 1 from public.call_sessions cs
      where cs.id = call_events.call_session_id
        and cs.creator_id = auth.uid()
    )
  );

-- ---- call_invite_tokens ----
drop policy if exists "Select invite tokens for call participants" on public.call_invite_tokens;
create policy "Select invite tokens for call participants"
  on public.call_invite_tokens for select to authenticated
  using (public.is_call_participant(call_session_id));

drop policy if exists "Host can insert invite tokens" on public.call_invite_tokens;
create policy "Host can insert invite tokens"
  on public.call_invite_tokens for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.call_sessions cs
      where cs.id = call_invite_tokens.call_session_id
        and cs.creator_id = auth.uid()
    )
  );

drop policy if exists "Host can update invite tokens" on public.call_invite_tokens;
create policy "Host can update invite tokens"
  on public.call_invite_tokens for update to authenticated
  using (
    exists (
      select 1 from public.call_sessions cs
      where cs.id = call_invite_tokens.call_session_id
        and cs.creator_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.call_sessions cs
      where cs.id = call_invite_tokens.call_session_id
        and cs.creator_id = auth.uid()
    )
  );

-- ============================================================================
-- 12) REALTIME (Frontend: IncomingCall + Session-Updates)
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'call_sessions'
  ) then
    alter publication supabase_realtime add table public.call_sessions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'call_participants'
  ) then
    alter publication supabase_realtime add table public.call_participants;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'call_invite_tokens'
  ) then
    alter publication supabase_realtime add table public.call_invite_tokens;
  end if;
end $$;

notify pgrst, 'reload schema';

-- ============================================================================
-- FERTIG — Edge Function Secrets (8x8 JaaS):
--   JITSI_DOMAIN=8x8.vc
--   JITSI_APP_ID=vpaas-magic-cookie-…
--   JITSI_API_KEY_ID=vpaas-magic-cookie-…/…   (kid from JaaS dashboard)
--   JITSI_API_PRIVATE_KEY=-----BEGIN PRIVATE KEY----- …
--   APP_URL=https://deine-app.example.com
-- LiveKit (Fallback, unverändert):
--   LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
-- Frontend:
--   VITE_CALL_PROVIDER=jitsi | livekit
-- ============================================================================
