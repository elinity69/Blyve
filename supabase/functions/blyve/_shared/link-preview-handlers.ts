// @ts-ignore - Deno npm: imports are valid at runtime
import type { Context } from "npm:hono";

const MAX_HTML_BYTES = 512_000;
const FETCH_TIMEOUT_MS = 8000;

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    host.startsWith("172.16.") ||
    host.startsWith("169.254.")
  ) {
    return true;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const parts = host.split(".").map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 127) return true;
  }
  return false;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function readMetaContent(html: string, key: string): string | undefined {
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`,
      "i"
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,
      "i"
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtmlEntities(match[1].trim());
  }
  return undefined;
}

function readTitleTag(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1] ? decodeHtmlEntities(match[1].trim()) : undefined;
}

function resolveAbsoluteUrl(base: string, maybeRelative?: string): string | undefined {
  if (!maybeRelative) return undefined;
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return undefined;
  }
}

export async function handleLinkPreview(c: Context) {
  try {
    const rawUrl = c.req.query("url");
    if (!rawUrl) {
      return c.json({ error: "Missing url parameter" }, 400);
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return c.json({ error: "Invalid url" }, 400);
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return c.json({ error: "Unsupported protocol" }, 400);
    }

    if (isBlockedHost(parsed.hostname)) {
      return c.json({ error: "Blocked host" }, 403);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent": "BlyveLinkPreview/1.0 (+https://blyve.app)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return c.json({ error: "Failed to fetch url" }, 502);
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.startsWith("image/")) {
      return c.json({
        preview: {
          url: parsed.toString(),
          title: parsed.hostname,
          image: parsed.toString(),
          siteName: parsed.hostname.replace(/^www\./, ""),
        },
      });
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return c.json({ error: "Empty response" }, 502);
    }

    let html = "";
    let totalBytes = 0;
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_HTML_BYTES) break;
      html += decoder.decode(value, { stream: true });
    }

    const title =
      readMetaContent(html, "og:title") ||
      readMetaContent(html, "twitter:title") ||
      readTitleTag(html);
    const description =
      readMetaContent(html, "og:description") ||
      readMetaContent(html, "twitter:description") ||
      readMetaContent(html, "description");
    const image = resolveAbsoluteUrl(
      parsed.toString(),
      readMetaContent(html, "og:image") || readMetaContent(html, "twitter:image")
    );
    const siteName =
      readMetaContent(html, "og:site_name") ||
      parsed.hostname.replace(/^www\./, "");

    return c.json({
      preview: {
        url: parsed.toString(),
        title,
        description,
        image,
        siteName,
      },
    });
  } catch (error) {
    console.error("Link preview failed:", error);
    return c.json({ error: "Link preview failed" }, 500);
  }
}
