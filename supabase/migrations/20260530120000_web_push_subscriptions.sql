-- Web Push: device subscriptions + DB triggers to invoke send-push edge function.

create extension if not exists pg_net with schema extensions;

-- ----------------------------------------------------------------------------
-- Push subscriptions (one row per browser/device endpoint)
-- ----------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists idx_push_subscriptions_user_id
  on public.push_subscriptions (user_id);

comment on table public.push_subscriptions is 'Web Push endpoints for PWA notifications (VAPID).';

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own
  on public.push_subscriptions for select
  using (auth.uid() = user_id);

drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own
  on public.push_subscriptions for insert
  with check (auth.uid() = user_id);

drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own
  on public.push_subscriptions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own
  on public.push_subscriptions for delete
  using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Server-side webhook config (service role only — set after deploy, see docs/web-push-pwa.md)
-- ----------------------------------------------------------------------------
create schema if not exists private;

create table if not exists private.push_settings (
  key text primary key,
  value text not null
);

revoke all on schema private from public;
revoke all on private.push_settings from public, authenticated, anon;
grant usage on schema private to service_role;
grant select, insert, update, delete on private.push_settings to service_role;

comment on table private.push_settings is
  'Push webhook URL + secret for pg_net → send-push edge function. Configure via SQL after deploy.';

-- ----------------------------------------------------------------------------
-- pg_net → send-push (never blocks message inserts)
-- ----------------------------------------------------------------------------
create or replace function private.invoke_send_push(payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, private
as $$
declare
  v_base_url text;
  v_secret text;
  v_request_id bigint;
begin
  select ps.value into v_base_url
  from private.push_settings ps
  where ps.key = 'functions_base_url';

  select ps.value into v_secret
  from private.push_settings ps
  where ps.key = 'webhook_secret';

  if coalesce(v_base_url, '') = '' or coalesce(v_secret, '') = '' then
    return null;
  end if;

  select net.http_post(
    url := rtrim(v_base_url, '/') || '/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-blyve-push-secret', v_secret
    ),
    body := payload
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function private.invoke_send_push(jsonb) from public, authenticated, anon;
grant execute on function private.invoke_send_push(jsonb) to service_role;

create or replace function public.trigger_dm_push_notification()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, private
as $$
begin
  perform private.invoke_send_push(jsonb_build_object(
    'type', 'dm',
    'message_id', NEW.id,
    'conversation_id', NEW.conversation_id,
    'sender_id', NEW.sender_id,
    'content', left(coalesce(NEW.content, ''), 500)
  ));
  return NEW;
exception
  when others then
    return NEW;
end;
$$;

create or replace function public.trigger_group_push_notification()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, private
as $$
begin
  perform private.invoke_send_push(jsonb_build_object(
    'type', 'group',
    'message_id', NEW.id,
    'group_id', NEW.group_id,
    'channel_id', NEW.channel_id,
    'sender_id', NEW.sender_id,
    'content', left(coalesce(NEW.content, ''), 500)
  ));
  return NEW;
exception
  when others then
    return NEW;
end;
$$;

drop trigger if exists on_message_insert_push on public.messages;
create trigger on_message_insert_push
  after insert on public.messages
  for each row
  execute function public.trigger_dm_push_notification();

drop trigger if exists on_group_message_insert_push on public.group_messages;
create trigger on_group_message_insert_push
  after insert on public.group_messages
  for each row
  execute function public.trigger_group_push_notification();

notify pgrst, 'reload schema';
