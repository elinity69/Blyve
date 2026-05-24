import {
  handleOptions,
  json,
  parseSessionId,
  requireUser,
} from "./_shared/call-utils.ts";
import { handleJoinCall } from "./_shared/jitsi-call-handlers.ts";

Deno.serve(async (req: Request) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return json({ error: "Method not allowed", code: 405 }, 405);

  try {
    const auth = await requireUser(req);
    if ("error" in auth) return auth.error;
    const body = await req.json().catch(() => ({}));
    const sessionId = parseSessionId(body);
    if (!sessionId) return json({ error: "Invalid sessionId", code: 400 }, 400);
    const inviteToken = body.inviteToken ? String(body.inviteToken) : undefined;
    const result = await handleJoinCall(auth.supabase, auth.user, sessionId, inviteToken, body);
    return json(result.body, result.status);
  } catch (e) {
    console.error("join-call", e);
    return json({ error: "Failed to join call", code: 500 }, 500);
  }
});
