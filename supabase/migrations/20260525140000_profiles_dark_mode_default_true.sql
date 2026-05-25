-- Default new profiles to dark mode (light mode is opt-in in settings).
ALTER TABLE public.profiles
  ALTER COLUMN dark_mode SET DEFAULT true;
