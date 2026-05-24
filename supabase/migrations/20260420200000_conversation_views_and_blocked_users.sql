-- Client expects: conversation_views.last_viewed_at + user_id; blocked_users.blocker_id + blocked_user_id
-- Legacy DBs may already have conversation_views with different column names (e.g. viewer_id, no user_id).

-- ---------------------------------------------------------------------------
-- 1) conversation_views: create OR align legacy, then indexes + RLS
-- ---------------------------------------------------------------------------
create table if not exists public.conversation_views (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_viewed_at timestamptz not null default now(),
  unique (conversation_id, user_id)
);

-- Legacy: table existed without user_id (create table was skipped)
do $$
begin
  if to_regclass('public.conversation_views') is null then
    return;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'conversation_views' and column_name = 'user_id'
  ) then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'conversation_views' and column_name = 'viewer_id'
    ) then
      alter table public.conversation_views rename column viewer_id to user_id;
    elsif exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'conversation_views' and column_name = 'profile_id'
    ) then
      alter table public.conversation_views rename column profile_id to user_id;
    else
      alter table public.conversation_views add column user_id uuid references public.profiles (id) on delete cascade;
      -- if rows exist without user_id, they stay null until cleaned up; app only inserts with user_id
    end if;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'conversation_views' and column_name = 'last_viewed_at'
  ) then
    alter table public.conversation_views add column last_viewed_at timestamptz not null default now();
  end if;
end $$;

-- Indexes only after user_id is guaranteed
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'conversation_views' and column_name = 'user_id'
  ) then
    create index if not exists idx_conversation_views_user on public.conversation_views (user_id);
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'conversation_views' and column_name = 'conversation_id'
  ) then
    create index if not exists idx_conversation_views_conversation on public.conversation_views (conversation_id);
  end if;
end $$;

alter table public.conversation_views enable row level security;

drop policy if exists "conversation_views_own" on public.conversation_views;
create policy "conversation_views_own"
  on public.conversation_views
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2) blocked_users
-- ---------------------------------------------------------------------------
create table if not exists public.blocked_users (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_user_id),
  constraint blocked_users_not_self check (blocker_id <> blocked_user_id)
);

do $$
begin
  if to_regclass('public.blocked_users') is null then
    return;
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'blocked_users' and column_name = 'blocked_user_id'
  ) then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'blocked_users' and column_name = 'blocked_id'
    ) then
      alter table public.blocked_users rename column blocked_id to blocked_user_id;
    end if;
  end if;
end $$;

create index if not exists idx_blocked_users_blocker on public.blocked_users (blocker_id);
create index if not exists idx_blocked_users_blocked on public.blocked_users (blocked_user_id);

alter table public.blocked_users enable row level security;

drop policy if exists "blocked_users_select_own" on public.blocked_users;
drop policy if exists "blocked_users_insert_blocker" on public.blocked_users;
drop policy if exists "blocked_users_delete_own" on public.blocked_users;

create policy "blocked_users_select_own"
  on public.blocked_users
  for select
  to authenticated
  using (blocker_id = auth.uid() or blocked_user_id = auth.uid());

create policy "blocked_users_insert_blocker"
  on public.blocked_users
  for insert
  to authenticated
  with check (blocker_id = auth.uid());

create policy "blocked_users_delete_own"
  on public.blocked_users
  for delete
  to authenticated
  using (blocker_id = auth.uid() or blocked_user_id = auth.uid());

notify pgrst, 'reload schema';
