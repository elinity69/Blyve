-- User-scoped favorite GIFs / links (synced across devices)

create table if not exists public.favorite_embeds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  url text not null,
  kind text not null check (kind in ('image', 'giphy', 'tenor', 'link')),
  image_url text,
  giphy_id text,
  tenor_id text,
  saved_at timestamptz not null default now(),
  unique (user_id, url)
);

create index if not exists idx_favorite_embeds_user_saved
  on public.favorite_embeds (user_id, saved_at desc);

alter table public.favorite_embeds enable row level security;

drop policy if exists "favorite_embeds_own" on public.favorite_embeds;
create policy "favorite_embeds_own"
  on public.favorite_embeds
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
