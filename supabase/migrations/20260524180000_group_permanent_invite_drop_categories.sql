-- Blyve: permanent group invite code + remove channel categories

-- ----------------------------------------------------------------------------
-- 1. Drop channel categories (text/voice type is enough)
-- ----------------------------------------------------------------------------
alter table public.group_channels
  drop column if exists category_id;

drop table if exists public.group_channel_categories cascade;

-- ----------------------------------------------------------------------------
-- 2. Permanent invite code on each group
-- ----------------------------------------------------------------------------
alter table public.groups
  add column if not exists invite_code text;

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
    select exists(
      select 1
      from public.groups g
      where upper(g.invite_code) = v_code
      union all
      select 1
      from public.group_invites gi
      where upper(gi.code) = v_code
    ) into v_exists;
    exit when not v_exists;
  end loop;
  return v_code;
end;
$$;

update public.groups g
set invite_code = public.generate_group_invite_code()
where g.invite_code is null or trim(g.invite_code) = '';

alter table public.groups
  alter column invite_code set not null;

create unique index if not exists idx_groups_invite_code_unique
  on public.groups (upper(invite_code));

comment on column public.groups.invite_code is 'Permanent server invite code; admin can refresh to invalidate old links.';

create or replace function public.ensure_group_invite_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.invite_code is null or trim(new.invite_code) = '' then
    new.invite_code := public.generate_group_invite_code();
  end if;
  return new;
end;
$$;

drop trigger if exists tr_groups_set_invite_code on public.groups;
create trigger tr_groups_set_invite_code
before insert on public.groups
for each row
execute function public.ensure_group_invite_code();

create or replace function public.refresh_group_invite_code(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;
  if not public.is_group_admin(p_group_id, auth.uid()) then
    raise exception 'forbidden';
  end if;

  v_code := public.generate_group_invite_code();
  update public.groups
  set invite_code = v_code,
      updated_at = now()
  where id = p_group_id;

  if not found then
    raise exception 'group_not_found';
  end if;

  return v_code;
end;
$$;

revoke all on function public.refresh_group_invite_code(uuid) from public;
grant execute on function public.refresh_group_invite_code(uuid) to authenticated, service_role;

create or replace function public.consume_group_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_group_id uuid;
  v_normalized text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  v_normalized := upper(trim(coalesce(p_code, '')));
  if length(v_normalized) < 6 then
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;

  select g.id
  into v_group_id
  from public.groups g
  where upper(g.invite_code) = v_normalized;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, v_user, 'member')
  on conflict (group_id, user_id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'group_id', v_group_id,
    'already_member', public.is_group_member(v_group_id, v_user)
  );
end;
$$;

notify pgrst, 'reload schema';
