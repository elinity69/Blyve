-- Legacy DBs may have conversation_views without unique(conversation_id, user_id).
-- The client upserts with onConflict: 'conversation_id,user_id', which requires that constraint.

do $$
begin
  if to_regclass('public.conversation_views') is null then
    return;
  end if;

  -- Keep the row with the latest last_viewed_at per (conversation_id, user_id).
  delete from public.conversation_views cv
  where cv.id in (
    select id
    from (
      select
        id,
        row_number() over (
          partition by conversation_id, user_id
          order by last_viewed_at desc nulls last, id
        ) as rn
      from public.conversation_views
      where conversation_id is not null
        and user_id is not null
    ) ranked
    where rn > 1
  );

  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'conversation_views'
      and c.contype = 'u'
      and pg_get_constraintdef(c.oid) like '%conversation_id%'
      and pg_get_constraintdef(c.oid) like '%user_id%'
  ) and not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'conversation_views'
      and indexdef like '%unique%'
      and indexdef like '%conversation_id%'
      and indexdef like '%user_id%'
  ) then
    create unique index conversation_views_conversation_id_user_id_key
      on public.conversation_views (conversation_id, user_id);
  end if;
end $$;

notify pgrst, 'reload schema';
