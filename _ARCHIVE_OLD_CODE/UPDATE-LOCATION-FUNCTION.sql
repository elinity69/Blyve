-- RPC Function: Update Profile Location (für Location-System)
-- Führe diese in Supabase SQL Editor aus

CREATE OR REPLACE FUNCTION update_profile_location(
  p_location_name TEXT,
  p_lon DOUBLE PRECISION,
  p_lat DOUBLE PRECISION
)
RETURNS void AS $$
BEGIN
  UPDATE public.profiles
  SET 
    location_name = p_location_name,
    location = ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography
  WHERE id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
