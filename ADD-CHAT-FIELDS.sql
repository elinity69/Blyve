-- Add missing columns to profiles table for Chat System
-- Run this in Supabase SQL Editor

-- Add ghost_mode column (Premium feature to hide online status)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS ghost_mode BOOLEAN DEFAULT false;

-- Add daily_chat_count column (for tracking daily conversation limit)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS daily_chat_count INTEGER DEFAULT 0;

-- Add last_chat_reset_date column (for resetting daily counter)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS last_chat_reset_date DATE;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_profiles_ghost_mode ON public.profiles(ghost_mode);
CREATE INDEX IF NOT EXISTS idx_profiles_daily_chat_count ON public.profiles(daily_chat_count);

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.ghost_mode IS 'Premium feature: Hide online status from other users';
COMMENT ON COLUMN public.profiles.daily_chat_count IS 'Number of new conversations started today (Free users: max 5)';
COMMENT ON COLUMN public.profiles.last_chat_reset_date IS 'Last date when daily_chat_count was reset';

