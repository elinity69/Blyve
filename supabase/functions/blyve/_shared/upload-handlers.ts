// @ts-ignore - Deno npm: imports are valid at runtime
import type { Context } from "npm:hono";
// @ts-ignore - Deno jsr: imports are valid at runtime
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  buildPublicUrl,
  buildStorageKey,
  createPresignedPutUrl,
  extensionFromMime,
  getR2Config,
  objectExistsInR2,
  validateUploadRequest,
} from "./r2.ts";

type UploadContext =
  | { type: "dm"; conversationId: string }
  | { type: "group"; groupId: string; channelId: string };

async function assertDmParticipant(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .maybeSingle();
  return !error && !!data;
}

async function assertGroupChannelMember(
  supabase: SupabaseClient,
  userId: string,
  groupId: string,
  channelId: string,
): Promise<boolean> {
  const { data: member } = await supabase
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!member) return false;

  const { data: channel } = await supabase
    .from("group_channels")
    .select("id, type")
    .eq("id", channelId)
    .eq("group_id", groupId)
    .maybeSingle();
  return !!channel && channel.type !== "voice";
}

function parseUploadContext(body: Record<string, unknown>): UploadContext | null {
  const conversationId = String(body.conversation_id || "").trim();
  const groupId = String(body.group_id || "").trim();
  const channelId = String(body.channel_id || "").trim();

  if (conversationId && !groupId && !channelId) {
    return { type: "dm", conversationId };
  }
  if (groupId && channelId && !conversationId) {
    return { type: "group", groupId, channelId };
  }
  return null;
}

export async function handleUploadPresign(c: Context, getSupabase: (c: Context) => SupabaseClient) {
  const r2 = getR2Config();
  if (!r2) {
    return c.json({ error: "R2 is not configured on the server" }, 503);
  }

  const supabase = getSupabase(c);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const mimeType = String(body.mime_type || body.mimeType || "").trim();
  const sizeBytes = Number(body.size_bytes ?? body.sizeBytes ?? 0);
  const originalFilename = String(body.filename || body.original_filename || "").trim() || null;

  const validation = validateUploadRequest(mimeType, sizeBytes);
  if (!validation.ok) {
    return c.json({ error: validation.error }, 400);
  }

  const ctx = parseUploadContext(body);
  if (!ctx) {
    return c.json({
      error: "Provide conversation_id (DM) or group_id + channel_id (group)",
    }, 400);
  }

  if (ctx.type === "dm") {
    const ok = await assertDmParticipant(supabase, user.id, ctx.conversationId);
    if (!ok) return c.json({ error: "Not a conversation participant" }, 403);
  } else {
    const ok = await assertGroupChannelMember(
      supabase,
      user.id,
      ctx.groupId,
      ctx.channelId,
    );
    if (!ok) return c.json({ error: "Not allowed in this channel" }, 403);
  }

  const ext = extensionFromMime(mimeType);
  const storageKey = buildStorageKey(user.id, ext);
  const { uploadUrl, expiresIn } = await createPresignedPutUrl(
    r2,
    storageKey,
    mimeType,
    sizeBytes,
  );

  const insertRow: Record<string, unknown> = {
    uploader_id: user.id,
    storage_key: storageKey,
    bucket_name: r2.bucketName,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    kind: validation.kind,
    status: "pending",
    original_filename: originalFilename,
    conversation_id: ctx.type === "dm" ? ctx.conversationId : null,
    group_id: ctx.type === "group" ? ctx.groupId : null,
    channel_id: ctx.type === "group" ? ctx.channelId : null,
  };

  const { data: attachment, error: insertError } = await supabase
    .from("message_attachments")
    .insert(insertRow)
    .select("id, storage_key, kind, mime_type, size_bytes, status, created_at")
    .single();

  if (insertError || !attachment) {
    console.error("message_attachments insert failed:", insertError);
    return c.json({ error: "Failed to create attachment record" }, 500);
  }

  return c.json({
    attachmentId: attachment.id,
    uploadUrl,
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
    },
    storageKey,
    expiresIn,
    kind: validation.kind,
  });
}

export async function handleUploadConfirm(c: Context, getSupabase: (c: Context) => SupabaseClient) {
  const r2 = getR2Config();
  if (!r2) {
    return c.json({ error: "R2 is not configured on the server" }, 503);
  }

  const supabase = getSupabase(c);
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const attachmentId = String(body.attachment_id || body.attachmentId || "").trim();
  if (!attachmentId) {
    return c.json({ error: "attachment_id required" }, 400);
  }

  const { data: row, error: fetchError } = await supabase
    .from("message_attachments")
    .select("*")
    .eq("id", attachmentId)
    .eq("uploader_id", user.id)
    .maybeSingle();

  if (fetchError || !row) {
    return c.json({ error: "Attachment not found" }, 404);
  }

  if (row.status === "ready") {
    return c.json({
      attachmentId: row.id,
      status: "ready",
      publicUrl: row.public_url,
      kind: row.kind,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
    });
  }

  if (row.status !== "pending") {
    return c.json({ error: "Attachment is not pending" }, 400);
  }

  const exists = await objectExistsInR2(r2, row.storage_key);
  if (!exists) {
    await supabase
      .from("message_attachments")
      .update({ status: "failed" })
      .eq("id", attachmentId);
    return c.json({ error: "Upload not found in storage" }, 400);
  }

  const publicUrl = buildPublicUrl(r2, row.storage_key);
  const { data: updated, error: updateError } = await supabase
    .from("message_attachments")
    .update({
      status: "ready",
      public_url: publicUrl,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", attachmentId)
    .select("id, status, public_url, kind, mime_type, size_bytes, storage_key")
    .single();

  if (updateError || !updated) {
    return c.json({ error: "Failed to confirm upload" }, 500);
  }

  return c.json({
    attachmentId: updated.id,
    status: updated.status,
    publicUrl: updated.public_url,
    kind: updated.kind,
    mimeType: updated.mime_type,
    sizeBytes: updated.size_bytes,
    storageKey: updated.storage_key,
  });
}
