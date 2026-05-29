declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

// @ts-ignore Deno npm import
import webpush from "npm:web-push@3.6.7";
// @ts-ignore Deno jsr import
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const PUSH_SECRET = Deno.env.get("PUSH_WEBHOOK_SECRET")?.trim();
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT")?.trim() ?? "mailto:hello@blyve.app";
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")?.trim();
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")?.trim();

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-blyve-push-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function getAdminSupabase(): SupabaseClient | null {
  const url = Deno.env.get("SUPABASE_URL")?.trim();
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

function verifySecret(req: Request): boolean {
  if (!PUSH_SECRET) return false;
  return req.headers.get("x-blyve-push-secret") === PUSH_SECRET;
}

interface PushPayload {
  title: string;
  body: string;
  icon?: string | null;
  tag?: string;
  data?: Record<string, string>;
}

async function sendToUser(
  admin: SupabaseClient,
  userId: string,
  payload: PushPayload,
): Promise<number> {
  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (error || !subs?.length) return 0;

  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify({
          title: payload.title,
          body: payload.body,
          icon: payload.icon || "/icon.png",
          tag: payload.tag,
          data: payload.data ?? {},
        }),
      );
      sent += 1;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await admin.from("push_subscriptions").delete().eq("id", sub.id);
      } else {
        console.warn("push failed", sub.id, err);
      }
    }
  }

  return sent;
}

function displayName(profile: {
  display_name?: string | null;
  name?: string | null;
  username?: string | null;
} | null): string {
  return profile?.display_name || profile?.name || profile?.username || "Someone";
}

function previewText(content: string | null | undefined): string {
  const text = (content ?? "").trim();
  if (!text) return "New message";
  return text.length > 100 ? `${text.slice(0, 100)}...` : text;
}

async function handleDmPush(
  admin: SupabaseClient,
  body: Record<string, unknown>,
): Promise<Response> {
  const conversationId = String(body.conversation_id ?? "");
  const senderId = String(body.sender_id ?? "");
  const messageId = String(body.message_id ?? "");
  const content = String(body.content ?? "");

  if (!conversationId || !senderId) {
    return json({ error: "Missing conversation_id or sender_id" }, 400);
  }

  const { data: conv } = await admin
    .from("conversations")
    .select("user1_id, user2_id")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conv) return json({ ok: true, skipped: "conversation_not_found" });

  const recipientId = conv.user1_id === senderId ? conv.user2_id : conv.user1_id;
  if (!recipientId || recipientId === senderId) {
    return json({ ok: true, skipped: "no_recipient" });
  }

  const { data: sender } = await admin
    .from("profiles")
    .select("display_name, name, username, avatar_url, images")
    .eq("id", senderId)
    .maybeSingle();

  const icon = sender?.avatar_url || sender?.images?.[0] || null;
  const sent = await sendToUser(admin, recipientId, {
    title: `💬 ${displayName(sender)}`,
    body: previewText(content),
    icon,
    tag: messageId ? `message-${messageId}` : undefined,
    data: {
      conversationId,
      senderId,
    },
  });

  return json({ ok: true, sent });
}

async function handleGroupPush(
  admin: SupabaseClient,
  body: Record<string, unknown>,
): Promise<Response> {
  const groupId = String(body.group_id ?? "");
  const channelId = body.channel_id ? String(body.channel_id) : "";
  const senderId = String(body.sender_id ?? "");
  const messageId = String(body.message_id ?? "");
  const content = String(body.content ?? "");

  if (!groupId || !senderId) {
    return json({ error: "Missing group_id or sender_id" }, 400);
  }

  const { data: members } = await admin
    .from("group_members")
    .select("user_id")
    .eq("group_id", groupId)
    .neq("user_id", senderId);

  if (!members?.length) return json({ ok: true, sent: 0 });

  const [{ data: sender }, { data: channel }, { data: group }] = await Promise.all([
    admin
      .from("profiles")
      .select("display_name, name, username, avatar_url, images")
      .eq("id", senderId)
      .maybeSingle(),
    channelId
      ? admin.from("group_channels").select("name").eq("id", channelId).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("groups").select("name").eq("id", groupId).maybeSingle(),
  ]);

  const senderName = displayName(sender);
  const channelName = channel?.name ?? "general";
  const groupName = group?.name ?? "Group";
  const icon = sender?.avatar_url || sender?.images?.[0] || null;

  let totalSent = 0;
  for (const member of members) {
    totalSent += await sendToUser(admin, member.user_id, {
      title: `💬 ${senderName} · #${channelName}`,
      body: `${groupName}: ${previewText(content)}`,
      icon,
      tag: messageId ? `group-message-${messageId}` : undefined,
      data: {
        groupId,
        channelId,
        senderId,
      },
    });
  }

  return json({ ok: true, sent: totalSent });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!verifySecret(req)) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return json({ error: "VAPID keys not configured" }, 503);
  }

  const admin = getAdminSupabase();
  if (!admin) {
    return json({ error: "Server misconfigured" }, 503);
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const type = String(body.type ?? "");

  try {
    if (type === "dm") return await handleDmPush(admin, body);
    if (type === "group") return await handleGroupPush(admin, body);
    return json({ error: "Unknown type" }, 400);
  } catch (err) {
    console.error("send-push", err);
    return json({ error: "Internal error" }, 500);
  }
});
