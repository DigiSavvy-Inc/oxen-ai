import { galleryKeyForUser } from "./galleries";
import {
  arrayBufferToDataUri,
  createSignedMediaUrl,
  guessMediaContentType,
  resolvePublicBaseUrl,
  verifyMediaSignature,
} from "./media";
import { encodeImageForOxen } from "./thumbs";

const MEDIA_PATH_PREFIX = "/api/media/";

/** Raw bytes we will base64-inline so Oxen does not have to GET Studio. */
export const OXEN_INLINE_MEDIA_MAX_BYTES = 12 * 1024 * 1024;

export function isOxenHostedMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "hub.oxen.ai";
  } catch {
    return false;
  }
}

export class StudioMediaRefRejected extends Error {
  constructor() {
    super("Media reference must be your own unexpired signed file");
    this.name = "StudioMediaRefRejected";
  }
}

export type StudioMediaAuth = {
  userId: string;
  secret: string;
};

function studioMediaUrl(value: string): URL | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("data:")) return null;
  try {
    const url =
      trimmed.startsWith("http://") || trimmed.startsWith("https://")
        ? new URL(trimmed)
        : new URL(trimmed, "https://studio.digisavvy.dev");
    if (!url.pathname.startsWith(MEDIA_PATH_PREFIX)) return null;
    return url;
  } catch {
    return null;
  }
}

export function studioMediaKeyFromUrl(value: string): string | null {
  const url = studioMediaUrl(value);
  if (!url) return null;
  let key = "";
  try {
    key = decodeURIComponent(url.pathname.slice(MEDIA_PATH_PREFIX.length));
  } catch {
    return null;
  }
  if (!key || key.includes("..")) return null;
  return key;
}

/** Studio media inputs must be an unexpired signature for this user's own key. */
export async function assertAuthorizedStudioMediaUrl(
  url: string,
  auth: StudioMediaAuth | null | undefined,
): Promise<void> {
  const key = studioMediaKeyFromUrl(url);
  if (!key) return;
  const parsed = studioMediaUrl(url);
  const exp = parsed?.searchParams.get("exp") ?? "";
  const sig = parsed?.searchParams.get("sig") ?? "";
  if (!auth?.secret || !galleryKeyForUser(auth.userId, key) || !exp || !sig) {
    throw new StudioMediaRefRejected();
  }
  const ok = await verifyMediaSignature(key, exp, sig, auth.secret);
  if (!ok) throw new StudioMediaRefRejected();
}

export async function oxenSourceUrlForMediaKey(
  db: D1Database,
  userId: string,
  key: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT result_url FROM generations
       WHERE user_id = ? AND (result_key = ? OR thumb_key = ?)
       LIMIT 1`,
    )
    .bind(userId, key, key)
    .first<{ result_url: string | null }>();
  const url = row?.result_url?.trim() ?? "";
  return isOxenHostedMediaUrl(url) ? url : null;
}

export async function rewriteRefsToOxenSources(
  db: D1Database,
  userId: string,
  urls: string[],
): Promise<string[]> {
  const out: string[] = [];
  for (const url of urls) {
    if (isOxenHostedMediaUrl(url)) {
      out.push(url);
      continue;
    }
    const key = studioMediaKeyFromUrl(url);
    if (!key) {
      out.push(url);
      continue;
    }
    const source = await oxenSourceUrlForMediaKey(db, userId, key);
    out.push(source ?? url);
  }
  return out;
}

export async function inlineStudioMediaRefs(
  bucket: R2Bucket,
  urls: string[],
  options?: {
    maxBytes?: number;
    images?: ImagesBinding;
    keepHttps?: boolean[];
    auth?: StudioMediaAuth;
  },
): Promise<string[]> {
  const maxBytes = options?.maxBytes ?? OXEN_INLINE_MEDIA_MAX_BYTES;
  const out: string[] = [];
  for (const [index, url] of urls.entries()) {
    await assertAuthorizedStudioMediaUrl(url, options?.auth);
    // Seedance face upload rejects data: URIs (`unsupported_url_scheme`).
    if (options?.keepHttps?.[index]) {
      out.push(url);
      continue;
    }
    if (url.startsWith("data:") || isOxenHostedMediaUrl(url)) {
      out.push(url);
      continue;
    }
    const key = studioMediaKeyFromUrl(url);
    if (!key) {
      out.push(url);
      continue;
    }
    const object = await bucket.get(key);
    if (!object) {
      out.push(url);
      continue;
    }
    if (object.size > maxBytes) {
      out.push(url);
      continue;
    }
    const raw = await object.arrayBuffer();
    const sourceType = object.httpMetadata?.contentType || guessMediaContentType(key);
    const encoded = await encodeImageForOxen(options?.images, raw, sourceType);
    out.push(arrayBufferToDataUri(encoded.bytes, encoded.contentType));
  }
  return out;
}

async function freshStudioHttps(
  url: string,
  signing?: { publicBaseUrl?: string | null; secret: string },
): Promise<string> {
  if (!signing?.secret) return url;
  const key = studioMediaKeyFromUrl(url);
  if (!key) return url;
  const origin = resolvePublicBaseUrl(signing.publicBaseUrl);
  if (!origin) return url;
  return createSignedMediaUrl(origin, key, signing.secret);
}

export async function resolveRefsForOxen(
  bucket: R2Bucket,
  urls: string[],
  images?: ImagesBinding,
  keepHttps?: boolean[],
  signing?: { publicBaseUrl?: string | null; secret: string; userId: string },
): Promise<string[]> {
  const auth: StudioMediaAuth | undefined =
    signing?.secret && signing.userId
      ? { userId: signing.userId, secret: signing.secret }
      : undefined;
  // Face slots must stay https — Seedance rejects data URIs — but hub.oxen.ai
  // file URLs time out in ByteDance CreateAsset. Keep a Studio signed URL.
  // Everything else is inlined from R2 so the provider does not download hub.
  // A Studio key is read or re-signed only after its signature and owner check.
  const prepared = await Promise.all(
    urls.map(async (url, index) => {
      if (!keepHttps?.[index]) return url;
      if (!studioMediaKeyFromUrl(url)) return url;
      await assertAuthorizedStudioMediaUrl(url, auth);
      return freshStudioHttps(url, signing);
    }),
  );
  return inlineStudioMediaRefs(bucket, prepared, { images, keepHttps, auth });
}

export type OxenRefGroup = {
  urls: string[];
  roles?: ("character" | "scene")[];
  face?: boolean;
};

/** Pair each ref with whether Seedance must fetch it over https. */
export function collectOxenRefs(groups: OxenRefGroup[]): { urls: string[]; keepHttps: boolean[] } {
  const urls: string[] = [];
  const keepHttps: boolean[] = [];
  for (const group of groups) {
    group.urls.forEach((raw, index) => {
      const url = raw.trim();
      if (!url) return;
      urls.push(url);
      const face = group.roles
        ? Boolean(group.face) && group.roles[index] !== "scene"
        : Boolean(group.face);
      keepHttps.push(face);
    });
  }
  return { urls, keepHttps };
}
