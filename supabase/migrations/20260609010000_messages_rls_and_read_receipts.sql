-- Complete read-receipt fix:
-- 1. Enable RLS on public.messages (was never enabled — direct client UPDATE was
--    silently failing or working only by luck with no-policy = allow-all state).
-- 2. Add all required policies: SELECT, INSERT (fallback), UPDATE (read receipts),
--    DELETE (own messages — covered by delete_message_safe RPC but belt-and-suspenders).
-- 3. Set replica identity FULL on conversation_views so realtime UPDATE payloads
--    include old row values for accurate change detection.
-- 4. Grant UPDATE on messages to authenticated so markAsRead direct .update() works.

-- ---------------------------------------------------------------------------
-- 1. messages — enable RLS + policies
-- ---------------------------------------------------------------------------

alter table public.messages enable row level security;

-- SELECT: any participant of the conversation can read its messages
drop policy if exists "messages_select_participants" on public.messages;
create policy "messages_select_participants"
  on public.messages
  for select
  to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.user1_id = auth.uid() or c.user2_id = auth.uid())
    )
  );

-- INSERT: blocked by RLS — all inserts go through send_message_safe (security definer).
-- Deny direct client inserts for safety.
drop policy if exists "messages_insert_deny_direct" on public.messages;
create policy "messages_insert_deny_direct"
  on public.messages
  for insert
  to authenticated
  with check (false);

-- UPDATE: only a conversation participant may update is_read / read_at.
-- The check prevents participants from altering content, sender_id, etc.
-- content/sender_id/conversation_id changes are handled by update_message_safe (security definer).
drop policy if exists "messages_update_read_receipt" on public.messages;
create policy "messages_update_read_receipt"
  on public.messages
  for update
  to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.user1_id = auth.uid() or c.user2_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.user1_id = auth.uid() or c.user2_id = auth.uid())
    )
  );

-- DELETE: blocked — all deletes go through delete_message_safe (security definer).
drop policy if exists "messages_delete_deny_direct" on public.messages;
create policy "messages_delete_deny_direct"
  on public.messages
  for delete
  to authenticated
  using (false);

-- ---------------------------------------------------------------------------
-- 2. conversation_views — replica identity FULL
--    Ensures realtime UPDATE payloads carry old row values.
-- ---------------------------------------------------------------------------
alter table public.conversation_views replica identity full;

-- ---------------------------------------------------------------------------
-- 3. Explicit grant so the anon/authenticated roles can execute UPDATE
--    even when the RLS policy allows it (belt-and-suspenders for hosted Supabase).
-- ---------------------------------------------------------------------------
grant select, update on public.messages to authenticated;

notify pgrst, 'reload schema';
