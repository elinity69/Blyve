/**
 * Shared Jitsi call handlers — used by blyve /calls/jitsi/*, standalone edge functions, smart-action.
 * room_name is always server-generated; never accepted from client input.
 */

declare const Deno: {
  env: { get(key: string): string | undefined };
};

// @ts-ignore Deno jsr import
import type { SupabaseClient, User } from "jsr:@supabase/supabase-js@2";
import {
  closeUnansweredCall,
  clearBlockingCallsForConversation,
  expireStaleRingingCallIfNeeded,
  getWriteSupabase,
  isUuid,
  sha256Hex,
} from "./call-utils.ts";
import {
  formatJitsiRoomName,
  jitsiAppIdFromConfig,
  mintJitsiJwt,
  resolveJitsiProviderConfig,
} from "./jitsi-jwt.ts";

export type HandlerResult = {
  status: number;
  body: Record<string, unknown>;
};

type CallType = "audio" | "video" | "screen";
type ContextType = "direct" | "group";

function fail(status: number, error: string, extra: Record<string, unknown> = {}): HandlerResult {
  return { status, body: { error, code: status, ...extra } };
}

function ok(body: Record<string, unknown>, status = 200): HandlerResult {
  return { status, body };
}

/** Reject any client attempt to supply a room name (must be server-generated only). */
function rejectClientRoomName(body: Record<string, unknown>): HandlerResult | null {
  if (body.roomName != null || body.room_name != null) {
    return fail(400, "roomName must not be supplied by the client");
  }
  return null;
}

async function profileDisplayName(
  supabase: SupabaseClient,
  userId: string,
): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, name, username")
    .eq("id", userId)
    .maybeSingle();
  return profile?.display_name || profile?.name || profile?.username || "Participant";
}

type JitsiJoinPayloadResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; error: string };

async function buildJitsiJoinPayload(input: {
  sessionId: string;
  roomName: string;
  callType: string;
  displayName: string;
  status: string;
  userId: string;
  email?: string | null;
  isModerator: boolean;
}): Promise<JitsiJoinPayloadResult> {
  const provider = resolveJitsiProviderConfig();
  if (!provider.ok) {
    return { ok: false, status: provider.status, error: provider.error };
  }

  const { domain, jwtConfig } = provider;
  const roomName = formatJitsiRoomName(input.roomName, jwtConfig);
  const jwt = await mintJitsiJwt(
    {
      domain,
      roomName: input.roomName,
      displayName: input.displayName,
      userId: input.userId,
      email: input.email,
      isModerator: input.isModerator,
    },
    jwtConfig,
  );

  const jitsiAppId = jitsiAppIdFromConfig(jwtConfig);

  return {
    ok: true,
    body: {
      sessionId: input.sessionId,
      callSessionId: input.sessionId,
      roomName,
      jitsiDomain: domain,
      ...(jitsiAppId ? { jitsiAppId } : {}),
      callType: input.callType,
      displayName: input.displayName,
      status: input.status,
      mediaProvider: "jitsi",
      isModerator: input.isModerator,
      jwt,
    },
  };
}

function buildInviteUrl(token: string, sessionId: string): string {
  const base =
    Deno.env.get("APP_URL") ??
    Deno.env.get("FRONTEND_URL") ??
    Deno.env.get("SITE_URL") ??
    "";
  const path = `/call/join?session=${sessionId}&token=${token}`;
  return base ? `${base.replace(/\/$/, "")}${path}` : path;
}

async function resolveParticipants(
  supabase: SupabaseClient,
  userId: string,
  contextType: ContextType,
  conversationId: string | null,
  groupId: string | null,
  participantIds: string[],
): Promise<{ participantIds: string[] } | HandlerResult> {
  if (contextType === "direct") {
    if (!conversationId || !isUuid(conversationId)) {
      return fail(400, "conversationId required for direct calls");
    }
    if (groupId) return fail(400, "groupId must be null for direct calls");

    const { data: conv, error: convErr } = await supabase
      .from("conversations")
      .select("id, user1_id, user2_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (convErr) return fail(500, convErr.message);
    if (!conv) return fail(404, "Conversation not found");

    const u1 = conv.user1_id as string;
    const u2 = conv.user2_id as string;
    if (userId !== u1 && userId !== u2) {
      return fail(403, "Not a participant in this conversation");
    }
    const peer = u1 === userId ? u2 : u1;
    if (participantIds.length === 0) return { participantIds: [peer] };
    if (participantIds.length !== 1 || participantIds[0] !== peer) {
      return fail(400, "participantIds must be exactly the other DM user");
    }
    return { participantIds };
  }

  if (!groupId || !isUuid(groupId)) {
    return fail(400, "groupId required for group calls");
  }
  if (conversationId) return fail(400, "conversationId must be null for group calls");

  const { data: myMembership, error: memErr } = await supabase
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();
  if (memErr) return fail(500, memErr.message);
  if (!myMembership) return fail(403, "Not a member of this group");

  const { data: members, error: gmErr } = await supabase
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId);
  if (gmErr) return fail(500, gmErr.message);

  const allowed = new Set((members ?? []).map((m: { user_id: string }) => m.user_id));
  for (const pid of participantIds) {
    if (!allowed.has(pid)) return fail(400, `User ${pid} is not in this group`);
  }
  if (participantIds.length === 0) {
    return fail(400, "participantIds must include at least one group member");
  }
  return { participantIds };
}

export async function handleCreateCallSession(
  supabase: SupabaseClient,
  user: User,
  body: Record<string, unknown>,
): Promise<HandlerResult> {
  const roomRejected = rejectClientRoomName(body);
  if (roomRejected) return roomRejected;

  const callType = String(body.callType ?? "") as CallType;
  const contextType = String(body.contextType ?? "") as ContextType;
  const conversationId = body.conversationId == null ? null : String(body.conversationId);
  const groupId = body.groupId == null ? null : String(body.groupId);
  const generateInviteLink = Boolean(body.generateInviteLink);
  const inviteExpiresInMinutes = Math.min(
    1440,
    Math.max(5, Number(body.inviteExpiresInMinutes ?? 60) || 60),
  );

  if (!["audio", "video", "screen"].includes(callType)) {
    return fail(400, "Invalid callType");
  }
  if (!["direct", "group"].includes(contextType)) {
    return fail(400, "Invalid contextType");
  }

  const jitsiProvider = resolveJitsiProviderConfig();
  if (!jitsiProvider.ok) {
    return fail(jitsiProvider.status, jitsiProvider.error);
  }

  const rawIds = Array.isArray(body.participantIds) ? body.participantIds : [];
  const participantIdsInput = [...new Set(rawIds.map((x) => String(x)))].filter(
    (id) => isUuid(id) && id !== user.id,
  );

  const resolved = await resolveParticipants(
    supabase,
    user.id,
    contextType,
    conversationId,
    groupId,
    participantIdsInput,
  );
  if ("status" in resolved) return resolved;
  const participantIds = resolved.participantIds;

  if (contextType === "direct" && conversationId) {
    await clearBlockingCallsForConversation(supabase, conversationId, user.id);

    const db = getWriteSupabase(supabase);
    const { data: activeCalls, error: activeErr } = await db
      .from("call_sessions")
      .select("id, status")
      .eq("conversation_id", conversationId)
      .in("status", ["ringing", "joining", "active"]);
    if (activeErr) return fail(500, activeErr.message);
    if ((activeCalls ?? []).length > 0) {
      return fail(409, "An active call already exists for this conversation", {
        existingSessionId: activeCalls![0].id,
      });
    }
  }

  const { data: roomName, error: roomErr } = await supabase.rpc("generate_call_room_name");
  if (roomErr || !roomName || typeof roomName !== "string") {
    console.error("generate_call_room_name", roomErr);
    return fail(500, "Failed to generate room name");
  }

  const sessionId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  const { error: sessionErr } = await supabase.from("call_sessions").insert({
    id: sessionId,
    call_type: callType,
    context_type: contextType,
    conversation_id: contextType === "direct" ? conversationId : null,
    group_id: contextType === "group" ? groupId : null,
    creator_id: user.id,
    room_name: roomName,
    status: "ringing",
  });
  if (sessionErr) return fail(500, sessionErr.message);

  const participantRows = [
    {
      call_session_id: sessionId,
      user_id: user.id,
      role: "host",
      invite_status: "accepted",
      joined_at: null,
    },
    ...participantIds.map((uid) => ({
      call_session_id: sessionId,
      user_id: uid,
      role: "participant",
      invite_status: "pending",
      joined_at: null,
    })),
  ];

  const { error: partErr } = await supabase.from("call_participants").insert(participantRows);
  if (partErr) {
    await supabase.from("call_sessions").delete().eq("id", sessionId);
    return fail(500, partErr.message);
  }

  await supabase.from("call_events").insert([
    {
      call_session_id: sessionId,
      user_id: user.id,
      event_type: "created",
      payload: { call_type: callType, context_type: contextType, media_provider: "jitsi" },
      created_at: nowIso,
    },
    {
      call_session_id: sessionId,
      user_id: user.id,
      event_type: "ringing",
      payload: { invited_user_ids: participantIds },
      created_at: nowIso,
    },
  ]);

  let inviteLink: string | undefined;
  let inviteExpiresAt: string | undefined;

  if (generateInviteLink) {
    const plainToken =
      crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const tokenHash = await sha256Hex(plainToken);
    inviteExpiresAt = new Date(Date.now() + inviteExpiresInMinutes * 60_000).toISOString();

    const { error: tokenErr } = await supabase.from("call_invite_tokens").insert({
      call_session_id: sessionId,
      token_hash: tokenHash,
      created_by: user.id,
      expires_at: inviteExpiresAt,
      max_uses: 1,
      use_count: 0,
    });
    if (tokenErr) {
      await supabase.from("call_sessions").delete().eq("id", sessionId);
      return fail(500, tokenErr.message);
    }
    inviteLink = buildInviteUrl(plainToken, sessionId);
  }

  return ok({
    sessionId,
    callSessionId: sessionId,
    status: "ringing",
    callType,
    contextType,
    conversationId: contextType === "direct" ? conversationId : null,
    groupId: contextType === "group" ? groupId : null,
    participantIds: [user.id, ...participantIds],
    mediaProvider: "jitsi",
    inviteLink,
    inviteExpiresAt,
  });
}

export async function handleAcceptCall(
  supabase: SupabaseClient,
  user: User,
  sessionId: string,
  action: "accept" | "decline" | "missed",
): Promise<HandlerResult> {
  const expiry = await expireStaleRingingCallIfNeeded(supabase, sessionId);
  if (expiry.expired) {
    return fail(410, "Call expired", { status: expiry.status || "missed" });
  }

  const { data: myRow, error: pErr } = await supabase
    .from("call_participants")
    .select("id, invite_status, role, joined_at, left_at")
    .eq("call_session_id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (pErr) return fail(500, pErr.message);
  if (!myRow) return fail(403, "Not a participant");

  const { data: session, error: sErr } = await supabase
    .from("call_sessions")
    .select("id, status, started_at, call_type, room_name")
    .eq("id", sessionId)
    .maybeSingle();
  if (sErr) return fail(500, sErr.message);
  if (!session) return fail(404, "Call not found");

  const sessionStatus = String(session.status || "").toLowerCase();
  if (["ended", "cancelled", "declined", "missed"].includes(sessionStatus)) {
    return fail(410, "Call already ended", { status: sessionStatus });
  }

  const inviteStatus = String(myRow.invite_status || "").toLowerCase();

  if (action === "accept") {
    if (inviteStatus !== "pending") {
      return fail(409, "Call cannot be accepted in current state");
    }
    const nowIso = new Date().toISOString();
    const { error: uErr } = await supabase
      .from("call_participants")
      .update({ invite_status: "accepted", updated_at: nowIso })
      .eq("id", myRow.id);
    if (uErr) return fail(500, uErr.message);

    await supabase.from("call_events").insert({
      call_session_id: sessionId,
      user_id: user.id,
      event_type: "accepted",
      payload: { media_provider: "jitsi" },
    });

    return ok({
      sessionId,
      callSessionId: sessionId,
      status: "accepted",
      mediaProvider: "jitsi",
    });
  }

  if (action === "decline") {
    const nowIso = new Date().toISOString();
    await supabase
      .from("call_participants")
      .update({ invite_status: "declined", left_at: nowIso, updated_at: nowIso })
      .eq("id", myRow.id);
    await supabase.from("call_events").insert({
      call_session_id: sessionId,
      user_id: user.id,
      event_type: "declined",
      payload: {},
    });
    if (sessionStatus === "ringing" || sessionStatus === "joining") {
      await closeUnansweredCall(supabase, sessionId, "declined");
    }
    return ok({ sessionId, callSessionId: sessionId, status: "declined" });
  }

  const nowIso = new Date().toISOString();
  await supabase
    .from("call_participants")
    .update({ invite_status: "missed", left_at: nowIso, updated_at: nowIso })
    .eq("id", myRow.id);
  await supabase.from("call_events").insert({
    call_session_id: sessionId,
    user_id: user.id,
    event_type: "missed",
    payload: {},
  });
  if (sessionStatus === "ringing" || sessionStatus === "joining") {
    await closeUnansweredCall(supabase, sessionId, "missed");
  }
  return ok({ sessionId, callSessionId: sessionId, status: "missed" });
}

export async function handleJoinCall(
  supabase: SupabaseClient,
  user: User,
  sessionId: string,
  inviteToken?: string | null,
  body: Record<string, unknown> = {},
): Promise<HandlerResult> {
  const roomRejected = rejectClientRoomName(body);
  if (roomRejected) return roomRejected;

  const expiry = await expireStaleRingingCallIfNeeded(supabase, sessionId);
  if (expiry.expired) {
    return fail(410, "Call expired", { status: expiry.status || "missed" });
  }

  let inviteTokenHash: string | null = null;
  if (inviteToken) {
    inviteTokenHash = await sha256Hex(inviteToken);
  }

  const { data: sessionJson, error: sErr } = await supabase.rpc("get_call_session_for_join", {
    p_session_id: sessionId,
    p_invite_token_hash: inviteTokenHash,
  });
  if (sErr) return fail(500, sErr.message);
  if (!sessionJson) return fail(404, "Call not found");

  const session = sessionJson as {
    id?: string;
    status?: string;
    room_name?: string;
    call_type?: string;
    creator_id?: string;
    started_at?: string | null;
  };

  const sessionStatus = String(session.status || "").toLowerCase();
  if (["ended", "cancelled", "declined", "missed"].includes(sessionStatus)) {
    return fail(410, "Call already ended", { status: sessionStatus });
  }

  let tokenAuthorized = false;

  const { data: myRow, error: pErr } = await supabase
    .from("call_participants")
    .select("id, invite_status, role, joined_at, left_at")
    .eq("call_session_id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (pErr) return fail(500, pErr.message);
  if (!myRow && !inviteTokenHash) return fail(403, "Not a participant");

  if (inviteTokenHash && !myRow) {
    tokenAuthorized = true;
  }

  let participantId = myRow?.id as string | undefined;
  const role = String(myRow?.role || "participant").toLowerCase();
  let inviteStatus = String(myRow?.invite_status || "").toLowerCase();

  if (tokenAuthorized && !myRow) {
    const { data: inserted, error: insErr } = await supabase
      .from("call_participants")
      .insert({
        call_session_id: sessionId,
        user_id: user.id,
        role: "participant",
        invite_status: "joining",
        joined_at: null,
      })
      .select("id, invite_status, role, joined_at, left_at")
      .single();
    if (insErr) return fail(500, insErr.message);
    participantId = inserted.id;
    inviteStatus = String(inserted.invite_status || "joining").toLowerCase();
  }

  if (participantId && !tokenAuthorized) {
    if (inviteStatus === "declined" || inviteStatus === "removed") {
      return fail(403, "Access revoked");
    }
    if (inviteStatus === "pending") {
      const isCreator = String(session.creator_id || "") === user.id;
      if (role === "host" || isCreator) {
        // Host/creator may enter the room immediately (no callee accept required).
      } else {
        return fail(409, "Accept the call before joining");
      }
    }
  }

  if (tokenAuthorized && inviteTokenHash) {
    const { data: consumed, error: consumeErr } = await supabase.rpc("consume_call_invite_token", {
      p_call_session_id: sessionId,
      p_token_hash: inviteTokenHash,
    });
    if (consumeErr) return fail(500, consumeErr.message);
    const consumeResult = consumed as { ok?: boolean; error?: string } | null;
    if (!consumeResult?.ok) {
      const tokenError = String(consumeResult?.error || "invalid_token");
      if (tokenError === "expired") return fail(410, "Invite token expired");
      if (tokenError === "already_used") return fail(410, "Invite token already used");
      return fail(403, "Invalid invite token");
    }
  }

  const nowIso = new Date().toISOString();
  if (participantId) {
    const joinedAt = myRow?.joined_at ?? nowIso;
    const { error: uErr } = await supabase
      .from("call_participants")
      .update({
        invite_status: "accepted",
        joined_at: joinedAt,
        left_at: null,
        updated_at: nowIso,
      })
      .eq("id", participantId);
    if (uErr) return fail(500, uErr.message);
  }

  const { data: joinedParts } = await supabase
    .from("call_participants")
    .select("id")
    .eq("call_session_id", sessionId)
    .eq("invite_status", "accepted")
    .not("joined_at", "is", null);

  const joinedCount = (joinedParts ?? []).length;
  const sessionUpdates: Record<string, unknown> = { updated_at: nowIso };
  if (joinedCount >= 2 && sessionStatus !== "active") {
    sessionUpdates.status = "active";
    sessionUpdates.started_at = session.started_at ?? nowIso;
  } else if (sessionStatus === "ringing") {
    sessionUpdates.status = "joining";
  }
  if (Object.keys(sessionUpdates).length > 1) {
    const db = getWriteSupabase(supabase);
    const { error: sessionErr } = await db.from("call_sessions").update(sessionUpdates).eq("id", sessionId);
    if (sessionErr) return fail(500, sessionErr.message);
  }

  await supabase.from("call_events").insert({
    call_session_id: sessionId,
    user_id: user.id,
    event_type: "joined",
    payload: { via_token: tokenAuthorized, media_provider: "jitsi" },
  });

  const displayName = await profileDisplayName(supabase, user.id);
  // All authorized Blyve participants join as moderator so JaaS lobby / wait-for-host
  // never blocks the first joiner (common when callee connects before host).
  const isModerator = true;
  const joinPayload = await buildJitsiJoinPayload({
    sessionId,
    roomName: session.room_name as string,
    callType: session.call_type as string,
    displayName,
    status: joinedCount >= 2 ? "active" : "joining",
    userId: user.id,
    email: user.email,
    isModerator,
  });
  if (!joinPayload.ok) {
    return fail(joinPayload.status, joinPayload.error);
  }

  return ok(joinPayload.body);
}

export async function handleInviteParticipant(
  supabase: SupabaseClient,
  user: User,
  sessionId: string,
  targetUserId: string,
  options: { generateInviteLink?: boolean; inviteExpiresInMinutes?: number } = {},
): Promise<HandlerResult> {
  if (!isUuid(targetUserId)) return fail(400, "Invalid userId");
  if (targetUserId === user.id) return fail(400, "Cannot invite yourself");

  const generateInviteLink = Boolean(options.generateInviteLink);
  const inviteExpiresInMinutes = Math.min(
    1440,
    Math.max(5, Number(options.inviteExpiresInMinutes ?? 60) || 60),
  );

  const jitsiProvider = resolveJitsiProviderConfig();
  if (!jitsiProvider.ok) {
    return fail(jitsiProvider.status, jitsiProvider.error);
  }

  const { data: session, error: sErr } = await supabase
    .from("call_sessions")
    .select("id, creator_id, status, context_type, group_id, conversation_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (sErr) return fail(500, sErr.message);
  if (!session) return fail(404, "Call not found");
  if (session.creator_id !== user.id) return fail(403, "Only the call creator can invite");

  const sessionStatus = String(session.status || "").toLowerCase();
  if (["ended", "cancelled", "declined", "missed"].includes(sessionStatus)) {
    return fail(410, "Call already ended");
  }

  const { data: existing } = await supabase
    .from("call_participants")
    .select("id, invite_status")
    .eq("call_session_id", sessionId)
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (existing) {
    const st = String(existing.invite_status || "").toLowerCase();
    if (!["declined", "left", "removed", "missed"].includes(st)) {
      return fail(409, "User is already invited or in the call");
    }
  }

  if (session.context_type === "group" && session.group_id) {
    const { data: membership } = await supabase
      .from("group_members")
      .select("user_id")
      .eq("group_id", session.group_id)
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (!membership) return fail(400, "User is not in this group");
  }

  if (session.context_type === "direct" && session.conversation_id) {
    const { data: conv } = await supabase
      .from("conversations")
      .select("user1_id, user2_id")
      .eq("id", session.conversation_id)
      .maybeSingle();
    if (conv && conv.user1_id !== targetUserId && conv.user2_id !== targetUserId) {
      return fail(400, "User is not part of this conversation");
    }
  }

  const nowIso = new Date().toISOString();
  if (existing) {
    await supabase
      .from("call_participants")
      .update({
        invite_status: "pending",
        joined_at: null,
        left_at: null,
        updated_at: nowIso,
      })
      .eq("id", existing.id);
  } else {
    const { error: insErr } = await supabase.from("call_participants").insert({
      call_session_id: sessionId,
      user_id: targetUserId,
      role: "participant",
      invite_status: "pending",
    });
    if (insErr) return fail(500, insErr.message);
  }

  await supabase.from("call_events").insert({
    call_session_id: sessionId,
    user_id: user.id,
    event_type: "ringing",
    payload: { invited_user_id: targetUserId },
  });

  let inviteLink: string | undefined;
  let inviteExpiresAt: string | undefined;
  if (generateInviteLink) {
    const plainToken =
      crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const tokenHash = await sha256Hex(plainToken);
    inviteExpiresAt = new Date(Date.now() + inviteExpiresInMinutes * 60_000).toISOString();
    const { error: tokenErr } = await supabase.from("call_invite_tokens").insert({
      call_session_id: sessionId,
      token_hash: tokenHash,
      created_by: user.id,
      expires_at: inviteExpiresAt,
      max_uses: 1,
      use_count: 0,
    });
    if (tokenErr) return fail(500, tokenErr.message);
    inviteLink = buildInviteUrl(plainToken, sessionId);
  }

  return ok({
    sessionId,
    callSessionId: sessionId,
    userId: targetUserId,
    status: "pending",
    jitsiDomain: jitsiProvider.domain,
    inviteLink,
    inviteExpiresAt,
    mediaProvider: "jitsi",
  });
}

export async function handleEndCall(
  supabase: SupabaseClient,
  user: User,
  sessionId: string,
): Promise<HandlerResult> {
  const { data: session, error: sErr } = await supabase
    .from("call_sessions")
    .select("id, creator_id, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (sErr) return fail(500, sErr.message);
  if (!session) return fail(404, "Call not found");

  const { data: myPart, error: mpErr } = await supabase
    .from("call_participants")
    .select("role")
    .eq("call_session_id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (mpErr) return fail(500, mpErr.message);
  if (!myPart) return fail(403, "Not a participant");

  const isHost = myPart.role === "host";
  const isCreator = session.creator_id === user.id;
  if (!isCreator && !isHost) {
    return fail(403, "Only the creator or host can end the call");
  }

  const sessionStatus = String(session.status || "").toLowerCase();
  if (["ended", "cancelled", "declined"].includes(sessionStatus)) {
    return ok({ success: true, sessionId, callSessionId: sessionId, status: sessionStatus });
  }

  const endedAt = new Date().toISOString();
  const { error: endErr } = await supabase
    .from("call_sessions")
    .update({ status: "ended", ended_at: endedAt, updated_at: endedAt })
    .eq("id", sessionId);
  if (endErr) return fail(500, endErr.message);

  const { data: parts } = await supabase
    .from("call_participants")
    .select("id, invite_status, left_at")
    .eq("call_session_id", sessionId);

  for (const p of parts ?? []) {
    if (p.left_at) continue;
    const invite = String(p.invite_status || "").toLowerCase();
    const nextInvite =
      invite === "accepted" || invite === "joining"
        ? "left"
        : invite === "pending"
        ? "removed"
        : invite;
    await supabase
      .from("call_participants")
      .update({ invite_status: nextInvite, left_at: endedAt, updated_at: endedAt })
      .eq("id", p.id);
  }

  await supabase.from("call_events").insert({
    call_session_id: sessionId,
    user_id: user.id,
    event_type: "ended",
    payload: { media_provider: "jitsi" },
  });

  return ok({
    success: true,
    sessionId,
    callSessionId: sessionId,
    status: "ended",
    endedAt,
  });
}
