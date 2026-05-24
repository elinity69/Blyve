-- Blyve: Discord-style channel categories

create table if not exists public.group_channel_categories (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  position int not null default 0,
  created_at timestamptz not null default now(),
  constraint group_channel_categories_name_length check (char_length(name) between 1 and 80)
);

create index if not exists idx_group_channel_categories_group_id
  on public.group_channel_categories(group_id);

create unique index if not exists idx_group_channel_categories_group_name
  on public.group_channel_categories(group_id, lower(name));

comment on table public.group_channel_categories is 'Discord-style channel category headers inside a group.';

alter table public.group_channels
  add column if not exists category_id uuid
  references public.group_channel_categories(id) on delete set null;

create index if not exists idx_group_channels_category_id
  on public.group_channels(category_id);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.group_channel_categories enable row level security;

drop policy if exists "View group channel categories" on public.group_channel_categories;
create policy "View group channel categories"
  on public.group_channel_categories
  for select
  to authenticated
  using (public.is_group_member(group_id));

drop policy if exists "Insert group channel categories as admin" on public.group_channel_categories;
create policy "Insert group channel categories as admin"
  on public.group_channel_categories
  for insert
  to authenticated
  with check (public.is_group_admin(group_id));

drop policy if exists "Update group channel categories as admin" on public.group_channel_categories;
create policy "Update group channel categories as admin"
  on public.group_channel_categories
  for update
  to authenticated
  using (public.is_group_admin(group_id))
  with check (public.is_group_admin(group_id));

drop policy if exists "Delete group channel categories as admin" on public.group_channel_categories;
create policy "Delete group channel categories as admin"
  on public.group_channel_categories
  for delete
  to authenticated
  using (public.is_group_admin(group_id));

-- Realtime (optional sidebar sync)
do $$
begin
  begin
    alter publication supabase_realtime add table public.group_channel_categories;
  exception when duplicate_object then
    null;
  end;
end $$;

alter table public.group_channel_categories replica identity full;

notify pgrst, 'reload schema';
