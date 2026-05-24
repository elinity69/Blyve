declare const Deno: {
  env: { get(key: string): string | undefined };
};

import {
  handleOptions,
  isUuid,
  json,
  parseSessionId,
  requireUser,
} from "./_shared/call-utils.ts";
import { handleInviteParticipant } from "./_shared/jitsi-call-handlers.ts";

Deno.serve(async (req: Request) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== "POST") return json({ error: "Method not allowed", code: 405 }, 405);

  try {
    const auth = await requireUser(req);
    if ("error" in auth) return auth.error;
    const body = await req.json().catch(() => ({}));
    const sessionId = parseSessionId(body);
    const userId = body.userId ? String(body.userId) : "";
    if (!sessionId) return json({ error: "Invalid sessionId", code: 400 }, 400);
    if (!isUuid(userId)) return json({ error: "Invalid userId", code: 400 }, 400);

    const result = await handleInviteParticipant(auth.supabase, auth.user, sessionId, userId, {
      generateInviteLink: Boolean(body.generateInviteLink),
      inviteExpiresInMinutes: body.inviteExpiresInMinutes,
    });
    return json(result.body, result.status);
  } catch (e) {
    console.error("invite-participant", e);
    return json({ error: "Failed to invite participant", code: 500 }, 500);
  }
});
