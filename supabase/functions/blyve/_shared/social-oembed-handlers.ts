// @ts-ignore - Deno npm: imports are valid at runtime
import type { Context } from "npm:hono";

const FETCH_TIMEOUT_MS = 6000;

type Provider = "instagram" | "tiktok" | "x";

interface OEmbedEndpoint {
  url: (postUrl: string) => string;
  /** Extra static query params to always include */
  extraParams?: Record<string, string>;
}

const PROVIDERS: Record<Provider, OEmbedEndpoint> = {
  instagram: {
    url: (postUrl) => {
      const q = new URLSearchParams({
        url: postUrl,
        omitscript: "true",
        fields: "author_name,thumbnail_url,title",
      });
      return `https://api.instagram.com/oembed?${q}`;
    },
  },
  tiktok: {
    url: (postUrl) => {
      const q = new URLSearchParams({ url: postUrl });
      return `https://www.tiktok.com/oembed?${q}`;
    },
  },
  x: {
    url: (postUrl) => {
      const q = new URLSearchParams({
        url: postUrl,
        omit_script: "true",
        dnt: "true",
        theme: "dark",
      });
      return `https://publish.twitter.com/oembed?${q}`;
    },
  },
};

/** Allowed origin domains per provider — server-side allowlist. */
const ALLOWED_ORIGINS: Record<Provider, RegExp> = {
  instagram: /^(?:www\.)?instagram\.com$/i,
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

/**
 * GET /social-oembed?provider=instagram|tiktok|x&url=<encoded>
 *
 * Proxies oEmbed requests server-side so the browser never needs to reach
 * third-party oEmbed endpoints directly (all three are CORS-restricted from
 * browser origins).
 *
 * Returns { ok: true, data: <oEmbedPayload> } on success.
 * Returns { ok: false } on any failure so the client falls back gracefully.
 *
 * This route intentionally bypasses auth (same as /link-preview) because
 * it only forwards public metadata — no user data is involved.
 */
export async function handleSocialOEmbed(c: Context) {
  const provider = c.req.query("provider") as Provider | undefined;
  const rawUrl = c.req.query("url");

  if (!provider || !(provider in PROVIDERS)) {
    return c.json({ ok: false, error: "Invalid provider" }, 400);
  }
  if (!rawUrl) {
    return c.json({ ok: false, error: "Missing url" }, 400);
  }
  if (!isAllowedUrl(provider, rawUrl)) {
    return c.json({ ok: false, error: "URL not allowed for this provider" }, 400);
  }

  const endpoint = PROVIDERS[provider].url(rawUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        "User-Agent": "BlyveEmbedProxy/1.0 (+https://blyve.app)",
        Accept: "application/json",
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return c.json({ ok: false, status: res.status }, 200);
    }

    const data = await res.json();
    return c.json({ ok: true, data });
  } catch (err) {
    console.error(`social-oembed [${provider}] failed:`, err);
    return c.json({ ok: false, error: "Fetch failed" }, 200);
  } finally {
    clearTimeout(timeout);
  }
}
