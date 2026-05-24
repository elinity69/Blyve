import {
  handleOptions,
  json,
  requireUser,
} from "./_shared/call-utils.ts";
import { handleCreateCallSession } from "./_shared/jitsi-call-handlers.ts";

Deno.serve(async (req: Request) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return json({ error: "Method not allowed", code: 405 }, 405);

  try {
    const auth = await requireUser(req);
    if ("error" in auth) return auth.error;
    const body = await req.json().catch(() => ({}));
    const result = await handleCreateCallSession(auth.supabase, auth.user, body);
    return json(result.body, result.status);
  } catch (e) {
    console.error("create-call-session", e);
    return json({ error: "Failed to create call session", code: 500 }, 500);
  }
});
