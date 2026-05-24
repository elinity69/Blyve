-- ============================================================================
-- Blyve Calls / Streaming Foundation (LiveKit metadata + control plane)
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. CALL SESSIONS
-- ----------------------------------------------------------------------------
create table if not exists public.call_sessions (
  id uuid primary key default gen_random_uuid(),

  call_type text not null check (call_type in ('audio', 'video', 'screen')),

  context_type text not null check (context_type in ('direct', 'group')),
  conversation_id uuid null references public.conversations (id) on delete set null,
  group_id uuid null references public.groups (id) on delete cascade,

  creator_id uuid not null references public.profiles (id) on delete cascade,

  room_name text not null unique,

  status text not null default 'ringing'
    check (status in ('ringing', 'active', 'ended', 'missed', 'cancelled', 'declined')),

  started_at timestamptz null,
  ended_at timestamptz null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint call_sessions_room_name_length check (char_length(room_name) between 3 and 120),

  constraint call_sessions_context_check check (
    (context_type = 'direct' and conversation_id is not null and group_id is null)
    or
    (context_type = 'group' and group_id is not null and conversation_id is null)
  )
);

comment on table public.call_sessions is 'Call metadata for Blyve voice/video/screen-share sessions.';
comment on column public.call_sessions.room_name is 'Mapped to LiveKit room name.';
comment on column public.call_sessions.context_type is 'direct = DM call, group = group/server call.';

-- ----------------------------------------------------------------------------
-- 2. CALL PARTICIPANTS
-- ----------------------------------------------------------------------------
create table if not exists public.call_participants (
  id uuid primary key default gen_random_uuid(),

  call_session_id uuid not null references public.call_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,

  role text not null default 'participant'
    check (role in ('host', 'participant')),

  invite_status text not null default 'pending'
    check (invite_status in ('pending', 'accepted', 'declined', 'missed', 'left', 'removed')),

  joined_at timestamptz null,
  left_at timestamptz null,

  is_muted boolean not null default false,
  is_camera_on boolean not null default true,
  is_screen_sharing boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (call_session_id, user_id)
);

comment on table public.call_participants is 'Participants and invite state per call session.';
comment on column public.call_participants.invite_status is 'Tracks ringing/accept/leave state for each user.';

-- ----------------------------------------------------------------------------
-- 3. CALL EVENTS
-- ----------------------------------------------------------------------------
create table if not exists public.call_events (
  id uuid primary key default gen_random_uuid(),

  call_session_id uuid not null references public.call_sessions (id) on delete cascade,
  user_id uuid null references public.profiles (id) on delete set null,

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

comment on table public.call_events is 'Audit/event timeline for call state changes.';

-- ----------------------------------------------------------------------------
-- 4. UPDATED_AT TRIGGER (scoped name to avoid collisions)
-- ----------------------------------------------------------------------------
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
for each row
execute function public.set_call_tables_updated_at();

drop trigger if exists set_call_participants_updated_at on public.call_participants;
create trigger set_call_participants_updated_at
before update on public.call_participants
for each row
execute function public.set_call_tables_updated_at();

-- ----------------------------------------------------------------------------
-- 5. RLS
-- ----------------------------------------------------------------------------
alter table public.call_sessions enable row level security;
alter table public.call_participants enable row level security;
alter table public.call_events enable row level security;

drop policy if exists "Select call sessions for participants" on public.call_sessions;
create policy "Select call sessions for participants"
  on public.call_sessions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.call_participants cp
      where cp.call_session_id = call_sessions.id
        and cp.user_id = auth.uid()
    )
  );

drop policy if exists "Create call sessions" on public.call_sessions;
create policy "Create call sessions"
  on public.call_sessions
  for insert
  to authenticated
  with check (
    creator_id = auth.uid()
  );

drop policy if exists "Update own created call sessions" on public.call_sessions;
create policy "Update own created call sessions"
  on public.call_sessions
  for update
  to authenticated
  using (
    creator_id = auth.uid()
    or exists (
      select 1
      from public.call_participants cp
      where cp.call_session_id = call_sessions.id
        and cp.user_id = auth.uid()
        and cp.role = 'host'
    )
  )
  with check (
    creator_id = auth.uid()
    or exists (
      select 1
      from public.call_participants cp
      where cp.call_session_id = call_sessions.id
        and cp.user_id = auth.uid()
        and cp.role = 'host'
    )
  );

drop policy if exists "Select own call participants rows" on public.call_participants;
create policy "Select own call participants rows"
  on public.call_participants
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Select call participants in my calls" on public.call_participants;
create policy "Select call participants in my calls"
  on public.call_participants
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.call_participants mine
      where mine.call_session_id = call_participants.call_session_id
        and mine.user_id = auth.uid()
    )
  );

drop policy if exists "Insert self into call participants" on public.call_participants;
create policy "Insert self into call participants"
  on public.call_participants
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
  );

drop policy if exists "Host can insert participants" on public.call_participants;
create policy "Host can insert participants"
  on public.call_participants
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.call_sessions cs
      where cs.id = call_participants.call_session_id
        and cs.creator_id = auth.uid()
    )
  );

drop policy if exists "Update own participant row" on public.call_participants;
create policy "Update own participant row"
  on public.call_participants
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "Host can update participants" on public.call_participants;
create policy "Host can update participants"
  on public.call_participants
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.call_sessions cs
      where cs.id = call_participants.call_session_id
        and cs.creator_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.call_sessions cs
      where cs.id = call_participants.call_session_id
        and cs.creator_id = auth.uid()
    )
  );

drop policy if exists "Select call events for participants" on public.call_events;
create policy "Select call events for participants"
  on public.call_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.call_participants cp
      where cp.call_session_id = call_events.call_session_id
        and cp.user_id = auth.uid()
    )
  );

drop policy if exists "Insert call events for participants" on public.call_events;
create policy "Insert call events for participants"
  on public.call_events
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    or user_id is null
  );

-- ----------------------------------------------------------------------------
-- 6. INDEXES
-- ----------------------------------------------------------------------------
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

create index if not exists idx_call_events_call_session_id
  on public.call_events (call_session_id);

create index if not exists idx_call_events_created_at
  on public.call_events (created_at desc);

notify pgrst, 'reload schema';
