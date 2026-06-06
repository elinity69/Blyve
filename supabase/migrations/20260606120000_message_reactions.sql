-- Message reactions: one row per (message_id, user_id, emoji).
-- Covers both DM messages and group messages.
-- Idempotent — safe to run multiple times.

create table if not exists public.message_reactions (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  emoji       text not null check (char_length(emoji) between 1 and 8),
  created_at  timestamptz not null default now()
);

-- One reaction per (message, user, emoji) — enforces toggle semantics.
create unique index if not exists message_reactions_message_user_emoji_idx
  on public.message_reactions (message_id, user_id, emoji);

-- Fast lookup by message for reaction bar aggregation.
create index if not exists message_reactions_message_id_idx
  on public.message_reactions (message_id);

-- RLS
alter table public.message_reactions enable row level security;

-- ── SELECT ────────────────────────────────────────────────────────────────────
-- A user can read reactions on a message if they are a participant of the
-- conversation (DM) or a member of the group (group channel).
drop policy if exists "reaction_select" on public.message_reactions;
create policy "reaction_select" on public.message_reactions
  for select using (
    auth.uid() is not null
    and (
      -- DM: user is a participant of the conversation that contains this message
      exists (
        select 1 from public.messages m
        join public.conversations c on c.id = m.conversation_id
        where m.id = message_reactions.message_id
          and (c.user1_id = auth.uid() or c.user2_id = auth.uid())
      )
      -- Group: user is a member of the group that owns this message
      or exists (
        select 1 from public.group_messages gm
        join public.group_members mb on mb.group_id = gm.group_id
        where gm.id = message_reactions.message_id
          and mb.user_id = auth.uid()
      )
    )
  );

-- ── INSERT ────────────────────────────────────────────────────────────────────
-- A user can only insert their own reaction, and only on messages they can see.
drop policy if exists "reaction_insert" on public.message_reactions;
create policy "reaction_insert" on public.message_reactions
  for insert with check (
    auth.uid() = user_id
    and (
      -- DM participant
      exists (
        select 1 from public.messages m
        join public.conversations c on c.id = m.conversation_id
        where m.id = message_reactions.message_id
          and (c.user1_id = auth.uid() or c.user2_id = auth.uid())
      )
      -- Group member
      or exists (
        select 1 from public.group_messages gm
        join public.group_members mb on mb.group_id = gm.group_id
        where gm.id = message_reactions.message_id
          and mb.user_id = auth.uid()
      )
    )
  );

-- ── DELETE ────────────────────────────────────────────────────────────────────
-- A user can only delete their own reactions.
drop policy if exists "reaction_delete" on public.message_reactions;
create policy "reaction_delete" on public.message_reactions
  for delete using (auth.uid() = user_id);

-- ── REALTIME ──────────────────────────────────────────────────────────────────
do $$
begin
  begin
    alter publication supabase_realtime add table public.message_reactions;
  exception when duplicate_object then
    null;
  end;
end $$;

alter table public.message_reactions replica identity full;
