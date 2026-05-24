-- Fix: Allow SECURITY DEFINER RPC functions to update protected columns
-- Problem: The protect_critical_columns trigger blocks RPC functions
-- Solution: Modify trigger to allow updates from SECURITY DEFINER functions

-- Step 1: Drop the existing trigger
DROP TRIGGER IF EXISTS tr_protect_profile ON public.profiles;

-- Step 2: Drop the existing function
DROP FUNCTION IF EXISTS public.protect_critical_columns();

-- Step 3: Create a new function that allows SECURITY DEFINER functions
-- SECURITY DEFINER functions run with elevated privileges and should be allowed
CREATE OR REPLACE FUNCTION public.protect_critical_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Check if protected columns are being changed
  IF (NEW.buddy_points IS DISTINCT FROM OLD.buddy_points) OR
     (NEW.is_premium IS DISTINCT FROM OLD.is_premium) OR
     (NEW.premium_expires_at IS DISTINCT FROM OLD.premium_expires_at) OR
     (NEW.swipes_today IS DISTINCT FROM OLD.swipes_today) OR
     (NEW.superlikes_count IS DISTINCT FROM OLD.superlikes_count) OR
     (NEW.boosts_count IS DISTINCT FROM OLD.boosts_count) THEN
    
    -- In Supabase:
    -- - Direct client updates use 'authenticator' role and have auth.uid() set
    -- - SECURITY DEFINER functions run with the function owner's role (usually 'postgres' or 'service_role')
    -- - Service role calls have auth.uid() = NULL
    
    -- Allow if:
    -- 1. auth.uid() is NULL (service role / admin context)
    -- 2. OR current_user is NOT 'authenticator' (means we're in a SECURITY DEFINER function)
    
    IF auth.uid() IS NULL THEN
      -- Service role or admin - allow
      RETURN NEW;
    END IF;
    
    -- Check if we're in a SECURITY DEFINER function
    -- In Supabase, SECURITY DEFINER functions run with the function owner's role
    -- Normal client calls use 'authenticator' role
    IF current_user != 'authenticator' THEN
      -- We're in a function context (SECURITY DEFINER) - allow
      RETURN NEW;
    END IF;
    
    -- If we get here:
    -- - auth.uid() IS NOT NULL (user is authenticated)
    -- - current_user = 'authenticator' (direct client call)
    -- - Protected columns are being changed
    -- This is a direct client update - BLOCK IT
    RAISE EXCEPTION 'You are not allowed to update points/premium/counts directly. Use RPC functions.';
  END IF;

  -- No protected columns changed - allow
  RETURN NEW;
END;
$$;

-- Step 4: Recreate the trigger
CREATE TRIGGER tr_protect_profile
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_critical_columns();

-- Verification: Test that the trigger works
-- The trigger should:
-- 1. Block direct client updates to protected columns
-- 2. Allow SECURITY DEFINER RPC functions to update protected columns
