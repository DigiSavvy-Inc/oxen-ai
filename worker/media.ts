import { hmacSign, timingSafeEqual } from "./crypto";

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

export async function createSignedMediaUrl(
  baseUrl: string,
  key: string,
  secret: string,
  ttlSeconds = 3600,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${key}:${exp}`;
  const sig = await hmacSign(secret, payload);
  const url = new URL(`/api/media/${key}`, baseUrl);
  url.searchParams.set("exp", String(exp));
  url.searchParams.set("sig", sig);
  return url.toString();
}

export async function verifyMediaSignature(
  key: string,
  exp: string,
  sig: string,
  secret: string,
): Promise<boolean> {
  const expires = Number(exp);
  if (!expires || expires < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacSign(secret, `${key}:${exp}`);
  return timingSafeEqual(expected, sig);
}

export function arrayBufferToDataUri(buffer: ArrayBuffer, contentType: string): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:${contentType};base64,${btoa(binary)}`;
}
