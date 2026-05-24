# Blyve

Communication-focused app: **auth**, **profiles**, **friends**, **1:1 chat**, and **groups/channels** (Supabase + Expo / Vite). Blocking/reporting is supported; calls/screen share may follow later.

## Requirements

- Node.js 20+
- Supabase project (see `supabase/migrations`)

## Install & run

```bash
npm install --legacy-peer-deps
```

**Web (Vite):**

```bash
npm run dev
```

**Expo:**

```bash
npx expo start
```

## Environment

Copy `.env.example` to `.env` and set your Supabase URL and anon key (`VITE_*` for web, `EXPO_PUBLIC_*` for Expo). Never commit real secrets.

## Database

Apply migrations with the Supabase CLI, or run them in order in the SQL editor. Legacy dating/commerce RPCs are dropped in `supabase/migrations/20260422180000_drop_legacy_dating_gamification_rpcs.sql`.
