-- 🔥 ERWEITERUNG: Fehlende Felder für vollständige Kompatibilität
-- Führe DIESES Script NACH dem Basis-Setup aus

-- Füge fehlende Felder hinzu (idempotent)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS pronouns TEXT,
ADD COLUMN IF NOT EXISTS height INTEGER,
ADD COLUMN IF NOT EXISTS favorite_food TEXT,
ADD COLUMN IF NOT EXISTS ghost_mode BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP WITH TIME ZONE;

-- Erstelle Indizes für bessere Performance
CREATE INDEX IF NOT EXISTS idx_profiles_location ON public.profiles USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_profiles_sports ON public.profiles USING GIN(sports);
CREATE INDEX IF NOT EXISTS idx_profiles_is_premium ON public.profiles(is_premium);
CREATE INDEX IF NOT EXISTS idx_profiles_is_boosted ON public.profiles(is_boosted);
CREATE INDEX IF NOT EXISTS idx_profiles_swipes_today ON public.profiles(swipes_today);

-- Optional: Stelle sicher, dass imageurl und images konsistent sind
-- (Supabase normalisiert Spaltennamen zu lowercase, also 'imageurl' sollte funktionieren)
-- Falls du 'imageUrl' (camelCase) verwendest, musst du es in Anführungszeichen setzen: "imageUrl"

-- Hinweis: 
-- - 'imageurl' (lowercase) wird von Supabase automatisch unterstützt
-- - 'images' (Array) ist bereits im SQL-Code vorhanden
-- - Mein Code verwendet beide: imageUrl (für Hauptbild) und images[] (für mehrere Bilder)

