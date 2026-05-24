-- Fix: Stelle sicher, dass beim User-Erstellen die E-Mail korrekt in profiles kopiert wird
-- Führe dieses Skript im Supabase SQL Editor aus

-- 1. Lösche alte Trigger falls vorhanden
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- 2. Erstelle/Ersetze die Funktion, die beim User-Erstellen aufgerufen wird
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Erstelle Profil mit E-Mail aus auth.users
  -- WICHTIG: Exception-Handling, damit Trigger nicht abstürzt
  BEGIN
    INSERT INTO public.profiles (
      id,
      email,
      onboarding_complete,
      created_at,
      updated_at
    )
    VALUES (
      NEW.id,
      COALESCE(NEW.email, ''), -- WICHTIG: E-Mail wird direkt aus auth.users kopiert, Fallback auf leeren String
      false, -- WICHTIG: onboarding_complete muss false sein, damit Onboarding angezeigt wird
      NOW(),
      NOW()
    )
    ON CONFLICT (id) DO UPDATE
    SET 
      email = COALESCE(
        NULLIF(EXCLUDED.email, ''), -- Verwende neue E-Mail, wenn sie nicht leer ist
        NULLIF(profiles.email, ''), -- Sonst behalte alte E-Mail, wenn sie nicht leer ist
        COALESCE(NEW.email, '')     -- Sonst nimm E-Mail aus auth.users
      ),
      -- WICHTIG: onboarding_complete nur setzen, wenn es noch nicht gesetzt wurde (nicht überschreiben)
      onboarding_complete = COALESCE(profiles.onboarding_complete, false),
      updated_at = NOW();
  EXCEPTION WHEN OTHERS THEN
    -- Log Fehler, aber verhindere Absturz
    RAISE WARNING 'Error in handle_new_user trigger: %', SQLERRM;
    -- Versuche Update als Fallback
    UPDATE public.profiles
    SET email = COALESCE(NEW.email, email, '')
    WHERE id = NEW.id;
  END;
  
  RETURN NEW;
END;
$$;

-- 3. Erstelle Trigger, der beim User-Erstellen ausgelöst wird
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 4. Fix: Aktualisiere bestehende Profile, die keine E-Mail haben
UPDATE public.profiles p
SET email = au.email
FROM auth.users au
WHERE p.id = au.id
  AND (p.email IS NULL OR p.email = '');
