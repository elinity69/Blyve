ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS member_since TIMESTAMPTZ;

UPDATE profiles p
SET member_since = u.created_at
FROM auth.users u
WHERE p.id = u.id
  AND p.member_since IS NULL;

ALTER TABLE profiles
  ALTER COLUMN member_since SET DEFAULT NOW();
