/**
 * JWT minting for Blyve Jitsi calls.
 * - 8x8 JaaS: RS256 + API private key (JITSI_API_KEY_ID, JITSI_API_PRIVATE_KEY)
 * - Self-hosted: HS256 shared secret (JITSI_APP_SECRET) — later option
 */

declare const Deno: {
  env: { get(key: string): string | undefined };
};

export type JitsiJwtMode = "jaas" | "self-hosted";

export type JitsiJwtConfig =
  | {
      mode: "jaas";
      appId: string;
      apiKeyId: string;
      privateKeyPem: string;
    }
  | {
      mode: "self-hosted";
      appId: string;
      appSecret: string;
    };

export interface MintJitsiJwtInput {
  domain: string;
  roomName: string;
  displayName: string;
  userId: string;
  email?: string | null;
  isModerator: boolean;
  ttlSeconds?: number;
}

export type JitsiProviderConfig =
  | { ok: true; domain: string; jwtConfig: JitsiJwtConfig }
  | { ok: false; status: number; error: string };

export const JAAS_DOMAIN = "8x8.vc";

/** Domains that cannot start Blyve embedded calls (moderated public embed). */
export const UNSUPPORTED_JITSI_DOMAINS = new Set(["meet.jit.si"]);

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlEncodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function normalizePem(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

export function isJaasDomain(domain: string): boolean {
  const normalized = domain.trim().toLowerCase();
  return normalized === JAAS_DOMAIN || normalized.endsWith(".8x8.vc");
}

/** JaaS room names must be `{appId}/{slug}` — slug stays server-generated (blyve_…). */
export function formatJitsiRoomName(
  roomSlug: string,
  jwtConfig: JitsiJwtConfig,
): string {
  const slug = roomSlug.trim();
  if (jwtConfig.mode === "jaas") {
    if (slug.startsWith(`${jwtConfig.appId}/`)) return slug;
    return `${jwtConfig.appId}/${slug}`;
  }
  return slug;
}

export function tryGetJitsiJwtConfig(): JitsiJwtConfig | null {
  const appId = Deno.env.get("JITSI_APP_ID")?.trim();
  if (!appId) return null;

  const domain = Deno.env.get("JITSI_DOMAIN")?.trim() ?? "";
  if (isJaasDomain(domain)) {
    const apiKeyId = Deno.env.get("JITSI_API_KEY_ID")?.trim();
    const privateKeyPem = normalizePem(
      Deno.env.get("JITSI_API_PRIVATE_KEY")?.trim() ??
        Deno.env.get("JITSI_APP_SECRET")?.trim() ??
        "",
    );
    if (!apiKeyId || !privateKeyPem.includes("BEGIN")) return null;
    return { mode: "jaas", appId, apiKeyId, privateKeyPem };
  }

  const appSecret = Deno.env.get("JITSI_APP_SECRET")?.trim();
  if (!appSecret) return null;
  return { mode: "self-hosted", appId, appSecret };
}

export function resolveJitsiProviderConfig(): JitsiProviderConfig {
  const rawDomain = Deno.env.get("JITSI_DOMAIN")?.trim();
  if (!rawDomain) {
    return {
      ok: false,
      status: 503,
      error:
        "Jitsi is not configured. Set JITSI_DOMAIN, JITSI_APP_ID, and JaaS API credentials in Supabase Edge secrets.",
    };
  }

  if (UNSUPPORTED_JITSI_DOMAINS.has(rawDomain.toLowerCase())) {
    return {
      ok: false,
      status: 503,
      error:
        "Public meet.jit.si is not supported for Blyve calls. Use 8x8 JaaS (JITSI_DOMAIN=8x8.vc) or a self-hosted Jitsi server.",
    };
  }

  const domain = isJaasDomain(rawDomain) ? JAAS_DOMAIN : rawDomain;
  const jwtConfig = tryGetJitsiJwtConfig();
  if (!jwtConfig) {
    if (isJaasDomain(rawDomain)) {
      return {
        ok: false,
        status: 503,
        error:
          "8x8 JaaS requires JITSI_APP_ID, JITSI_API_KEY_ID, and JITSI_API_PRIVATE_KEY in Supabase Edge secrets.",
      };
    }
    return {
      ok: false,
      status: 503,
      error:
        "Self-hosted Jitsi requires JITSI_APP_ID and JITSI_APP_SECRET (HS256) in Supabase Edge secrets.",
    };
  }

  return { ok: true, domain, jwtConfig };
}

async function importRsaPrivateKey(pem: string): Promise<CryptoKey> {
  const normalized = normalizePem(pem);
  const pemBody = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----BEGIN RSA PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/-----END RSA PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    binary,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function signJwtRs256(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKeyPem: string,
): Promise<string> {
  const encodedHeader = base64UrlEncodeJson(header);
  const encodedPayload = base64UrlEncodeJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await importRsaPrivateKey(privateKeyPem);
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(signingInput),
    ),
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

async function signJwtHs256(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const encodedHeader = base64UrlEncodeJson(header);
  const encodedPayload = base64UrlEncodeJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput)),
  );
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export async function mintJitsiJwt(
  input: MintJitsiJwtInput,
  config: JitsiJwtConfig,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = input.ttlSeconds ?? 2 * 60 * 60;
  const formattedRoom = formatJitsiRoomName(input.roomName, config);

  if (config.mode === "jaas") {
    // JaaS JWT spec (8x8 JaaS API Keys Authentication):
    //   iss  = "chat"  (fixed literal — NOT the appId)
    //   sub  = appId   (tenant identifier)
    //   kid  = "{appId}/{apiKeyId}"
    // Guard against JITSI_API_KEY_ID already containing the "appId/" prefix, which
    // would cause a double-prefix and the "could not obtain public key" auth error.
    const rawKeyId = config.apiKeyId.startsWith(`${config.appId}/`)
      ? config.apiKeyId.slice(config.appId.length + 1)
      : config.apiKeyId;
    const jaasKid = `${config.appId}/${rawKeyId}`;
    const payload: Record<string, unknown> = {
      aud: "jitsi",
      iss: "chat",
      sub: config.appId,
      // Wildcard room claim — JaaS validates tenant via `sub`; exact MUC names vary internally.
      room: "*",
      iat: now,
      nbf: now - 10,
      exp: now + ttl,
      context: {
        user: {
          id: input.userId,
          name: input.displayName,
          ...(input.email ? { email: input.email } : {}),
          // JaaS expects string literals, not booleans (see 8x8 JWT docs).
          moderator: input.isModerator ? "true" : "false",
        },
        features: {
          livestreaming: "false",
          recording: "false",
          transcription: "false",
          "outbound-call": "false",
          "screen-sharing": "true",
        },
        room: { regex: false },
      },
    };

    console.log("[jitsi-jwt] JaaS mint diagnostic", {
      domain: input.domain,
      kid: jaasKid,
      iss: "chat",
      sub: config.appId,
      room: formattedRoom,
      rawRoom: input.roomName,
    });

    return signJwtRs256(
      { alg: "RS256", typ: "JWT", kid: jaasKid },
      payload,
      config.privateKeyPem,
    );
  }

  const payload: Record<string, unknown> = {
    aud: "jitsi",
    iss: config.appId,
    sub: input.domain,
    room: formattedRoom,
    iat: now,
    nbf: now - 10,
    exp: now + ttl,
    context: {
      user: {
        id: input.userId,
        name: input.displayName,
        ...(input.email ? { email: input.email } : {}),
      },
    },
  };
  if (input.isModerator) {
    payload.moderator = true;
  }

  console.log("[jitsi-jwt] self-hosted mint diagnostic", {
    domain: input.domain,
    iss: config.appId,
    sub: input.domain,
    room: formattedRoom,
  });

  return signJwtHs256({ alg: "HS256", typ: "JWT" }, payload, config.appSecret);
}

export function jitsiAppIdFromConfig(jwtConfig: JitsiJwtConfig): string | undefined {
  return jwtConfig.mode === "jaas" ? jwtConfig.appId : undefined;
}
