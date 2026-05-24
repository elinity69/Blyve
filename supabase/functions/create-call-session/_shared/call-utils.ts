/**
 * Shared helpers for Jitsi call edge functions.
 */

declare const Deno: {
  env: { get(key: string): string | undefined };
};

// @ts-ignore Deno jsr import
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CALL_RINGING_TIMEOUT_MS = 30_000;

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export function getSupabase(req: Request): SupabaseClient {
  const authHeader = req.headers.get("Authorization") ?? "";
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );
}

/** Service role — bypasses RLS for server-side call lifecycle cleanup. */
export function getAdminSupabase(): SupabaseClient | null {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!serviceKey) return null;
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);
}

export function getWriteSupabase(userClient: SupabaseClient): SupabaseClient {
  return getAdminSupabase() ?? userClient;
}

export async function requireUser(req: Request) {
  const supabase = getSupabase(req);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return { error: json({ error: "Unauthorized", code: 401 }, 401) };
  }
  return { supabase, user };
}

export function getJitsiDomain(): string {
  const domain = tryGetJitsiDomain();
  if (!domain) {
    throw new Error("JITSI_DOMAIN is not configured");
  }
  return domain;
}

export function tryGetJitsiDomain(): string | null {
  const domain = Deno.env.get("JITSI_DOMAIN")?.trim();
  return domain || null;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function expireStaleRingingCallIfNeeded(
  supabase: SupabaseClient,
  callSessionId: string,
): Promise<{ expired: boolean; status?: string }> {
  const db = getWriteSupabase(supabase);
  const { data: session, error: sErr } = await supabase
    .from("call_sessions")
    .select("id, status, created_at, updated_at")
    .eq("id", callSessionId)
    .maybeSingle();
  if (sErr || !session) return { expired: false };

  const status = String(session.status || "").toLowerCase();
  if (!["ringing", "joining"].includes(status)) {
    return { expired: false, status };
  }

  const basisIso = session.updated_at || session.created_at;
  if (!basisIso) return { expired: false, status };

  const basisTs = new Date(basisIso).getTime();
  if (!Number.isFinite(basisTs)) return { expired: false, status };
  if (Date.now() - basisTs <= CALL_RINGING_TIMEOUT_MS) {
    return { expired: false, status };
  }

  if (status === "joining") {
    const { data: joinedRows, error: joinedErr } = await supabase
      .from("call_participants")
      .select("id")
      .eq("call_session_id", callSessionId)
      .not("joined_at", "is", null)
      .limit(1);
    if (joinedErr) return { expired: false, status };
    if ((joinedRows ?? []).length > 0) {
      return { expired: false, status };
    }
  }

  const endedAt = new Date().toISOString();
  await db
    .from("call_sessions")
    .update({ status: "missed", ended_at: endedAt, updated_at: endedAt })
    .eq("id", callSessionId);

  const { data: parts } = await db
    .from("call_participants")
    .select("id, invite_status, left_at")
    .eq("call_session_id", callSessionId)
    .is("left_at", null);

  for (const p of parts ?? []) {
    const invite = String(p.invite_status || "").toLowerCase();
    let nextInvite: string;
    if (invite === "accepted" || invite === "joining") {
      nextInvite = "left";
    } else if (invite === "pending") {
      nextInvite = "missed";
    } else if (invite === "declined" || invite === "removed") {
      nextInvite = invite;
    } else {
      nextInvite = "missed";
    }
    await db
      .from("call_participants")
      .update({ invite_status: nextInvite, left_at: endedAt, updated_at: endedAt })
      .eq("id", p.id);
  }

  await db.from("call_events").insert({
    call_session_id: callSessionId,
    user_id: null,
    event_type: "missed",
    payload: { reason: "timeout", prior_status: status },
  });

  return { expired: true, status: "missed" };
}

/** End active session when nobody is still in the call (all left or never joined). */
export async function closeOrphanedActiveCallIfNeeded(
  supabase: SupabaseClient,
  callSessionId: string,
): Promise<boolean> {
  const db = getWriteSupabase(supabase);
  const { data: session, error: sErr } = await supabase
    .from("call_sessions")
    .select("id, status")
    .eq("id", callSessionId)
    .maybeSingle();
  if (sErr || !session) return false;

  const status = String(session.status || "").toLowerCase();
  if (status !== "active") return false;

  const { data: parts, error: pErr } = await supabase
    .from("call_participants")
    .select("joined_at, left_at")
    .eq("call_session_id", callSessionId);
  if (pErr) return false;

  const anyoneInCall = (parts ?? []).some((p) => p.joined_at && !p.left_at);
  if (anyoneInCall) return false;

  const endedAt = new Date().toISOString();
  await db
    .from("call_sessions")
    .update({ status: "ended", ended_at: endedAt, updated_at: endedAt })
    .eq("id", callSessionId);

  const { data: partsFull } = await db
    .from("call_participants")
    .select("id, left_at")
    .eq("call_session_id", callSessionId);

  for (const p of partsFull ?? []) {
    if (p.left_at) continue;
    await db
      .from("call_participants")
      .update({ invite_status: "left", left_at: endedAt, updated_at: endedAt })
      .eq("id", p.id);
  }

  await db.from("call_events").insert({
    call_session_id: callSessionId,
    user_id: null,
    event_type: "ended",
    payload: { reason: "orphaned_active_cleanup" },
  });

  return true;
}

/** Cancel a prior outgoing attempt from the same host (retry after failure). */
export async function cancelSupersededOutgoingCall(
  supabase: SupabaseClient,
  callSessionId: string,
): Promise<void> {
  const db = getWriteSupabase(supabase);
  const endedAt = new Date().toISOString();
  await db
    .from("call_sessions")
    .update({ status: "cancelled", ended_at: endedAt, updated_at: endedAt })
    .eq("id", callSessionId);

  const { data: parts } = await db
    .from("call_participants")
    .select("id, role, invite_status, left_at")
    .eq("call_session_id", callSessionId);

  for (const p of parts ?? []) {
    if (p.left_at) continue;
    const role = String(p.role || "").toLowerCase();
    const invite = String(p.invite_status || "").toLowerCase();
    const nextInvite =
      role === "host"
        ? "left"
        : invite === "pending"
        ? "missed"
        : invite === "accepted" || invite === "joining"
        ? "left"
        : invite;
    await db
      .from("call_participants")
      .update({ invite_status: nextInvite, left_at: endedAt, updated_at: endedAt })
      .eq("id", p.id);
  }

  await db.from("call_events").insert({
    call_session_id: callSessionId,
    user_id: null,
    event_type: "cancelled",
    payload: { reason: "superseded_by_new_call" },
  });
}

/** Participants currently in the media call (joined, not left). */
export async function countInCallParticipants(
  supabase: SupabaseClient,
  callSessionId: string,
): Promise<number> {
  const { data: parts, error } = await supabase
    .from("call_participants")
    .select("id")
    .eq("call_session_id", callSessionId)
    .not("joined_at", "is", null)
    .is("left_at", null);
  if (error) return 0;
  return (parts ?? []).length;
}

/** Force-end a blocking session (admin / service role). */
export async function forceTerminateCallSession(
  supabase: SupabaseClient,
  callSessionId: string,
  terminalStatus: "cancelled" | "ended" | "missed",
  reason: string,
): Promise<void> {
  const db = getWriteSupabase(supabase);
  const endedAt = new Date().toISOString();
  await db
    .from("call_sessions")
    .update({ status: terminalStatus, ended_at: endedAt, updated_at: endedAt })
    .eq("id", callSessionId);

  const { data: parts } = await db
    .from("call_participants")
    .select("id, role, invite_status, left_at")
    .eq("call_session_id", callSessionId);

  for (const p of parts ?? []) {
    if (p.left_at) continue;
    const role = String(p.role || "").toLowerCase();
    const invite = String(p.invite_status || "").toLowerCase();
    let nextInvite: string;
    if (role === "host" || invite === "accepted" || invite === "joining") {
      nextInvite = "left";
    } else if (invite === "pending") {
      nextInvite = terminalStatus === "cancelled" ? "missed" : terminalStatus === "missed" ? "missed" : "left";
    } else {
      nextInvite = invite || "left";
    }
    await db
      .from("call_participants")
      .update({ invite_status: nextInvite, left_at: endedAt, updated_at: endedAt })
      .eq("id", p.id);
  }

  await db.from("call_events").insert({
    call_session_id: callSessionId,
    user_id: null,
    event_type: terminalStatus === "cancelled" ? "cancelled" : terminalStatus === "missed" ? "missed" : "ended",
    payload: { reason },
  });
}

/**
 * Clear stale or abandoned sessions blocking a new direct call.
 */
export async function clearBlockingCallsForConversation(
  supabase: SupabaseClient,
  conversationId: string,
  requestingUserId: string,
): Promise<void> {
  const db = getWriteSupabase(supabase);
  const { data: blocking, error } = await db
    .from("call_sessions")
    .select("id, status, creator_id, updated_at, created_at")
    .eq("conversation_id", conversationId)
    .in("status", ["ringing", "joining", "active"]);

  if (error || !blocking?.length) return;

  for (const row of blocking) {
    const sessionId = String(row.id);
    const status = String(row.status || "").toLowerCase();
    const creatorId = String(row.creator_id || "");
    const inCallCount = await countInCallParticipants(db, sessionId);

    // DM calls need 2 people — otherwise it's a stale/orphan session
    if (inCallCount < 2) {
      const terminal =
        status === "active" ? "ended" : status === "ringing" || status === "joining" ? "cancelled" : "ended";
      await forceTerminateCallSession(db, sessionId, terminal, "blocking_cleanup_not_live");
      continue;
    }

    if (
      creatorId === requestingUserId &&
      (status === "ringing" || status === "joining" || status === "active")
    ) {
      await cancelSupersededOutgoingCall(supabase, sessionId);
      continue;
    }

    const basisIso = String(row.updated_at || row.created_at || "");
    const ageMs = basisIso ? Date.now() - new Date(basisIso).getTime() : Infinity;
    if (Number.isFinite(ageMs) && ageMs > CALL_RINGING_TIMEOUT_MS) {
      await forceTerminateCallSession(db, sessionId, "ended", "blocking_cleanup_stale");
      continue;
    }

    if (status === "ringing" || status === "joining") {
      await expireStaleRingingCallIfNeeded(supabase, sessionId);
    } else if (status === "active") {
      await closeOrphanedActiveCallIfNeeded(supabase, sessionId);
    }
  }
}

export async function closeUnansweredCall(
  supabase: SupabaseClient,
  callSessionId: string,
  terminalStatus: "declined" | "missed",
): Promise<void> {
  const db = getWriteSupabase(supabase);
  const endedAt = new Date().toISOString();
  await db
    .from("call_sessions")
    .update({
      status: terminalStatus,
      ended_at: endedAt,
      updated_at: endedAt,
    })
    .eq("id", callSessionId);

  const { data: parts } = await db
    .from("call_participants")
    .select("id, role, invite_status, left_at")
    .eq("call_session_id", callSessionId);

  for (const p of parts ?? []) {
    if (p.left_at) continue;
    const role = String(p.role || "").toLowerCase();
    const invite = String(p.invite_status || "").toLowerCase();
    let nextInvite: string;
    if (role === "host") {
      nextInvite = "left";
    } else if (invite === "accepted" || invite === "joining") {
      nextInvite = "left";
    } else if (invite === "pending" || invite === "declined" || invite === "removed") {
      nextInvite = terminalStatus;
    } else if (invite === "missed") {
      nextInvite = "missed";
    } else {
      nextInvite = terminalStatus;
    }
    await db
      .from("call_participants")
      .update({ invite_status: nextInvite, left_at: endedAt, updated_at: endedAt })
      .eq("id", p.id);
  }

  await db.from("call_events").insert({
    call_session_id: callSessionId,
    user_id: null,
    event_type: terminalStatus === "declined" ? "declined" : "missed",
    payload: { reason: "unanswered" },
  });
}

export function handleOptions(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return null;
}

export function parseSessionId(body: Record<string, unknown>): string | null {
  const raw = body.sessionId ?? body.callSessionId ?? body.session_id;
  if (raw == null) return null;
  const id = String(raw);
  return isUuid(id) ? id : null;
}
