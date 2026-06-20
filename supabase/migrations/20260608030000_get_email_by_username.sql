-- Expose a secure username → email resolver so the client-side login flow
-- can accept either an email or a username as the login identifier.
--
-- security definer + explicit search_path lets this function read auth.users
-- (which is otherwise invisible to the anon/authenticated roles) without
-- granting broad access to the auth schema.

create or replace function public.get_email_by_username(p_username text)
returns text
language plpgsql
security definer
stable
set search_path = public, auth
as $$
declare
  v_user_id uuid;
  v_email   text;
begin
  -- 1. Resolve username → profile id (case-insensitive)
  select id
    into v_user_id
    from public.profiles
   where lower(username) = lower(trim(p_username))
   limit 1;

  if v_user_id is null then
    return null;
  end if;

  -- 2. Fetch email from auth.users (only readable via security definer)
  select email
    into v_email
    from auth.users
   where id = v_user_id
   limit 1;

  return v_email;
end;
$$;

-- Allow unauthenticated callers (anon role) so the pre-login lookup works.
grant execute on function public.get_email_by_username(text) to anon, authenticated;

notify pgrst, 'reload schema';