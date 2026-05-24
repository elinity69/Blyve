-- ============================================================================
-- Blyve: Discord-like Groups / Channels System
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. GROUPS
-- ----------------------------------------------------------------------------
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  creator_id uuid not null references public.profiles(id) on delete cascade,
  is_private boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint groups_name_length check (char_length(name) between 2 and 60),
  constraint groups_description_length check (
    description is null or char_length(description) <= 500
  )
);

comment on table public.groups is 'Discord-like groups/servers for Blyve.';
comment on column public.groups.is_private is 'If true, only members can view the group.';

-- ----------------------------------------------------------------------------
-- 2. GROUP MEMBERS
-- ----------------------------------------------------------------------------
create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member',
  joined_at timestamptz not null default now(),
  unique(group_id, user_id),
  constraint group_members_role_check check (role in ('admin', 'member'))
);

comment on table public.group_members is 'Memberships for Blyve groups.';
comment on column public.group_members.role is 'admin or member';

-- ----------------------------------------------------------------------------
-- 3. GROUP MESSAGES
-- ----------------------------------------------------------------------------
create table if not exists public.group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_messages_content_length check (char_length(content) between 1 and 4000)
);

comment on table public.group_messages is 'Messages inside Blyve groups/channels.';

-- ----------------------------------------------------------------------------
-- 4. UPDATED_AT TRIGGER FUNCTION
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_groups_updated_at on public.groups;
create trigger set_groups_updated_at
before update on public.groups
for each row
execute function public.set_updated_at();

drop trigger if exists set_group_messages_updated_at on public.group_messages;
create trigger set_group_messages_updated_at
before update on public.group_messages
for each row
execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. ENABLE RLS
-- ----------------------------------------------------------------------------
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_messages enable row level security;

-- ----------------------------------------------------------------------------
-- 6. RLS: GROUPS
-- ----------------------------------------------------------------------------
drop policy if exists "View groups" on public.groups;
create policy "View groups"
  on public.groups
  for select
  to authenticated
  using (
    is_private = false
    or exists (
      select 1
      from public.group_members gm
      where gm.group_id = groups.id
        and gm.user_id = auth.uid()
    )
  );

drop policy if exists "Create groups" on public.groups;
create policy "Create groups"
  on public.groups
  for insert
  to authenticated
  with check (creator_id = auth.uid());

drop policy if exists "Update groups as admin" on public.groups;
create policy "Update groups as admin"
  on public.groups
  for update
  to authenticated
  using (
    creator_id = auth.uid()
    or exists (
      select 1
      from public.group_members gm
      where gm.group_id = groups.id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  )
  with check (
    creator_id = auth.uid()
    or exists (
      select 1
      from public.group_members gm
      where gm.group_id = groups.id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  );

drop policy if exists "Delete groups as admin" on public.groups;
create policy "Delete groups as admin"
  on public.groups
  for delete
  to authenticated
  using (
    creator_id = auth.uid()
    or exists (
      select 1
      from public.group_members gm
      where gm.group_id = groups.id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  );

-- ----------------------------------------------------------------------------
-- 7. RLS: GROUP MEMBERS
-- ----------------------------------------------------------------------------
drop policy if exists "View group members" on public.group_members;
create policy "View group members"
  on public.group_members
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.groups g
      where g.id = group_members.group_id
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

drop policy if exists "Insert group members" on public.group_members;
create policy "Insert group members"
  on public.group_members
  for insert
  to authenticated
  with check (
    (
      user_id = auth.uid()
      and exists (
        select 1
        from public.groups g
        where g.id = group_members.group_id
          and g.is_private = false
      )
    )
    or exists (
      select 1
      from public.group_members gm
      where gm.group_id = group_members.group_id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  );

drop policy if exists "Update group members as admin" on public.group_members;
create policy "Update group members as admin"
  on public.group_members
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.group_members gm
      where gm.group_id = group_members.group_id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.group_members gm
      where gm.group_id = group_members.group_id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  );

drop policy if exists "Delete group members" on public.group_members;
create policy "Delete group members"
  on public.group_members
  for delete
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.group_members gm
      where gm.group_id = group_members.group_id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  );

-- ----------------------------------------------------------------------------
-- 8. RLS: GROUP MESSAGES
-- ----------------------------------------------------------------------------
drop policy if exists "View group messages" on public.group_messages;
create policy "View group messages"
  on public.group_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.groups g
      where g.id = group_messages.group_id
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

drop policy if exists "Insert group messages" on public.group_messages;
create policy "Insert group messages"
  on public.group_messages
  for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1
      from public.group_members gm
      where gm.group_id = group_messages.group_id
        and gm.user_id = auth.uid()
    )
  );

drop policy if exists "Update own group messages" on public.group_messages;
create policy "Update own group messages"
  on public.group_messages
  for update
  to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

drop policy if exists "Delete group messages" on public.group_messages;
create policy "Delete group messages"
  on public.group_messages
  for delete
  to authenticated
  using (
    sender_id = auth.uid()
    or exists (
      select 1
      from public.group_members gm
      where gm.group_id = group_messages.group_id
        and gm.user_id = auth.uid()
        and gm.role = 'admin'
    )
  );

-- ----------------------------------------------------------------------------
-- 9. INDEXE
-- ----------------------------------------------------------------------------
create index if not exists idx_groups_creator_id on public.groups(creator_id);
create index if not exists idx_groups_created_at on public.groups(created_at desc);
create index if not exists idx_group_members_group_id on public.group_members(group_id);
create index if not exists idx_group_members_user_id on public.group_members(user_id);
create index if not exists idx_group_members_group_user on public.group_members(group_id, user_id);
create index if not exists idx_group_messages_group_id on public.group_messages(group_id);
create index if not exists idx_group_messages_sender_id on public.group_messages(sender_id);
create index if not exists idx_group_messages_created_at on public.group_messages(created_at desc);
create index if not exists idx_group_messages_group_created on public.group_messages(group_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 10. CREATOR AUTOMATISCH ALS ADMIN EINTRAGEN
-- ----------------------------------------------------------------------------
create or replace function public.add_group_creator_as_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.group_members (group_id, user_id, role)
  values (new.id, new.creator_id, 'admin')
  on conflict (group_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_add_group_creator_as_member on public.groups;
create trigger trg_add_group_creator_as_member
after insert on public.groups
for each row
execute function public.add_group_creator_as_member();
