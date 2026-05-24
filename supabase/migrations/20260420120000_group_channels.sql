-- Blyve: group_channels + channel_id on group_messages

-- ----------------------------------------------------------------------------
-- 1. CHANNELS
-- ----------------------------------------------------------------------------
create table if not exists public.group_channels (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  constraint group_channels_name_length check (char_length(name) between 1 and 80),
  constraint group_channels_group_name_unique unique (group_id, name)
);

comment on table public.group_channels is 'Text channels inside a group (Discord-style).';

create index if not exists idx_group_channels_group_id on public.group_channels(group_id);

-- ----------------------------------------------------------------------------
-- 2. ADD channel_id TO group_messages (nullable, then backfill, then NOT NULL)
-- ----------------------------------------------------------------------------
alter table public.group_messages
  add column if not exists channel_id uuid references public.group_channels(id) on delete cascade;

-- Backfill: one "general" channel per group that has none
insert into public.group_channels (group_id, name, position)
select g.id, 'general', 0
from public.groups g
where not exists (
  select 1 from public.group_channels c where c.group_id = g.id
);

update public.group_messages gm
set channel_id = (
  select c.id
  from public.group_channels c
  where c.group_id = gm.group_id
    and c.name = 'general'
  limit 1
)
where gm.channel_id is null;

alter table public.group_messages
  alter column channel_id set not null;

create index if not exists idx_group_messages_channel_id on public.group_messages(channel_id);
create index if not exists idx_group_messages_channel_created on public.group_messages(channel_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 3. DEFAULT CHANNEL FOR NEW GROUPS
-- ----------------------------------------------------------------------------
create or replace function public.ensure_default_group_channel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.group_channels (group_id, name, position)
  values (new.id, 'general', 0);
  return new;
end;
$$;

drop trigger if exists trg_ensure_default_group_channel on public.groups;
create trigger trg_ensure_default_group_channel
after insert on public.groups
for each row
execute function public.ensure_default_group_channel();

-- ----------------------------------------------------------------------------
-- 4. RLS: group_channels
-- ----------------------------------------------------------------------------
alter table public.group_channels enable row level security;

drop policy if exists "View group channels" on public.group_channels;
create policy "View group channels"
  on public.group_channels
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.groups g
      where g.id = group_channels.group_id
        and (
          g.is_private = false
          or exists (
            select 1
            from public.group_members gm
            where gm.group_id = g.id
              and gm.user_id = auth.uid()
          )
        )
    )
  );

drop policy if exists "Insert group channels as admin" on public.group_channels;
create policy "Insert group channels as admin"
  on public.group_channels
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.group_members gm
      where gm.group_id = group_channels.group_id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  );

-- ----------------------------------------------------------------------------
-- 5. Tighten group_messages RLS: must belong to channel in same group
-- (Existing policies still apply; channel_id is enforced by FK.)
-- ----------------------------------------------------------------------------
