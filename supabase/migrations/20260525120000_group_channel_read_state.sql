-- Persist group channel read cursors per user (replaces localStorage-only unread badges).

create table if not exists public.group_channel_read_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_id uuid not null references public.group_channels(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

comment on table public.group_channel_read_state is 'Per-user last-read timestamp for group text channels.';

create index if not exists idx_group_channel_read_state_channel
  on public.group_channel_read_state(channel_id);

alter table public.group_channel_read_state enable row level security;

drop policy if exists "group_channel_read_state_select_own" on public.group_channel_read_state;
create policy "group_channel_read_state_select_own"
  on public.group_channel_read_state
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "group_channel_read_state_upsert_own" on public.group_channel_read_state;
create policy "group_channel_read_state_upsert_own"
  on public.group_channel_read_state
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.mark_group_channel_read(
  p_channel_id uuid,
  p_read_at timestamptz default now()
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1
    from public.group_members gm
    join public.group_channels gc on gc.group_id = gm.group_id
    where gm.user_id = auth.uid()
      and gc.id = p_channel_id
  ) then
    raise exception 'forbidden';
  end if;

  insert into public.group_channel_read_state (user_id, channel_id, last_read_at, updated_at)
  values (auth.uid(), p_channel_id, p_read_at, now())
  on conflict (user_id, channel_id)
  do update set
    last_read_at = greatest(public.group_channel_read_state.last_read_at, excluded.last_read_at),
    updated_at = now();
end;
$$;

create or replace function public.get_group_unread_counts()
returns table (
  group_id uuid,
  channel_id uuid,
  unread_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    gc.group_id,
    gc.id as channel_id,
    count(gm.id)::bigint as unread_count
  from public.group_members gmship
  join public.group_channels gc
    on gc.group_id = gmship.group_id
   and coalesce(gc.type, 'text') <> 'voice'
  left join public.group_channel_read_state rs
    on rs.channel_id = gc.id
   and rs.user_id = gmship.user_id
  left join public.group_messages gm
    on gm.channel_id = gc.id
   and gm.sender_id <> gmship.user_id
   and gm.created_at > coalesce(rs.last_read_at, '1970-01-01'::timestamptz)
  where gmship.user_id = auth.uid()
  group by gc.group_id, gc.id;
$$;

grant execute on function public.mark_group_channel_read(uuid, timestamptz) to authenticated;
grant execute on function public.get_group_unread_counts() to authenticated;

-- Realtime for friend request badges
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'friends'
  ) then
    alter publication supabase_realtime add table public.friends;
  end if;
exception
  when others then null;
end $$;

alter table public.friends replica identity full;
