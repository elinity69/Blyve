-- Remove legacy profile columns on existing databases (no-ops if already absent).

alter table public.profiles
  drop column if exists buddy_points,
  drop column if exists rewarded_image_count,
  drop column if exists premium_expires_at,
  drop column if exists is_premium,
  drop column if exists referral_code,
  drop column if exists referred_by,
  drop column if exists last_daily_login,
  drop column if exists daily_chat_count,
  drop column if exists last_chat_reset_date;
