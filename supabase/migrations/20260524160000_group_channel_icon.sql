-- Blyve: optional channel icon / profile image

alter table public.group_channels
  add column if not exists icon_url text;

comment on column public.group_channels.icon_url is 'Optional public URL for a channel icon (stored in avatars bucket).';

notify pgrst, 'reload schema';
