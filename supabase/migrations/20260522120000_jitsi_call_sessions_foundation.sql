-- ============================================================================
-- Blyve Jitsi Call Sessions — schema extensions + RLS
-- Replaces LiveKit-oriented room naming with server-side Jitsi room slugs.
-- Safe to run on existing call_sessions / call_participants / call_events.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1) Status values: add "joining" (media handoff after accept)
-- ----------------------------------------------------------------------------
alter table public.call_sessions
  drop constraint if exists call_sessions_status_check;

alter table public.call_sessions
  add constraint call_sessions_status_check
  check (status in (
    'ringing',
    'joining',
    'active',
    'ended',
    'missed',
    'cancelled',
    'declined'
  ));

alter table public.call_participants
  drop constraint if exists call_participants_invite_status_check;

alter table public.call_participants
  add constraint call_participants_invite_status_check
  check (invite_status in (
    'pending',
    'accepted',
    'joining',
    'declined',
    'missed',
    'left',
    'removed'
  ));

comment on column public.call_sessions.room_name is
  'Server-generated Jitsi room slug. Never expose to clients until accept/join is authorized.';

comment on column public.call_sessions.creator_id is
  'User who initiated the call (created_by).';

comment on column public.call_sessions.call_type is
  'Media type: audio | video | screen.';

comment on column public.call_participants.invite_status is
  'Participant lifecycle: pending → accepted/joining → left | declined | missed.';

-- ----------------------------------------------------------------------------
-- 2) Server-side Jitsi room name generator (UUID slug, collision-safe)
-- ----------------------------------------------------------------------------
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
    -- blyve_<32 hex chars> — unpredictable, not derived from session id
    candidate := 'blyve_' || replace(gen_random_uuid()::text, '-', '');
    exit when not exists (
      select 1
      from public.call_sessions cs
      where cs.room_name = candidate
    );
  end loop;
  return candidate;
end;
$$;

revoke all on function public.generate_call_room_name() from public;
grant execute on function public.generate_call_room_name() to authenticated;
grant execute on function public.generate_call_room_name() to service_role;

-- ----------------------------------------------------------------------------
-- 3) Optional invite tokens (hashed at rest; plain token only returned once)
-- ----------------------------------------------------------------------------
create table if not exists public.call_invite_tokens (
  id uuid primary key default gen_random_uuid(),

  call_session_id uuid not null
    references public.call_sessions (id) on delete cascade,

  token_hash text not null unique,

  created_by uuid not null
    references public.profiles (id) on delete cascade,

  expires_at timestamptz not null,
  used_at timestamptz null,
  used_by uuid null references public.profiles (id) on delete set null,

  max_uses integer not null default 1
    check (max_uses >= 1),

  use_count integer not null default 0
    check (use_count >= 0),

  created_at timestamptz not null default now(),

  constraint call_invite_tokens_use_count_lte_max
    check (use_count <= max_uses)
);

comment on table public.call_invite_tokens is
  'Single-use or limited-use invite tokens for joining a call session without guessing room_name.';

create index if not exists idx_call_invite_tokens_session_id
  on public.call_invite_tokens (call_session_id);

create index if not exists idx_call_invite_tokens_expires_at
  on public.call_invite_tokens (expires_at);

-- ----------------------------------------------------------------------------
-- 4) RLS — call_invite_tokens
-- ----------------------------------------------------------------------------
alter table public.call_invite_tokens enable row level security;

drop policy if exists "Select invite tokens for call participants" on public.call_invite_tokens;
create policy "Select invite tokens for call participants"
  on public.call_invite_tokens
  for select
  to authenticated
  using (public.is_call_participant(call_session_id));

drop policy if exists "Host can insert invite tokens" on public.call_invite_tokens;
create policy "Host can insert invite tokens"
  on public.call_invite_tokens
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1
      from public.call_sessions cs
      where cs.id = call_invite_tokens.call_session_id
        and cs.creator_id = auth.uid()
    )
  );

drop policy if exists "Host can update invite tokens" on public.call_invite_tokens;
create policy "Host can update invite tokens"
  on public.call_invite_tokens
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.call_sessions cs
      where cs.id = call_invite_tokens.call_session_id
        and cs.creator_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.call_sessions cs
      where cs.id = call_invite_tokens.call_session_id
        and cs.creator_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 5) Tighten call_sessions SELECT — creator may read own ringing sessions
--    (needed before participant rows exist in edge-case retries)
-- ----------------------------------------------------------------------------
drop policy if exists "Select call sessions for participants" on public.call_sessions;
create policy "Select call sessions for participants"
  on public.call_sessions
  for select
  to authenticated
  using (
    creator_id = auth.uid()
    or public.is_call_participant(id)
  );

-- Host inserts call_events for invited users (event_type ringing)
drop policy if exists "Insert call events for participants" on public.call_events;
create policy "Insert call events for participants"
  on public.call_events
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    or user_id is null
    or exists (
      select 1
      from public.call_sessions cs
      where cs.id = call_events.call_session_id
        and cs.creator_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 6) Realtime for invite tokens (optional incoming-link UX)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'call_invite_tokens'
  ) then
    alter publication supabase_realtime add table public.call_invite_tokens;
  end if;
end $$;

notify pgrst, 'reload schema';
