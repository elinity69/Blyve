/**
 * Group invites, channel CRUD, and voice-channel join/leave handlers.
 */

declare const Deno: {
  env: { get(key: string): string | undefined };
};

// @ts-ignore Deno jsr import
import type { SupabaseClient, User } from "jsr:@supabase/supabase-js@2";
import { getWriteSupabase, isUuid } from "./call-utils.ts";
import { handleJoinCall } from "./jitsi-call-handlers.ts";

export type GroupHandlerResult = {
  status: number;
  body: Record<string, unknown>;
};

function fail(status: number, error: string, extra: Record<string, unknown> = {}): GroupHandlerResult {
  return { status, body: { error, code: status, ...extra } };
}

function ok(body: Record<string, unknown>, status = 200): GroupHandlerResult {
  return { status, body };
}

function normalizeChannelName(raw: string): string {
  return raw.trim().replace(/^#+/, "").replace(/\s+/g, "-").toLowerCase();
}

const GROUP_CHANNEL_SELECT =
  "id, group_id, name, position, type, icon_url, created_at";

function parseOptionalIconUrl(
  body: Record<string, unknown>,
): { iconUrl: string | null | undefined; error?: GroupHandlerResult } {
  if (body.iconUrl === undefined && body.icon_url === undefined) {
    return { iconUrl: undefined };
  }
  const raw = body.iconUrl ?? body.icon_url;
  if (raw == null || String(raw).trim() === "") return { iconUrl: null };
  const url = String(raw).trim();
  if (url.length > 2048) return { error: fail(400, "Icon URL too long") };
  if (!/^https:\/\/.+/i.test(url)) return { error: fail(400, "Invalid icon URL") };
  return { iconUrl: url };
}

async function assertGroupAdmin(
  supabase: SupabaseClient,
  groupId: string,
  userId: string,
): Promise<GroupHandlerResult | null> {
  const { data: group, error: groupErr } = await supabase
    .from("groups")
    .select("id, creator_id")
    .eq("id", groupId)
    .maybeSingle();
  if (groupErr) return fail(500, groupErr.message);
  if (!group) return fail(404, "Group not found");
  if (group.creator_id === userId) return null;

  const { data: membership, error: memErr } = await supabase
    .from("group_members")
    .select("role")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();
  if (memErr) return fail(500, memErr.message);
  if (!membership || membership.role !== "admin") {
    return fail(403, "Admin access required");
  }
  return null;
}

async function assertGroupMember(
  supabase: SupabaseClient,
  groupId: string,
  userId: string,
): Promise<GroupHandlerResult | null> {
  const { data: membership, error: memErr } = await supabase
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();
  if (memErr) return fail(500, memErr.message);
  if (!membership) return fail(403, "Not a member of this group");
  return null;
}

function buildGroupInviteUrl(code: string): string {
  const base =
    Deno.env.get("APP_URL") ??
    Deno.env.get("FRONTEND_URL") ??
    Deno.env.get("SITE_URL") ??
    "";
  const path = `/groups/join?code=${encodeURIComponent(code)}`;
  return base ? `${base.replace(/\/$/, "")}${path}` : path;
}

export async function handleGetGroupInvite(
  supabase: SupabaseClient,
  user: User,
  groupId: string,
): Promise<GroupHandlerResult> {
  if (!isUuid(groupId)) return fail(400, "Invalid group id");
  const denied = await assertGroupMember(supabase, groupId, user.id);
  if (denied) return denied;

  const { data: group, error } = await supabase
    .from("groups")
    .select("id, invite_code")
    .eq("id", groupId)
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!group?.invite_code) return fail(404, "Group not found");

  const code = String(group.invite_code);
  return ok({
    inviteCode: code,
    inviteUrl: buildGroupInviteUrl(code),
  });
}

export async function handleRefreshGroupInvite(
  supabase: SupabaseClient,
  user: User,
  groupId: string,
): Promise<GroupHandlerResult> {
  if (!isUuid(groupId)) return fail(400, "Invalid group id");
  const denied = await assertGroupAdmin(supabase, groupId, user.id);
  if (denied) return denied;

  const { data: code, error } = await supabase.rpc("refresh_group_invite_code", {
    p_group_id: groupId,
  });
  if (error) {
    if (error.message.includes("forbidden")) return fail(403, "Admin access required");
    return fail(500, error.message);
  }
  if (!code) return fail(500, "Failed to refresh invite code");

  const inviteCode = String(code);
  return ok({
    inviteCode,
    inviteUrl: buildGroupInviteUrl(inviteCode),
    refreshed: true,
  });
}

export async function handleJoinGroupViaInvite(
  supabase: SupabaseClient,
  user: User,
  body: Record<string, unknown>,
): Promise<GroupHandlerResult> {
  const code = String(body.code ?? body.inviteCode ?? "").trim();
  if (!code) return fail(400, "Invite code required");

  const { data: result, error: rpcErr } = await supabase.rpc("consume_group_invite", {
    p_code: code,
  });
  if (rpcErr) return fail(500, rpcErr.message);

  const payload = (result || {}) as { ok?: boolean; error?: string; group_id?: string };
  if (!payload.ok) {
    const err = String(payload.error || "invalid_code");
    if (err === "not_found") return fail(404, "Invite not found");
    return fail(400, "Invalid invite code");
  }

  const { data: group, error: groupErr } = await supabase
    .from("groups")
    .select("id, name, description, is_private, created_at")
    .eq("id", payload.group_id)
    .maybeSingle();
  if (groupErr) return fail(500, groupErr.message);
  if (!group) return fail(404, "Group not found");

  return ok({ group, groupId: group.id, joined: true });
}

export async function handleCreateGroupChannel(
  supabase: SupabaseClient,
  user: User,
  groupId: string,
  body: Record<string, unknown>,
): Promise<GroupHandlerResult> {
  if (!isUuid(groupId)) return fail(400, "Invalid group id");
  const denied = await assertGroupAdmin(supabase, groupId, user.id);
  if (denied) return denied;

  const name = normalizeChannelName(String(body.name ?? ""));
  const type = String(body.type ?? "text").toLowerCase();
  if (!name || name.length < 1 || name.length > 80) {
    return fail(400, "Channel name must be 1–80 characters");
  }
  if (!["text", "voice"].includes(type)) {
    return fail(400, "Channel type must be text or voice");
  }

  const iconResult = parseOptionalIconUrl(body);
  if (iconResult.error) return iconResult.error;

  const { data: maxRow } = await supabase
    .from("group_channels")
    .select("position")
    .eq("group_id", groupId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = Number(maxRow?.position ?? 0) + 1;

  const { data: channel, error: insErr } = await supabase
    .from("group_channels")
    .insert({
      group_id: groupId,
      name,
      position,
      type,
      ...(iconResult.iconUrl !== undefined ? { icon_url: iconResult.iconUrl } : {}),
    })
    .select(GROUP_CHANNEL_SELECT)
    .single();
  if (insErr) {
    if (insErr.code === "23505") return fail(409, "A channel with this name already exists");
    return fail(500, insErr.message);
  }

  return ok({ channel });
}

export async function handleUpdateGroupChannel(
  supabase: SupabaseClient,
  user: User,
  groupId: string,
  channelId: string,
  body: Record<string, unknown>,
): Promise<GroupHandlerResult> {
  if (!isUuid(groupId) || !isUuid(channelId)) return fail(400, "Invalid id");
  const denied = await assertGroupAdmin(supabase, groupId, user.id);
  if (denied) return denied;

  const updates: Record<string, unknown> = {};
  if (body.name != null) {
    const name = normalizeChannelName(String(body.name));
    if (!name) return fail(400, "Invalid channel name");
    updates.name = name;
  }
  if (body.position != null) updates.position = Number(body.position);
  if (body.iconUrl !== undefined || body.icon_url !== undefined) {
    const iconResult = parseOptionalIconUrl(body);
    if (iconResult.error) return iconResult.error;
    updates.icon_url = iconResult.iconUrl ?? null;
  }

  if (Object.keys(updates).length === 0) return fail(400, "Nothing to update");

  const { data: channel, error: updErr } = await supabase
    .from("group_channels")
    .update(updates)
    .eq("id", channelId)
    .eq("group_id", groupId)
    .select(GROUP_CHANNEL_SELECT)
    .maybeSingle();
  if (updErr) return fail(500, updErr.message);
  if (!channel) return fail(404, "Channel not found");

  return ok({ channel });
}

export async function handleDeleteGroupChannel(
  supabase: SupabaseClient,
  user: User,
  groupId: string,
  channelId: string,
): Promise<GroupHandlerResult> {
  if (!isUuid(groupId) || !isUuid(channelId)) return fail(400, "Invalid id");
  const denied = await assertGroupAdmin(supabase, groupId, user.id);
  if (denied) return denied;

  const { data: channel, error: chErr } = await supabase
    .from("group_channels")
    .select("id, name, type")
    .eq("id", channelId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (chErr) return fail(500, chErr.message);
  if (!channel) return fail(404, "Channel not found");
  if (channel.name === "general" && channel.type === "text") {
    return fail(400, "Cannot delete the default #general channel");
  }

  const { error: delErr } = await supabase
    .from("group_channels")
    .delete()
    .eq("id", channelId)
    .eq("group_id", groupId);
  if (delErr) return fail(500, delErr.message);

  return ok({ deleted: true, channelId });
}

export async function handleGetVoiceChannelState(
  supabase: SupabaseClient,
  user: User,
  groupId: string,
  channelId: string,
): Promise<GroupHandlerResult> {
  if (!isUuid(groupId) || !isUuid(channelId)) return fail(400, "Invalid id");
  const denied = await assertGroupMember(supabase, groupId, user.id);
  if (denied) return denied;

  const { data: channel, error: chErr } = await supabase
    .from("group_channels")
    .select("id, group_id, name, type")
    .eq("id", channelId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (chErr) return fail(500, chErr.message);
  if (!channel) return fail(404, "Channel not found");
  if (channel.type !== "voice") return fail(400, "Not a voice channel");

  const { data: presence, error: pErr } = await supabase
    .from("voice_channel_presence")
    .select(`
      user_id,
      joined_at,
      call_session_id,
      profiles:user_id (
        id,
        display_name,
        name,
        username,
        avatar_url
      )
    `)
    .eq("channel_id", channelId)
    .order("joined_at", { ascending: true });
  if (pErr) return fail(500, pErr.message);

  const { data: activeSession } = await supabase
    .from("call_sessions")
    .select("id, status, call_type, started_at")
    .eq("channel_id", channelId)
    .in("status", ["joining", "active"])
    .maybeSingle();

  return ok({
    channel,
    sessionId: activeSession?.id ?? null,
    sessionStatus: activeSession?.status ?? null,
    participants: presence || [],
    participantCount: (presence || []).length,
  });
}

async function leaveOtherVoiceChannels(
  supabase: SupabaseClient,
  userId: string,
  groupId: string,
  exceptChannelId?: string,
): Promise<void> {
  let query = supabase
    .from("voice_channel_presence")
    .select("id, channel_id, call_session_id")
    .eq("group_id", groupId)
    .eq("user_id", userId);
  if (exceptChannelId) query = query.neq("channel_id", exceptChannelId);
  const { data: rows } = await query;
  for (const row of rows || []) {
    await handleLeaveVoiceChannel(
      supabase,
      { id: userId } as User,
      groupId,
      row.channel_id as string,
    );
  }
}

export async function handleJoinVoiceChannel(
  supabase: SupabaseClient,
  user: User,
  groupId: string,
  channelId: string,
  body: Record<string, unknown> = {},
): Promise<GroupHandlerResult> {
  if (!isUuid(groupId) || !isUuid(channelId)) return fail(400, "Invalid id");
  const denied = await assertGroupMember(supabase, groupId, user.id);
  if (denied) return denied;

  const { data: channel, error: chErr } = await supabase
    .from("group_channels")
    .select("id, group_id, name, type")
    .eq("id", channelId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (chErr) return fail(500, chErr.message);
  if (!channel) return fail(404, "Channel not found");
  if (channel.type !== "voice") return fail(400, "Not a voice channel");

  await leaveOtherVoiceChannels(supabase, user.id, groupId, channelId);

  const callType = ["audio", "video", "screen"].includes(String(body.callType ?? "audio"))
    ? String(body.callType)
    : "audio";

  const db = getWriteSupabase(supabase);
  let sessionId: string | null = null;

  const { data: existingSession } = await db
    .from("call_sessions")
    .select("id, status, room_name, call_type")
    .eq("channel_id", channelId)
    .in("status", ["joining", "active"])
    .maybeSingle();

  const nowIso = new Date().toISOString();

  if (existingSession?.id) {
    sessionId = existingSession.id as string;
  } else {
    const { data: roomName, error: roomErr } = await supabase.rpc("generate_call_room_name");
    if (roomErr || !roomName) return fail(500, roomErr?.message || "Failed to generate room");

    sessionId = crypto.randomUUID();
    const { error: sessionErr } = await db.from("call_sessions").insert({
      id: sessionId,
      call_type: callType,
      context_type: "group",
      group_id: groupId,
      channel_id: channelId,
      creator_id: user.id,
      room_name: roomName,
      status: "joining",
      started_at: nowIso,
    });
    if (sessionErr) {
      if (sessionErr.code === "23505") {
        const { data: raced } = await db
          .from("call_sessions")
          .select("id")
          .eq("channel_id", channelId)
          .in("status", ["joining", "active"])
          .maybeSingle();
        sessionId = raced?.id ?? null;
      } else {
        return fail(500, sessionErr.message);
      }
    }

    if (sessionId) {
      await db.from("call_participants").insert({
        call_session_id: sessionId,
        user_id: user.id,
        role: "host",
        invite_status: "accepted",
        joined_at: null,
      });
      await db.from("call_events").insert({
        call_session_id: sessionId,
        user_id: user.id,
        event_type: "created",
        payload: {
          context_type: "group",
          voice_channel_id: channelId,
          media_provider: "jitsi",
        },
      });
    }
  }

  if (!sessionId) return fail(500, "Failed to resolve voice session");

  const { data: partRow } = await db
    .from("call_participants")
    .select("id, invite_status, left_at")
    .eq("call_session_id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (partRow?.id) {
    await db
      .from("call_participants")
      .update({
        invite_status: "accepted",
        left_at: null,
        updated_at: nowIso,
      })
      .eq("id", partRow.id);
  } else {
    await db.from("call_participants").insert({
      call_session_id: sessionId,
      user_id: user.id,
      role: "participant",
      invite_status: "accepted",
      joined_at: null,
    });
  }

  await db.from("voice_channel_presence").upsert(
    {
      group_id: groupId,
      channel_id: channelId,
      user_id: user.id,
      call_session_id: sessionId,
      joined_at: nowIso,
    },
    { onConflict: "channel_id,user_id" },
  );

  const joinResult = await handleJoinCall(supabase, user, sessionId, null, body);
  if (joinResult.status >= 400) return joinResult;

  return ok({
    ...joinResult.body,
    sessionId,
    callSessionId: sessionId,
    groupId,
    channelId,
    channelName: channel.name,
    voiceChannel: true,
  });
}

export async function handleLeaveVoiceChannel(
  supabase: SupabaseClient,
  user: User,
  groupId: string,
  channelId: string,
): Promise<GroupHandlerResult> {
  if (!isUuid(groupId) || !isUuid(channelId)) return fail(400, "Invalid id");

  const { data: presence, error: pErr } = await supabase
    .from("voice_channel_presence")
    .select("id, call_session_id")
    .eq("group_id", groupId)
    .eq("channel_id", channelId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (pErr) return fail(500, pErr.message);
  if (!presence) return ok({ left: true, sessionEnded: false });

  const sessionId = presence.call_session_id as string;
  const nowIso = new Date().toISOString();
  const db = getWriteSupabase(supabase);

  await db.from("voice_channel_presence").delete().eq("id", presence.id);

  await db
    .from("call_participants")
    .update({
      invite_status: "left",
      left_at: nowIso,
      updated_at: nowIso,
    })
    .eq("call_session_id", sessionId)
    .eq("user_id", user.id);

  const { count } = await db
    .from("voice_channel_presence")
    .select("id", { count: "exact", head: true })
    .eq("call_session_id", sessionId);

  let sessionEnded = false;
  if ((count ?? 0) === 0) {
    sessionEnded = true;
    await db
      .from("call_sessions")
      .update({ status: "ended", ended_at: nowIso, updated_at: nowIso })
      .eq("id", sessionId);
    await db.from("call_events").insert({
      call_session_id: sessionId,
      user_id: user.id,
      event_type: "ended",
      payload: { reason: "voice_channel_empty", media_provider: "jitsi" },
    });
  }

  return ok({ left: true, sessionId, sessionEnded });
}
