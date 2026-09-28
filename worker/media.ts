import { hmacSign, timingSafeEqual } from "./crypto";

/** Long enough for queued video jobs; signed URLs are hours, not minutes. */
export const MEDIA_URL_TTL_SECONDS = 12 * 60 * 60;
/** Keep `exp`/`sig` stable within this window so the browser can cache thumbs. */
export const MEDIA_URL_STABLE_WINDOW_SECONDS = 60 * 60;

export function signedMediaExpiry(
  nowSeconds = Math.floor(Date.now() / 1000),
  ttlSeconds = MEDIA_URL_TTL_SECONDS,
): number {
  if (ttlSeconds <= 0) return nowSeconds + ttlSeconds;
  return Math.floor(nowSeconds / MEDIA_URL_STABLE_WINDOW_SECONDS) * MEDIA_URL_STABLE_WINDOW_SECONDS + ttlSeconds;
}

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
  if (contentType.includes("avif")) return ".avif";
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
  const exp = signedMediaExpiry(Math.floor(Date.now() / 1000), ttlSeconds);
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
  return `data:${contentType};base64,${Buffer.from(buffer).toString("base64")}`;
}

const SAFE_MEDIA_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-matroska",
  "audio/mpeg",
  "audio/wav",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
]);

/** Image, video, and audio types Studio will show inline. SVG and HTML are not included. */
export function canonicalSafeMediaType(contentType: string | null | undefined): string | null {
  if (!contentType) return null;
  const raw = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  let type = raw;
  if (raw === "image/jpg" || raw === "image/pjpeg") type = "image/jpeg";
  else if (raw === "audio/wave" || raw === "audio/x-wav") type = "audio/wav";
  else if (raw === "audio/x-flac") type = "audio/flac";
  else if (raw === "audio/mp3" || raw === "audio/x-mpeg") type = "audio/mpeg";
  else if (raw === "audio/x-m4a" || raw === "audio/m4a") type = "audio/mp4";
  else if (raw === "video/m4v" || raw === "video/x-m4v") type = "video/mp4";
  else if (raw === "video/mov") type = "video/quicktime";
  return SAFE_MEDIA_TYPES.has(type) ? type : null;
}

function bytesMatch(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

function fourCC(bytes: Uint8Array, offset: number): string {
  if (bytes.length < offset + 4) return "";
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

/**
 * Identify a safe image, video, or audio payload from magic bytes.
 * Declared Content-Type is ignored so HTML or SVG cannot pretend to be media.
 */
export function sniffSafeMediaType(bytes: Uint8Array): string | null {
  if (bytesMatch(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (bytesMatch(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (
    bytesMatch(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    bytesMatch(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return "image/gif";
  }
  if (bytesMatch(bytes, [0x42, 0x4d])) return "image/bmp";
  if (fourCC(bytes, 0) === "RIFF") {
    const kind = fourCC(bytes, 8);
    if (kind === "WEBP") return "image/webp";
    if (kind === "WAVE") return "audio/wav";
    return null;
  }
  if (fourCC(bytes, 4) === "ftyp") {
    const brand = fourCC(bytes, 8).trim().toLowerCase();
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (brand === "qt") return "video/quicktime";
    if (
      brand === "m4a" ||
      brand === "m4b" ||
      brand === "m4p" ||
      brand === "mp4a" ||
      brand === "f4a" ||
      brand === "f4b"
    ) {
      return "audio/mp4";
    }
    if (
      brand === "mp41" ||
      brand === "mp42" ||
      brand === "isom" ||
      brand === "iso2" ||
      brand === "iso4" ||
      brand === "iso5" ||
      brand === "iso6" ||
      brand === "m4v" ||
      brand === "dash" ||
      brand === "avc1" ||
      brand === "mp4v"
    ) {
      return "video/mp4";
    }
    return null;
  }
  if (bytesMatch(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    const n = Math.min(bytes.length, 256);
    let head = "";
    for (let i = 0; i < n; i++) head += String.fromCharCode(bytes[i] ?? 0);
    if (head.includes("matroska")) return "video/x-matroska";
    return "video/webm";
  }
  if (bytesMatch(bytes, [0x4f, 0x67, 0x67, 0x53])) return "audio/ogg";
  if (bytesMatch(bytes, [0x66, 0x4c, 0x61, 0x43])) return "audio/flac";
  if (bytesMatch(bytes, [0x49, 0x44, 0x33])) return "audio/mpeg";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    const layer = (bytes[1] >> 1) & 0x03;
    if (layer === 0) return "audio/aac";
    return "audio/mpeg";
  }
  return null;
}

export function mediaServeDisposition(storedContentType: string | null | undefined): {
  contentType: string;
  disposition: "inline" | "attachment";
} {
  const safe = canonicalSafeMediaType(storedContentType);
  if (safe) return { contentType: safe, disposition: "inline" };
  return { contentType: "application/octet-stream", disposition: "attachment" };
}

export function guessMediaContentType(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".avif")) return "image/avif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  return "application/octet-stream";
}

export async function displayStoredMediaUrl(
  env: { PUBLIC_BASE_URL?: string; ENCRYPTION_KEY: string; SESSION_SECRET: string; MEDIA: R2Bucket },
  key: string | null | undefined,
  fallback: string | null,
): Promise<string | null> {
  if (!key) return fallback;
  const origin = resolvePublicBaseUrl(env.PUBLIC_BASE_URL);
  if (origin) {
    return createSignedMediaUrl(origin, key, env.ENCRYPTION_KEY || env.SESSION_SECRET);
  }
  const object = await env.MEDIA.get(key);
  if (!object) return fallback;
  const bytes = await object.arrayBuffer();
  const contentType = object.httpMetadata?.contentType || "application/octet-stream";
  return arrayBufferToDataUri(bytes, contentType);
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
