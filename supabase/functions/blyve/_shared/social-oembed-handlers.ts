// @ts-ignore - Deno npm: imports are valid at runtime
import type { Context } from "npm:hono";

const FETCH_TIMEOUT_MS = 6000;

type Provider = "instagram" | "tiktok" | "x";

/** Allowed origin domains per provider — server-side allowlist. */
const ALLOWED_ORIGINS: Record<Provider, RegExp> = {
  // l.instagram.com is the iOS share-link redirector; the probe resolves it to instagram.com
  instagram: /^(?:(?:www\.|l\.)?instagram\.com|instagr\.am)$/i,
  tiktok: /^(?:www\.)?tiktok\.com$/i,
  x: /^(?:(?:www\.)?(?:x|twitter)\.com|mobile\.twitter\.com)$/i,
};

function isAllowedUrl(provider: Provider, rawUrl: string): boolean {
  try {
    const { hostname } = new URL(rawUrl);
    return ALLOWED_ORIGINS[provider].test(hostname);
  } catch {
    return false;
  }
}

// ─── Provider-specific probe strategies ────────────────────────────────────────

/**
 * Instagram: api.instagram.com/oembed requires a Facebook App token since 2020
 * and is effectively dead for unauthenticated use. Instead we do a lightweight
 * HEAD request to the embed iframe URL itself — if Instagram returns 200, the
 * post is public and embeddable; 4xx means private/unavailable.
 */
async function probeInstagram(postUrl: string, signal: AbortSignal): Promise<boolean> {
  try {
    // Resolve iOS l.instagram.com share links to canonical instagram.com URL
    let resolvedUrl = postUrl;
    try {
      const parsed = new URL(postUrl);
      if (parsed.hostname === "l.instagram.com") {
        const inner = parsed.searchParams.get("u");
        if (inner) resolvedUrl = inner;
      }
    } catch { /* use original */ }

    // Extract shortcode from the (possibly resolved) post URL
    const match = new URL(resolvedUrl).pathname.match(/^\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    if (!match?.[2]) return false;
    const shortcode = match[2];
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/`;
    const res = await fetch(embedUrl, {
      method: "HEAD",
      signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; BlyveBot/1.0; +https://blyve.app)",
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * TikTok: public oEmbed endpoint works without auth, CORS-enabled from Deno.
 */
async function probeTikTok(
  postUrl: string,
  signal: AbortSignal,
): Promise<Record<string, unknown> | null> {
  try {
    const q = new URLSearchParams({ url: postUrl });
    const res = await fetch(`https://www.tiktok.com/oembed?${q}`, {
      signal,
      headers: {
        "User-Agent": "BlyveEmbedProxy/1.0 (+https://blyve.app)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * X/Twitter: publish.twitter.com/oembed is public and works without auth.
 */
async function probeX(
  postUrl: string,
  signal: AbortSignal,
): Promise<Record<string, unknown> | null> {
  try {
    const q = new URLSearchParams({
      url: postUrl,
      omit_script: "true",
      dnt: "true",
      theme: "dark",
    });
    const res = await fetch(`https://publish.twitter.com/oembed?${q}`, {
      signal,
      headers: {
        "User-Agent": "BlyveEmbedProxy/1.0 (+https://blyve.app)",
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * GET /social-oembed?provider=instagram|tiktok|x&url=<encoded>
 *
 * Probes whether the given social URL is publicly embeddable.
 * Returns { ok: true, data: {...} } on success, { ok: false } on failure.
 * The client renders the embed iframe on ok:true and falls back to a link
 * card on ok:false.
 *
 * This route intentionally bypasses auth — it only probes public metadata.
 */
export async function handleSocialOEmbed(c: Context) {
  const provider = c.req.query("provider") as Provider | undefined;
  const rawUrl = c.req.query("url");

  if (!provider || !["instagram", "tiktok", "x"].includes(provider)) {
    return c.json({ ok: false, error: "Invalid provider" }, 400);
  }
  if (!rawUrl) {
    return c.json({ ok: false, error: "Missing url" }, 400);
  }
  if (!isAllowedUrl(provider, rawUrl)) {
    return c.json({ ok: false, error: "URL not allowed for this provider" }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    if (provider === "instagram") {
      const embeddable = await probeInstagram(rawUrl, controller.signal);
      return c.json(
        embeddable
          ? { ok: true, data: { embeddable: true } }
          : { ok: false, reason: "not_embeddable" },
      );
    }

    if (provider === "tiktok") {
      const data = await probeTikTok(rawUrl, controller.signal);
      return c.json(data ? { ok: true, data } : { ok: false, reason: "not_embeddable" });
    }

    if (provider === "x") {
      const data = await probeX(rawUrl, controller.signal);
      return c.json(data ? { ok: true, data } : { ok: false, reason: "not_embeddable" });
    }

    return c.json({ ok: false, error: "Unhandled provider" }, 400);
  } catch (err) {
    console.error(`social-oembed [${provider}] failed:`, err);
    return c.json({ ok: false, error: "Probe failed" }, 200);
  } finally {
    clearTimeout(timeout);
  }
}

