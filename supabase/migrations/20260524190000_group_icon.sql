-- Blyve: optional group / server icon

alter table public.groups
  add column if not exists icon_url text;

comment on column public.groups.icon_url is 'Optional public URL for a group/server icon (stored in avatars bucket).';

notify pgrst, 'reload schema';
