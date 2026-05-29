// @ts-ignore - Deno npm: imports are valid at runtime
import { HeadObjectCommand, PutObjectCommand, S3Client } from "npm:@aws-sdk/client-s3@3.700.0";
// @ts-ignore - Deno npm: imports are valid at runtime
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3.700.0";

export type AttachmentKind = "image" | "gif" | "video" | "audio" | "file";

export interface R2Config {
  accountId: string;
  bucketName: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string | null;
}

const PRESIGN_EXPIRES_SEC = 900;

const MAX_BYTES: Record<AttachmentKind, number> = {
  image: 10 * 1024 * 1024,
  gif: 15 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  file: 50 * 1024 * 1024,
};

const ALLOWED_MIME: Record<AttachmentKind, string[]> = {
  image: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
  gif: ["image/gif"],
  video: ["video/mp4", "video/webm", "video/quicktime"],
  audio: [
    "audio/webm",
    "audio/ogg",
    "audio/mpeg",
    "audio/mp4",
    "audio/wav",
    "audio/x-m4a",
  ],
  file: [
    "application/pdf",
    "text/plain",
    "application/zip",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
};

export function getR2Config(): R2Config | null {
  const accountId = Deno.env.get("R2_ACCOUNT_ID")?.trim();
  const bucketName = Deno.env.get("R2_BUCKET_NAME")?.trim() || "blyve";
  const endpoint = Deno.env.get("R2_ENDPOINT")?.trim();
  const accessKeyId = Deno.env.get("R2_ACCESS_KEY_ID")?.trim();
  const secretAccessKey = Deno.env.get("R2_SECRET_ACCESS_KEY")?.trim();
  const publicBaseUrl = Deno.env.get("R2_PUBLIC_BASE_URL")?.trim() || null;

  if (!accountId || !endpoint || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return {
    accountId,
    bucketName,
    endpoint,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl,
  };
}

export function inferAttachmentKind(mimeType: string): AttachmentKind | null {
  const mime = mimeType.toLowerCase().split(";")[0].trim();
  if (mime === "image/gif") return "gif";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  for (const kind of ["image", "gif", "video", "audio", "file"] as AttachmentKind[]) {
    if (ALLOWED_MIME[kind].includes(mime)) return kind;
  }
  return null;
}

export function validateUploadRequest(
  mimeType: string,
  sizeBytes: number,
): { ok: true; kind: AttachmentKind } | { ok: false; error: string } {
  const kind = inferAttachmentKind(mimeType);
  if (!kind) {
    return { ok: false, error: "Unsupported file type" };
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { ok: false, error: "Invalid file size" };
  }
  if (sizeBytes > MAX_BYTES[kind]) {
    return { ok: false, error: `File too large for ${kind}` };
  }
  return { ok: true, kind };
}

function createS3Client(config: R2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  });
}

export function buildStorageKey(userId: string, ext: string): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `chat/${userId}/${crypto.randomUUID()}.${safeExt}`;
}

export function extensionFromMime(mimeType: string): string {
  const mime = mimeType.toLowerCase().split(";")[0].trim();
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
    "image/heif": "heif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
    "audio/x-m4a": "m4a",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "application/zip": "zip",
  };
  return map[mime] || "bin";
}

export function buildPublicUrl(config: R2Config, storageKey: string): string | null {
  if (!config.publicBaseUrl) return null;
  const base = config.publicBaseUrl.replace(/\/+$/, "");
  return `${base}/${storageKey}`;
}

export async function createPresignedPutUrl(
  config: R2Config,
  storageKey: string,
  mimeType: string,
  sizeBytes: number,
): Promise<{ uploadUrl: string; expiresIn: number }> {
  const client = createS3Client(config);
  const command = new PutObjectCommand({
    Bucket: config.bucketName,
    Key: storageKey,
    ContentType: mimeType,
    ContentLength: sizeBytes,
  });
  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: PRESIGN_EXPIRES_SEC,
  });
  return { uploadUrl, expiresIn: PRESIGN_EXPIRES_SEC };
}

export async function objectExistsInR2(
  config: R2Config,
  storageKey: string,
): Promise<boolean> {
  const client = createS3Client(config);
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: config.bucketName,
        Key: storageKey,
      }),
    );
    return true;
  } catch {
    return false;
  }
}
