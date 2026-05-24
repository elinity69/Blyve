-- *** FINALER CLEANUP: ALLES AUF UNTERSTRICHE (Standard) ***
-- Führe dieses Skript im Supabase SQL Editor aus
-- Dieses Skript vereinheitlicht ALLES auf Unterstriche (user_id, target_user_id, created_at)

-- 1. SPALTEN BEREINIGEN
DO $$ 
BEGIN
    -- userid -> user_id
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_schema = 'public' 
               AND table_name = 'swipes' 
               AND column_name = 'userid')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_schema = 'public' 
                    AND table_name = 'swipes' 
                    AND column_name = 'user_id') THEN
        ALTER TABLE public.swipes RENAME COLUMN userid TO user_id;
    END IF;

    -- targetuserid -> target_user_id
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_schema = 'public' 
               AND table_name = 'swipes' 
               AND column_name = 'targetuserid')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_schema = 'public' 
                    AND table_name = 'swipes' 
                    AND column_name = 'target_user_id') THEN
        ALTER TABLE public.swipes RENAME COLUMN targetuserid TO target_user_id;
    END IF;

    -- createdat -> created_at
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_schema = 'public' 
               AND table_name = 'swipes' 
               AND column_name = 'createdat')
    AND NOT EXISTS (SELECT 1 FROM information_schema.columns 
                    WHERE table_schema = 'public' 
                    AND table_name = 'swipes' 
                    AND column_name = 'created_at') THEN
        ALTER TABLE public.swipes RENAME COLUMN createdat TO created_at;
    END IF;

    -- Sicherstellen, dass 'type' existiert
    ALTER TABLE public.swipes ADD COLUMN IF NOT EXISTS type TEXT;
    
    -- Wenn type NULL ist, setze Standardwert basierend auf vorhandenen Daten
    UPDATE public.swipes SET type = 'like' WHERE type IS NULL;
END $$;

-- 2. CONSTRAINT NEU SETZEN (Passend zu den neuen Namen)
DO $$
BEGIN
    -- Lösche alle alten Constraints
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'swipes_userid_targetuserid_key') THEN
        ALTER TABLE public.swipes DROP CONSTRAINT swipes_userid_targetuserid_key;
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'swipes_user_id_targetuserid_key') THEN
        ALTER TABLE public.swipes DROP CONSTRAINT swipes_user_id_targetuserid_key;
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'swipes_user_id_target_user_id_key') THEN
        ALTER TABLE public.swipes DROP CONSTRAINT swipes_user_id_target_user_id_key;
    END IF;
    
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'swipes_unique_interaction') THEN
        ALTER TABLE public.swipes DROP CONSTRAINT swipes_unique_interaction;
    END IF;
END $$;

-- Erstelle neuen Constraint mit einheitlichen Namen
ALTER TABLE public.swipes
ADD CONSTRAINT swipes_unique_interaction UNIQUE (user_id, target_user_id);

-- 3. ALTE FUNKTIONEN LÖSCHEN (damit keine Verwirrung entsteht)
DROP FUNCTION IF EXISTS public.handle_superlike(uuid);
DROP FUNCTION IF EXISTS public.handlesuperlike(uuid);
DROP FUNCTION IF EXISTS public.handle_swipe(uuid, boolean);

-- 4. NEUE, SAUBERE FUNKTION ERSTELLEN (Name: handlesuperlike, Parameter: targetid)
CREATE OR REPLACE FUNCTION public.handlesuperlike(targetid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  is_match BOOLEAN := FALSE;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Insert (nutzt jetzt target_user_id und created_at mit Unterstrichen)
  INSERT INTO public.swipes (user_id, target_user_id, type, created_at)
  VALUES (current_user_id, targetid, 'superlike', now())
  ON CONFLICT (user_id, target_user_id) DO UPDATE
  SET type = 'superlike', created_at = now();

  -- Match Check
  SELECT EXISTS (
    SELECT 1 FROM public.swipes 
    WHERE user_id = targetid 
      AND target_user_id = current_user_id 
      AND type IN ('like', 'superlike')
  ) INTO is_match;

  -- Wenn Match, in matches Tabelle eintragen
  IF is_match THEN
    INSERT INTO public.matches (user1_id, user2_id, created_at)
    VALUES (LEAST(current_user_id, targetid), GREATEST(current_user_id, targetid), now())
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN is_match;
END;
$$;

-- 5. NEUE, SAUBERE handle_swipe FUNKTION (für normale Likes/Dislikes)
CREATE OR REPLACE FUNCTION public.handle_swipe(
  target_id UUID,
  liked_value BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  my_id UUID := auth.uid();
  is_match BOOLEAN := FALSE;
BEGIN
  IF my_id IS NULL THEN 
    RAISE EXCEPTION 'Not authenticated'; 
  END IF;

  -- Dislike: Just insert/update the swipe
  IF liked_value = false THEN
    INSERT INTO public.swipes (user_id, target_user_id, type, created_at)
    VALUES (my_id, target_id, 'dislike', now())
    ON CONFLICT (user_id, target_user_id) DO UPDATE
    SET type = 'dislike', created_at = now();
    
    -- Update swipe count
    UPDATE public.profiles 
    SET swipes_today = COALESCE(swipes_today, 0) + 1 
    WHERE id = my_id;
    
    RETURN FALSE; -- No match for dislike
  END IF;

  -- Like: Insert/update the swipe
  INSERT INTO public.swipes (user_id, target_user_id, type, created_at)
  VALUES (my_id, target_id, 'like', now())
  ON CONFLICT (user_id, target_user_id) DO UPDATE
  SET type = 'like', created_at = now();

  -- Match Check: Check if target user also liked me
  IF EXISTS (
    SELECT 1 FROM public.swipes 
    WHERE user_id = target_id 
    AND target_user_id = my_id 
    AND type IN ('like', 'superlike')
  ) THEN
    -- Match gefunden!
    INSERT INTO public.matches (user1_id, user2_id, created_at)
    VALUES (LEAST(my_id, target_id), GREATEST(my_id, target_id), now())
    ON CONFLICT DO NOTHING;
    is_match := TRUE;
  END IF;

  -- Update swipe count
  UPDATE public.profiles 
  SET swipes_today = COALESCE(swipes_today, 0) + 1 
  WHERE id = my_id;

  RETURN is_match;
END;
$$;

-- Berechtigungen
GRANT EXECUTE ON FUNCTION public.handlesuperlike(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.handle_swipe(UUID, BOOLEAN) TO authenticated;
