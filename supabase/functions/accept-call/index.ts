import {
  handleOptions,
  json,
  parseSessionId,
  requireUser,
} from "./_shared/call-utils.ts";
import { handleAcceptCall } from "./_shared/jitsi-call-handlers.ts";

Deno.serve(async (req: Request) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return json({ error: "Method not allowed", code: 405 }, 405);

  try {
    const auth = await requireUser(req);
    if ("error" in auth) return auth.error;
    const body = await req.json().catch(() => ({}));
    const sessionId = parseSessionId(body);
    const action = String(body.action || "accept") as "accept" | "decline" | "missed";
    if (!sessionId) return json({ error: "Invalid sessionId", code: 400 }, 400);
    if (!["accept", "decline", "missed"].includes(action)) {
      return json({ error: "Invalid action", code: 400 }, 400);
    }
    const result = await handleAcceptCall(auth.supabase, auth.user, sessionId, action);
    return json(result.body, result.status);
  } catch (e) {
    console.error("accept-call", e);
    return json({ error: "Failed to accept call", code: 500 }, 500);
  }
});
