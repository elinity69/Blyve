-- Supabase RPC Functions für Sports Buddy App
-- Führe diese in Supabase SQL Editor aus

-- 1. Funktion: Get Nearby Users (für Expo-Version)
CREATE OR REPLACE FUNCTION get_nearby_users(
  user_lat DOUBLE PRECISION,
  user_lon DOUBLE PRECISION,
  radius_km DOUBLE PRECISION DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  name TEXT,
  age INTEGER,
  bio TEXT,
  images TEXT[],
  location GEOGRAPHY,
  is_premium BOOLEAN,
  is_boosted BOOLEAN,
  swipes_today INTEGER,
  sports TEXT[],
  distance DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.email,
    p.name,
    p.age,
    p.bio,
    p.images,
    p.location,
    p.is_premium,
    p.is_boosted,
    p.swipes_today,
    p.sports,
    ST_Distance(
      p.location::geography,
      ST_SetSRID(ST_MakePoint(user_lon, user_lat), 4326)::geography
    ) / 1000.0 AS distance
  FROM public.profiles p
  WHERE 
    p.location IS NOT NULL
    AND ST_Distance(
      p.location::geography,
      ST_SetSRID(ST_MakePoint(user_lon, user_lat), 4326)::geography
    ) / 1000.0 <= radius_km
    AND p.id != (
      SELECT id FROM auth.users WHERE id = auth.uid()
    )
  ORDER BY 
    p.is_boosted DESC,
    distance ASC
  LIMIT 50;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Funktion: Increment Swipe Count (verwendet jetzt auth.uid() wie im Hauptscript)
CREATE OR REPLACE FUNCTION increment_swipe_count() 
RETURNS INTEGER AS $$
DECLARE
  current_count INTEGER;
  user_id UUID;
BEGIN
  user_id := auth.uid();
  
  -- Tägliches Reset Check
  UPDATE public.profiles
  SET swipes_today = 0, last_swipe_reset = NOW()
  WHERE id = user_id 
    AND (last_swipe_reset IS NULL OR last_swipe_reset < CURRENT_DATE);
  
  -- Swipe +1
  UPDATE public.profiles
  SET swipes_today = swipes_today + 1
  WHERE id = user_id
  RETURNING swipes_today INTO current_count;
  
  RETURN COALESCE(current_count, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Funktion: Reset Swipes Temp (für Ads)
CREATE OR REPLACE FUNCTION reset_swipes_temp(user_id UUID, extra_swipes INTEGER)
RETURNS void AS $$
BEGIN
  UPDATE public.profiles 
  SET swipes_today = GREATEST(0, swipes_today - extra_swipes),
      last_swipe_reset = NOW()
  WHERE id = user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Funktion: Get Discovery Users (für Vite-Version / Backend API)
-- Diese wird normalerweise über das Backend aufgerufen, aber hier als Fallback
CREATE OR REPLACE FUNCTION get_discovery_users(current_user_id UUID)
RETURNS TABLE (
  id UUID,
  email TEXT,
  name TEXT,
  age INTEGER,
  bio TEXT,
  images TEXT[],
  location GEOGRAPHY,
  is_premium BOOLEAN,
  is_boosted BOOLEAN,
  sports TEXT[],
  distance DOUBLE PRECISION
) AS $$
DECLARE
  user_location GEOGRAPHY;
BEGIN
  -- Get current user location
  SELECT location INTO user_location
  FROM public.profiles
  WHERE id = current_user_id;
  
  -- If no location, use default (Frankfurt)
  IF user_location IS NULL THEN
    user_location := ST_SetSRID(ST_MakePoint(8.6821, 50.1109), 4326)::geography;
  END IF;
  
  RETURN QUERY
  SELECT 
    p.id,
    p.email,
    p.name,
    p.age,
    p.bio,
    p.images,
    p.location,
    p.is_premium,
    p.is_boosted,
    p.sports,
    ST_Distance(
      p.location::geography,
      user_location
    ) / 1000.0 AS distance
  FROM public.profiles p
  WHERE 
    p.id != current_user_id
    AND p.location IS NOT NULL
  ORDER BY 
    p.is_boosted DESC,
    distance ASC
  LIMIT 50;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

