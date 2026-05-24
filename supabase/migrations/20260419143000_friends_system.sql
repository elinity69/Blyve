-- Discord-like friends system
create table if not exists public.friends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  friend_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint friends_user_friend_unique unique (user_id, friend_id),
  constraint friends_not_self check (user_id <> friend_id),
  constraint friends_status_check check (status in ('pending', 'accepted', 'blocked'))
);

alter table public.friends enable row level security;

drop policy if exists "Own friends" on public.friends;
create policy "Own friends"
  on public.friends
  for all
  using (auth.uid() = user_id or auth.uid() = friend_id)
  with check (auth.uid() = user_id or auth.uid() = friend_id);

create index if not exists idx_friends_user on public.friends(user_id);
create index if not exists idx_friends_friend on public.friends(friend_id);
create index if not exists idx_friends_status on public.friends(status);
