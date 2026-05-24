declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

// @ts-ignore Deno jsr import
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  handleJoinCall,
} from "./_shared/jitsi-call-handlers.ts";
import { parseSessionId } from "./_shared/call-utils.ts";

type SmartActionBody = {
  action?: unknown;
  identity?: unknown;
  room?: unknown;
  name?: unknown;
  sessionId?: unknown;
  callSessionId?: unknown;
  inviteToken?: unknown;
};

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function getSupabase(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );
}

type RequireUserResult =
  | { ok: false; response: Response }
  | { ok: true; supabase: ReturnType<typeof createClient>; user: { id: string } };

async function requireUser(req: Request): Promise<RequireUserResult> {
  const supabase = getSupabase(req);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return { ok: false, response: json({ error: "Unauthorized", code: 401 }, 401) };
  }
  return { ok: true, supabase, user };
}

function base64UrlEncodeJson(obj: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlEncodeBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function createLiveKitAccessToken(input: {
  apiKey: string;
  apiSecret: string;
  identity: string;
  room: string;
  name?: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 60 * 60;
  const nbf = now - 5;
  const header = { alg: "HS256", typ: "JWT" };
  const payload: Record<string, unknown> = {
    iss: input.apiKey,
    sub: input.identity,
    iat: now,
    nbf,
    exp,
    video: {
      roomJoin: true,
      room: input.room,
      canPublish: true,
      canSubscribe: true,
    },
  };
  if (input.name?.trim()) payload.name = input.name.trim();

  const encHeader = base64UrlEncodeJson(header);
  const encPayload = base64UrlEncodeJson(payload);
  const toSign = `${encHeader}.${encPayload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(toSign));
  return `${toSign}.${base64UrlEncodeBytes(sig)}`;
}

async function handleLiveKitToken(body: SmartActionBody): Promise<Response> {
  const identity = String(body.identity || "").trim();
  const room = String(body.room || "").trim();
  const name = body.name == null ? undefined : String(body.name).trim();

  if (!identity || !room) {
    return json({ error: "identity and room are required", code: 400 }, 400);
  }

  const apiKey = Deno.env.get("LIVEKIT_API_KEY") ?? "devkey";
  const apiSecret = Deno.env.get("LIVEKIT_API_SECRET") ?? "secret";
  const url = Deno.env.get("LIVEKIT_URL") ?? "wss://77.181.7.65:7880";

  const token = await createLiveKitAccessToken({
    apiKey,
    apiSecret,
    identity,
    room,
    name,
  });

  return json({ token, url, mediaProvider: "livekit" });
}

async function handleJitsiJoin(req: Request, body: SmartActionBody): Promise<Response> {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  const sessionId = parseSessionId(body as Record<string, unknown>);
  if (!sessionId) {
    return json({ error: "Invalid sessionId", code: 400 }, 400);
  }

  const inviteToken = body.inviteToken ? String(body.inviteToken) : undefined;
  const result = await handleJoinCall(
    auth.supabase,
    auth.user,
    sessionId,
    inviteToken,
    body as Record<string, unknown>,
  );
  return json(result.body, result.status);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed", code: 405 }, 405);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as SmartActionBody;
    const action = String(body.action || "livekit").toLowerCase();

    if (action === "jitsi-join" || action === "jitsi_join" || action === "jitsi") {
      return await handleJitsiJoin(req, body);
    }

    // Default + explicit livekit: unchanged LiveKit token path
    return await handleLiveKitToken(body);
  } catch (e) {
    console.error("smart-action", e);
    return json({ error: "smart-action failed", code: 500 }, 500);
  }
});
