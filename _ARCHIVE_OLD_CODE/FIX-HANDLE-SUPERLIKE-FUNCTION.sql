-- Fix handle_superlike function to use liked and is_superlike columns
-- Führe dieses Skript im Supabase SQL Editor aus

-- Drop existing function
DROP FUNCTION IF EXISTS public.handle_superlike(uuid);

-- Create corrected function with liked and is_superlike
CREATE OR REPLACE FUNCTION public.handle_superlike(
  target_id UUID
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

  -- Insert with liked=true and is_superlike=true
  INSERT INTO public.swipes (user_id, target_user_id, liked, is_superlike, created_at)
  VALUES (my_id, target_id, true, true, now())
  ON CONFLICT (user_id, target_user_id) DO UPDATE
  SET liked = true, is_superlike = true, created_at = now();

  -- Match Check: Check if target user also liked me (liked=true)
  IF EXISTS (
    SELECT 1 FROM public.swipes 
    WHERE user_id = target_id 
    AND target_user_id = my_id 
    AND liked = true
  ) THEN
    -- Match gefunden!
    INSERT INTO public.matches (user1_id, user2_id, created_at)
    VALUES (LEAST(my_id, target_id), GREATEST(my_id, target_id), now())
    ON CONFLICT DO NOTHING;
    is_match := TRUE;
  END IF;

  -- Swipes zählen
  UPDATE public.profiles 
  SET swipes_today = COALESCE(swipes_today, 0) + 1 
  WHERE id = my_id;

  RETURN is_match;
END;
$$;
