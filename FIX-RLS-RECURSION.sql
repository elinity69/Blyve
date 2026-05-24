-- Fix: Infinite Recursion in RLS Policy for profiles table
-- Problem: RLS Policy tries to access profiles table while checking permissions
-- Solution: Create non-recursive policies that only check auth.uid()

-- Step 1: Drop all existing UPDATE policies on profiles
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Enable update for users based on id" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own data" ON public.profiles;

-- Step 2: Create a simple, non-recursive UPDATE policy
-- This policy only checks if the user is authenticated and updating their own row
-- It does NOT query the profiles table, avoiding recursion
CREATE POLICY "Users can update own profile"
ON public.profiles
FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Step 3: Ensure SELECT policy is also non-recursive
-- Drop existing SELECT policies that might be recursive
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Safe Profile Visibility" ON public.profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
DROP POLICY IF EXISTS "Enable read access for all users" ON public.profiles;

-- Create simple SELECT policies (non-recursive)
-- Policy 1: Users can always see their own profile
CREATE POLICY "Users can view own profile"
ON public.profiles
FOR SELECT
USING (auth.uid() = id);

-- Policy 2: Users can see other profiles (for discovery)
-- This is simple and doesn't check ghost_mode or matches to avoid recursion
CREATE POLICY "Users can view other profiles"
ON public.profiles
FOR SELECT
USING (auth.uid() IS NOT NULL AND auth.uid() != id);

-- Step 4: Ensure INSERT policy exists (for new user registration)
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.profiles;

CREATE POLICY "Users can insert own profile"
ON public.profiles
FOR INSERT
WITH CHECK (auth.uid() = id);

-- Step 5: Ensure DELETE policy (if needed)
DROP POLICY IF EXISTS "Users can delete own profile" ON public.profiles;

CREATE POLICY "Users can delete own profile"
ON public.profiles
FOR DELETE
USING (auth.uid() = id);

-- Verification: Check that policies are created
-- Run this query to verify:
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
-- FROM pg_policies 
-- WHERE tablename = 'profiles';
