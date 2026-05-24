-- Blyve: drop legacy dating / gamification RPCs (communication-only app).
-- Safe on fresh DB: DROP IF EXISTS.

DROP FUNCTION IF EXISTS public.get_discovery_users_v2(
  uuid,
  double precision,
  text[],
  boolean,
  integer,
  integer,
  integer,
  integer
);

DROP FUNCTION IF EXISTS public.get_incoming_likes(uuid);

DROP FUNCTION IF EXISTS public.earn_buddy_points(text);

DROP FUNCTION IF EXISTS public.increment_swipe_count();

DROP FUNCTION IF EXISTS public.reset_swipes_temp(uuid, integer);

DROP FUNCTION IF EXISTS public.handle_swipe(uuid, boolean);

DROP FUNCTION IF EXISTS public.is_premium_active();

DROP FUNCTION IF EXISTS public.ping_heartbeat();

DROP FUNCTION IF EXISTS public.get_superlikes_used_today();

-- Promo / referral / commerce helpers (may not exist on all DBs)
DROP FUNCTION IF EXISTS public.redeem_promo_code(text);
DROP FUNCTION IF EXISTS public.apply_referral_reward(uuid, text);
DROP FUNCTION IF EXISTS public.add_buddy_points_to_user(uuid, integer);
DROP FUNCTION IF EXISTS public.add_buddy_points_to_user(uuid, bigint);
