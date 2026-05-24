-- Create test profiles for the app
-- Run this in Supabase SQL Editor

-- First, create a demo user account (if not exists)
-- Email: demo@test.com, Password: demo123456

-- Insert 11 test profiles
INSERT INTO profiles (id, email, name, age, bio, images, location, is_premium, is_boosted, swipes_today)
VALUES
  -- Demo account (swipes_today = 49 for testing)
  (
    '00000000-0000-0000-0000-000000000001',
    'demo@test.com',
    'Demo User',
    28,
    'Love tennis and running! Looking for a workout buddy.',
    ARRAY['https://i.pravatar.cc/400?img=1'],
    ST_SetSRID(ST_MakePoint(8.6821, 50.1109), 4326), -- Frankfurt coordinates
    false,
    false,
    49
  ),
  
  -- Test profiles
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
    0
  ),
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
    0
  ),
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
    0
  ),
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
    0
  ),
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
    0
  ),
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
    0
  ),
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
    0
  ),
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
    0
  ),
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
    0
  ),
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
    0
  )
ON CONFLICT (id) DO NOTHING;

