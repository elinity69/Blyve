# Blyve LiveKit self-host on Windows PC + WSL

This document describes the current Step 3 setup for Blyve calls with a self-hosted LiveKit server on a home PC.

## Setup overview

- Windows PC LAN IP: `192.168.1.193` (internal network target only)
- Current public IP: `77.181.7.65` (internet-facing test endpoint)
- Windows runs WSL Ubuntu
- LiveKit runs inside WSL on that same PC
- Router forwards internet traffic from `77.181.7.65` to `192.168.1.193`:
  - TCP `7880-7881`
  - UDP `50000-60000`

Important:
- Friends on the internet do **not** connect to `192.168.1.193`.
- Friends connect to public `77.181.7.65`.

## LiveKit config used for this setup

File: `infra/livekit/local-config.yaml`

- Uses signaling port `7880`
- Uses RTC TCP `7881`
- Uses UDP media range `50000-60000`
- Uses `rtc.use_external_ip: true` so LiveKit advertises its public-facing address
- Keeps `turn.enabled: false` for minimal early testing
- Uses test key pair for local setup:
  - API key: `devkey`
  - API secret: `devsecret_77_181_7_65_blyve_local_2026_key` (>= 32 chars, required by LiveKit)

## Startup (manual, current test mode)

Run LiveKit from a WSL terminal:

```bash
wsl
cd /mnt/c/Users/naksch/Desktop/Blyve/Blyve
livekit-server --config infra/livekit/local-config.yaml
```

Notes:
- If this WSL terminal closes, the LiveKit process stops.
- For now this is expected in test mode.
- Later, run LiveKit as a service/background process for resilience.

## Edge Function env vars (test mode)

Use these values for the existing Supabase Edge Function:

```env
LIVEKIT_URL=wss://77.181.7.65:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret_77_181_7_65_blyve_local_2026_key
```

Set these in Supabase for the `blyve` Edge Function:

```bash
supabase secrets set LIVEKIT_URL=wss://77.181.7.65:7880
supabase secrets set LIVEKIT_API_KEY=devkey
supabase secrets set LIVEKIT_API_SECRET=devsecret_77_181_7_65_blyve_local_2026_key
```

After changing secrets, redeploy the function:

```bash
supabase functions deploy blyve
```

Rules:
- Do **not** use `192.168.1.193` in `LIVEKIT_URL` for internet friends.
- Keep token generation backend-only in the Edge Function.
- Use `wss://` for secure signaling and HTTPS-compatible clients.
- Unsecured WebSocket URLs can be blocked by browsers when the Blyve frontend runs over HTTPS.
- Next production-safe step remains domain + TLS + `wss://`.

## Runtime flow

1. User taps call in Blyve frontend.
2. Frontend calls the Blyve Supabase Edge Function.
3. Edge Function validates auth and call access.
4. Edge Function returns:
   - `server_url`
   - `participant_token`
5. Frontend connects directly to LiveKit room using that response.
6. Friends do the same from their own devices.
7. Media flows through self-hosted LiveKit on the PC.

## System responsibility split

- Supabase (database): stores `call_sessions`, `call_participants`, `call_events`.
- Supabase Edge Function (backend): issues LiveKit tokens and returns connection data.
- LiveKit (WSL on Windows PC): handles real-time signaling/media only.
- Frontend clients: request token from Edge Function, then connect directly to LiveKit.
- Router/NAT: forwards public traffic from `77.181.7.65` to local `192.168.1.193`.

This keeps the current Blyve call API architecture unchanged.

## Troubleshooting

- Public vs local IP confusion:
  - `192.168.1.193` is only the internal forwarding target.
  - `77.181.7.65` is the public endpoint internet friends use.
- Router forwarding target should remain `192.168.1.193`.
- Public `LIVEKIT_URL` currently uses `77.181.7.65`.
- If friends cannot join:
  - Verify LiveKit process is running in WSL.
  - Verify `livekit-server` started successfully (no "secret is too short" error).
  - Verify Supabase Function secrets match `infra/livekit/local-config.yaml`.
  - Verify router forwarding is still active.
  - Verify Windows Firewall rules are active.
  - Verify public IP has not changed.
- If ISP changes the public IP, `LIVEKIT_URL` and tests may break until updated.
- If HTTPS frontend cannot connect, verify LiveKit/TLS and keep `LIVEKIT_URL` on `wss://`.

## Implementation checklist (Step 3)

- [x] LiveKit local config created for NAT home-PC setup.
- [x] `rtc.use_external_ip` set to true for public advertisement.
- [x] Router mapping documented: public `77.181.7.65` -> local `192.168.1.193`.
- [x] Startup commands documented (`wsl`, repo `cd`, `livekit-server --config ...`).
- [x] Terminal-close behavior documented (LiveKit stops in current mode).
- [x] Edge Function env vars documented with public IP endpoint.
- [x] Explicit note that `192.168.1.193` must not be used for internet clients.
- [x] Runtime flow documented end-to-end from call tap to media path.
- [x] Responsibilities split documented (Supabase metadata vs LiveKit media).
- [x] Troubleshooting checklist added for common internet-join failures.
- [x] Current Blyve API architecture preserved (backend token generation unchanged).
- [x] Production follow-up documented: domain + TLS + `wss://`.
