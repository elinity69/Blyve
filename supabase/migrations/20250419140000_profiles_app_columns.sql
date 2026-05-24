-- Blyve: profile columns for comms-first app (no legacy sport/dating fields).
-- Voraussetzung: Tabelle public.profiles existiert (z. B. Auth-Trigger).
--
-- Entfernt Legacy-Spalten falls vorhanden, legt nur noch benötigte Spalten an.

-- ---------------------------------------------------------------------------
-- Legacy: sport/geo/dating inventory (removed)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS filter_strict_sports,
  DROP COLUMN IF EXISTS sports,
  DROP COLUMN IF EXISTS sport_level,
  DROP COLUMN IF EXISTS interested_in_levels,
  DROP COLUMN IF EXISTS gender_preference,
  DROP COLUMN IF EXISTS min_age_preference,
  DROP COLUMN IF EXISTS max_age_preference,
  DROP COLUMN IF EXISTS location_name,
  DROP COLUMN IF EXISTS latitude,
  DROP COLUMN IF EXISTS longitude,
  DROP COLUMN IF EXISTS search_radius,
  DROP COLUMN IF EXISTS location,
  DROP COLUMN IF EXISTS swipes_today,
  DROP COLUMN IF EXISTS boosts_count,
  DROP COLUMN IF EXISTS superlikes_count,
  DROP COLUMN IF EXISTS boosted_until,
  DROP COLUMN IF EXISTS height;

-- ---------------------------------------------------------------------------
-- Kern-Profil
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verified boolean DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS images text[] DEFAULT ARRAY[]::text[];

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS ghost_mode boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS dark_mode boolean DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_complete boolean DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pronouns text,
  ADD COLUMN IF NOT EXISTS favorite_food text,
  ADD COLUMN IF NOT EXISTS age integer;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
