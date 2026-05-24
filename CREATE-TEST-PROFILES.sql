-- Create test profiles for the app
-- Run this in Supabase SQL Editor

-- First, update demo account swipes to 49
UPDATE profiles 
SET swipes_today = 49 
WHERE email = 'demo@test.com';

-- Insert test profiles (if they don't exist)
INSERT INTO profiles (id, email, name, age, bio, images, location, is_premium, is_boosted, swipes_today, sports)
VALUES
  -- Test profile 1
  (
    gen_random_uuid(),
    'test1@example.com',
    'Sarah',
    25,
    'Fitness enthusiast. Love gym workouts and yoga.',
    ARRAY['https://i.pravatar.cc/400?img=2'],
    ST_SetSRID(ST_MakePoint(8.6821 + (random() - 0.5) * 0.1, 50.1109 + (random() - 0.5) * 0.1), 4326),
    false,
    true, -- Boosted
    0,
    ARRAY['Fitness', 'Yoga']
  ),
  -- Test profile 2
  (
    gen_random_uuid(),
    'test2@example.com',
    'Mike',
    30,
    'Basketball player. Looking for someone to play with.',
    ARRAY['https://i.pravatar.cc/400?img=3'],
    ST_SetSRID(ST_MakePoint(8.6821 + (random() - 0.5) * 0.1, 50.1109 + (random() - 0.5) * 0.1), 4326),
    true, -- Premium
    false,
    0,
    ARRAY['Basketball']
  ),
  -- Test profile 3
  (
    gen_random_uuid(),
    'test3@example.com',
    'Emma',
    27,
    'Cycling and hiking are my passions!',
    ARRAY['https://i.pravatar.cc/400?img=4'],
    ST_SetSRID(ST_MakePoint(8.6821 + (random() - 0.5) * 0.1, 50.1109 + (random() - 0.5) * 0.1), 4326),
    false,
    false,
    0,
    ARRAY['Cycling', 'Hiking']
  ),
  -- Test profile 4
  (
    gen_random_uuid(),
    'test4@example.com',
    'David',
    32,
    'Tennis coach. Always up for a match!',
    ARRAY['https://i.pravatar.cc/400?img=5'],
    ST_SetSRID(ST_MakePoint(8.6821 + (random() - 0.5) * 0.1, 50.1109 + (random() - 0.5) * 0.1), 4326),
    false,
    true, -- Boosted
    0,
    ARRAY['Tennis']
  ),
  -- Test profile 5
  (
    gen_random_uuid(),
    'test5@example.com',
    'Lisa',
    24,
    'Swimming and running. Let''s train together!',
    ARRAY['https://i.pravatar.cc/400?img=6'],
    ST_SetSRID(ST_MakePoint(8.6821 + (random() - 0.5) * 0.1, 50.1109 + (random() - 0.5) * 0.1), 4326),
    true, -- Premium
    true, -- Boosted
    0,
    ARRAY['Swimming', 'Running']
  ),
  -- Test profile 6
  (
    gen_random_uuid(),
    'test6@example.com',
    'Tom',
    29,
    'Football fanatic. Weekend games are a must!',
    ARRAY['https://i.pravatar.cc/400?img=7'],
    ST_SetSRID(ST_MakePoint(8.6821 + (random() - 0.5) * 0.1, 50.1109 + (random() - 0.5) * 0.1), 4326),
    false,
    false,
    0,
    ARRAY['Football']
  ),
  -- Test profile 7
  (
    gen_random_uuid(),
    'test7@example.com',
    'Anna',
    26,
    'Yoga and meditation. Looking for a mindful partner.',
    ARRAY['https://i.pravatar.cc/400?img=8'],
    ST_SetSRID(ST_MakePoint(8.6821 + (random() - 0.5) * 0.1, 50.1109 + (random() - 0.5) * 0.1), 4326),
    false,
    false,
    0,
    ARRAY['Yoga', 'Meditation']
  ),
  -- Test profile 8
  (
    gen_random_uuid(),
    'test8@example.com',
    'Chris',
    31,
    'Rock climbing and bouldering enthusiast.',
    ARRAY['https://i.pravatar.cc/400?img=9'],
    ST_SetSRID(ST_MakePoint(8.6821 + (random() - 0.5) * 0.1, 50.1109 + (random() - 0.5) * 0.1), 4326),
    true, -- Premium
    false,
    0,
    ARRAY['Rock Climbing', 'Bouldering']
  ),
  -- Test profile 9
  (
    gen_random_uuid(),
    'test9@example.com',
    'Maria',
    23,
    'Dance fitness and Zumba instructor.',
    ARRAY['https://i.pravatar.cc/400?img=10'],
    ST_SetSRID(ST_MakePoint(8.6821 + (random() - 0.5) * 0.1, 50.1109 + (random() - 0.5) * 0.1), 4326),
    false,
    true, -- Boosted
    0,
    ARRAY['Dance', 'Zumba']
  ),
  -- Test profile 10
  (
    gen_random_uuid(),
    'test10@example.com',
    'John',
    35,
    'Marathon runner. Training for my next race!',
    ARRAY['https://i.pravatar.cc/400?img=11'],
    ST_SetSRID(ST_MakePoint(8.6821 + (random() - 0.5) * 0.1, 50.1109 + (random() - 0.5) * 0.1), 4326),
    false,
    false,
    0,
    ARRAY['Running', 'Marathon']
  )
ON CONFLICT (id) DO NOTHING;

