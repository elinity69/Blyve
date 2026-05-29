-- Theme: light | dark | oled (pure black surfaces, gray chat bubbles unchanged in app CSS)

alter table public.profiles
  add column if not exists theme_mode text;

update public.profiles
set theme_mode = case
  when coalesce(dark_mode, true) = false then 'light'
  else 'dark'
end
where theme_mode is null
   or theme_mode not in ('light', 'dark', 'oled');

alter table public.profiles
  alter column theme_mode set default 'dark';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_theme_mode_check'
  ) then
    alter table public.profiles
      add constraint profiles_theme_mode_check
      check (theme_mode in ('light', 'dark', 'oled'));
  end if;
end $$;

-- Keep legacy dark_mode in sync for older clients
update public.profiles
set dark_mode = (theme_mode <> 'light')
where theme_mode is not null;

notify pgrst, 'reload schema';
