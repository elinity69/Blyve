-- Chat UI / useChat.markAsRead expects is_read + read_at on public.messages.

alter table public.messages add column if not exists is_read boolean not null default false;
alter table public.messages add column if not exists read_at timestamptz;

notify pgrst, 'reload schema';
