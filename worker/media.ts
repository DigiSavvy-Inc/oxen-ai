import { hmacSign, timingSafeEqual } from "./crypto";

/** Long enough for queued video jobs; signed URLs are hours, not minutes. */
export const MEDIA_URL_TTL_SECONDS = 12 * 60 * 60;

export async function putMediaObject(
  bucket: R2Bucket,
  bytes: ArrayBuffer,
  contentType: string,
  prefix = "uploads",
): Promise<{ key: string; contentType: string }> {
  const ext = extensionFor(contentType);
  const key = `${prefix}/${crypto.randomUUID()}${ext}`;
  await bucket.put(key, bytes, {
    httpMetadata: { contentType },
  });
  return { key, contentType };
}

function extensionFor(contentType: string): string {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("gif")) return ".gif";
  if (contentType.includes("mp4")) return ".mp4";
  if (contentType.includes("webm")) return ".webm";
  if (contentType.includes("quicktime")) return ".mov";
  return "";
}

/**
 * Production origin Oxen can GET. Empty / unset → local data-URI fallback.
 * Trailing slashes are stripped; http and protocol-relative values become https.
 */
export function resolvePublicBaseUrl(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const stripped = trimmed.replace(/\/+$/, "");
  if (stripped.startsWith("https://")) return stripped;
  if (stripped.startsWith("http://")) {
    return `https://${stripped.slice("http://".length)}`;
  }
  return `https://${stripped}`;
}

export async function createSignedMediaUrl(
  baseUrl: string,
  key: string,
  secret: string,
  ttlSeconds = MEDIA_URL_TTL_SECONDS,
): Promise<string> {
  const origin = resolvePublicBaseUrl(baseUrl);
  if (!origin) {
    throw new Error("signed media URLs require PUBLIC_BASE_URL");
  }
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${key}:${exp}`;
  const sig = await hmacSign(secret, payload);
  const url = new URL(`/api/media/${key}`, `${origin}/`);
  url.searchParams.set("exp", String(exp));
  url.searchParams.set("sig", sig);
  if (url.protocol !== "https:") {
    throw new Error("signed media URLs must be https so Oxen can fetch them");
  }
  return url.toString();
}

export async function verifyMediaSignature(
  key: string,
  exp: string,
  sig: string,
  secret: string,
): Promise<boolean> {
  if (!key || !exp || !sig || !secret) return false;
  const expires = Number(exp);
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacSign(secret, `${key}:${exp}`);
  return timingSafeEqual(expected, sig);
}

export function arrayBufferToDataUri(buffer: ArrayBuffer, contentType: string): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:${contentType};base64,${btoa(binary)}`;
}

export async function buildReferenceMediaUrl(options: {
  publicBaseUrl?: string | null;
  key: string;
  secret: string;
  bytes: ArrayBuffer;
  contentType: string;
  ttlSeconds?: number;
}): Promise<{ url: string; kind: "signed" | "data-uri" }> {
  const origin = resolvePublicBaseUrl(options.publicBaseUrl);
  if (!origin) {
    return {
      url: arrayBufferToDataUri(options.bytes, options.contentType),
      kind: "data-uri",
    };
  }
  return {
    url: await createSignedMediaUrl(
      origin,
      options.key,
      options.secret,
      options.ttlSeconds ?? MEDIA_URL_TTL_SECONDS,
    ),
    kind: "signed",
  };
}
