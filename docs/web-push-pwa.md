# Web Push (PWA)

Blyve can notify users when the PWA is closed or in the background. This uses **VAPID Web Push** + a **Service Worker** (`public/sw.js`) + the **`send-push`** Edge Function.

## What works where

| Platform | Requirement | Result |
|----------|-------------|--------|
| **Desktop (Chrome, Edge, Firefox)** | HTTPS + notification permission | OS notification (e.g. Windows bottom-right) |
| **Android (Chrome PWA)** | Install or use in browser + permission | System notification |
| **iOS 16.4+** | **Add to Home Screen** (PWA) + permission | iOS banner / lock screen |
| **iOS Safari tab** | — | No push when app is fully closed |

In-app toasts (while Blyve is open) are separate and show **bottom-right on desktop**, top on mobile.

---

## 1. Generate VAPID keys

```bash
npm run push:vapid
```

Copy the **Public Key** and **Private Key**.

## 2. Client env (Vite / Render)

In `.env` or your static host:

```env
VITE_VAPID_PUBLIC_KEY=your_public_key_here
```

Redeploy the web app after setting this.

## 3. Supabase Edge secrets

```bash
supabase secrets set VAPID_PUBLIC_KEY=your_public_key_here
supabase secrets set VAPID_PRIVATE_KEY=your_private_key_here
supabase secrets set VAPID_SUBJECT=mailto:hello@yourdomain.com
supabase secrets set PUSH_WEBHOOK_SECRET=choose_a_long_random_secret
```

Deploy the function:

```bash
supabase functions deploy send-push
```

## 4. Database migration

```bash
supabase db push
```

This creates:

- `public.push_subscriptions` — browser push endpoints (RLS: own rows only)
- DB triggers on `messages` and `group_messages` → `send-push` via `pg_net`

## 5. Configure webhook URL + secret in Postgres

Run once in the **Supabase SQL Editor** (replace values):

```sql
insert into private.push_settings (key, value) values
  ('functions_base_url', 'https://YOUR_PROJECT_REF.supabase.co/functions/v1'),
  ('webhook_secret', 'same_secret_as_PUSH_WEBHOOK_SECRET')
on conflict (key) do update set value = excluded.value;
```

Without this step, messages still save but **no push is sent** (triggers no-op safely).

## 6. Test

1. `npm run build && npm run preview` (or deploy to HTTPS host)
2. Open Blyve, log in, accept notifications when prompted
3. Close the tab or minimize the browser
4. Send a DM from another account/device
5. You should get an OS notification; clicking it opens the chat

### Verify subscription saved

```sql
select user_id, left(endpoint, 60) as endpoint, updated_at
from public.push_subscriptions;
```

### Verify edge function

```bash
curl -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/send-push" \
  -H "Content-Type: application/json" \
  -H "x-blyve-push-secret: YOUR_PUSH_WEBHOOK_SECRET" \
  -d '{"type":"dm","message_id":"00000000-0000-0000-0000-000000000001","conversation_id":"...","sender_id":"...","content":"test"}'
```

## Troubleshooting

- **No prompt / no push in dev:** Web Push only runs in **production builds** (`import.meta.env.PROD`) with `VITE_VAPID_PUBLIC_KEY` set.
- **iOS:** Must use **Add to Home Screen**, not a normal Safari bookmark.
- **Stale service worker:** Hard refresh or clear site data after deploying a new `sw.js` (cache version bumped in file).
- **410 / expired subscription:** Edge function auto-deletes dead endpoints; re-open app and accept notifications again.
