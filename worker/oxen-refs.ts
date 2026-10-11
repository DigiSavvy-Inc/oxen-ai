import { galleryKeyForUser } from "./galleries";
import {
  arrayBufferToDataUri,
  canonicalSafeMediaType,
  createSignedMediaUrl,
  guessMediaContentType,
  putMediaObject,
  resolvePublicBaseUrl,
  sniffSafeMediaType,
  verifyMediaSignature,
} from "./media";
import { downloadOxenResult } from "./oxen";
import { encodeImageForOxen } from "./thumbs";

const MEDIA_PATH_PREFIX = "/api/media/";

/** Raw bytes we will base64-inline so Oxen does not have to GET Studio. */
export const OXEN_INLINE_MEDIA_MAX_BYTES = 12 * 1024 * 1024;

/** Face refs stay https, so a hub-only file can be copied into R2 up to the upload cap. */
const HUB_HTTPS_COPY_MAX_BYTES = 80 * 1024 * 1024;

const HUB_FETCH_FAIL =
  "Could not download the reference file from Oxen. It was not sent to the model.";
const HUB_FETCH_TIMEOUT =
  "Timed out downloading the reference file from Oxen. It was not sent to the model.";
const HUB_TOO_LARGE = "The reference file is too large to send to the model.";
const HUB_UNSAFE = "The Oxen file is not a supported image, video, or audio file.";
const FACE_COPY_FAIL =
  "Could not copy the face reference onto Studio. A hub file URL was not sent to the model.";

export class OxenMediaInlineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OxenMediaInlineError";
  }
}

export type HubMediaBytes = { bytes: ArrayBuffer; contentType: string };

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
  /** Extra keys to accept while old signatures age out; see mediaVerifySecrets. */
  verifySecrets?: string[];
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
  const ok = await verifyMediaSignature(key, exp, sig, auth.verifySecrets ?? auth.secret);
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

export type InlineStudioMediaOptions = {
  maxBytes?: number;
  images?: ImagesBinding;
  keepHttps?: boolean[];
  auth?: StudioMediaAuth;
  apiKey?: string;
  db?: D1Database;
  publicBaseUrl?: string | null;
  /** Test hook. Production downloads with the user's Oxen key, and only on hub.oxen.ai. */
  fetchHub?: (apiKey: string, url: string) => Promise<HubMediaBytes>;
};

function hubUrlPath(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "hub.oxen.ai") return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function mediaTypeForBytes(bytes: ArrayBuffer, claimed: string): string {
  const sniffed = sniffSafeMediaType(new Uint8Array(bytes));
  if (sniffed) return sniffed;
  const safe = canonicalSafeMediaType(claimed);
  if (safe) return safe;
  throw new OxenMediaInlineError(HUB_UNSAFE);
}

function hubFailure(err: unknown): OxenMediaInlineError {
  if (err instanceof OxenMediaInlineError) return err;
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : "";
  const timedOut =
    name === "TimeoutError" || name === "AbortError" || /timeout|aborted/i.test(message);
  return new OxenMediaInlineError(timedOut ? HUB_FETCH_TIMEOUT : HUB_FETCH_FAIL);
}

/** Studio archive of a hub file, matched with or without the signed query string. */
async function studioKeyForHubUrl(
  db: D1Database,
  userId: string,
  hubUrl: string,
): Promise<string | null> {
  const path = hubUrlPath(hubUrl);
  if (!path) return null;
  const row = await db
    .prepare(
      `SELECT result_key FROM generations
       WHERE user_id = ? AND result_key IS NOT NULL AND result_key != ''
         AND (
           result_url = ?
           OR CASE
             WHEN instr(result_url, '?') > 0 THEN substr(result_url, 1, instr(result_url, '?') - 1)
             ELSE result_url
           END = ?
         )
       LIMIT 1`,
    )
    .bind(userId, hubUrl, path)
    .first<{ result_key: string | null }>();
  const key = row?.result_key?.trim() ?? "";
  if (!key || !galleryKeyForUser(userId, key)) return null;
  return key;
}

async function downloadHubFile(
  url: string,
  options: InlineStudioMediaOptions,
  maxBytes: number,
): Promise<HubMediaBytes> {
  if (!options.apiKey) throw new OxenMediaInlineError(HUB_FETCH_FAIL);
  const fetchHub =
    options.fetchHub ?? ((apiKey: string, target: string) => downloadOxenResult(apiKey, target));
  let downloaded: HubMediaBytes;
  try {
    downloaded = await fetchHub(options.apiKey, url);
  } catch (err) {
    throw hubFailure(err);
  }
  if (downloaded.bytes.byteLength === 0) throw new OxenMediaInlineError(HUB_FETCH_FAIL);
  if (downloaded.bytes.byteLength > maxBytes) throw new OxenMediaInlineError(HUB_TOO_LARGE);
  return {
    bytes: downloaded.bytes,
    contentType: mediaTypeForBytes(downloaded.bytes, downloaded.contentType),
  };
}

async function bytesForHubUrl(
  bucket: R2Bucket,
  url: string,
  options: InlineStudioMediaOptions,
  maxBytes: number,
): Promise<HubMediaBytes> {
  const userId = options.auth?.userId;
  if (options.db && userId) {
    const key = await studioKeyForHubUrl(options.db, userId, url);
    if (key) {
      const object = await bucket.get(key);
      if (object) {
        if (object.size > maxBytes) throw new OxenMediaInlineError(HUB_TOO_LARGE);
        const bytes = await object.arrayBuffer();
        const claimed = object.httpMetadata?.contentType || guessMediaContentType(key);
        return { bytes, contentType: mediaTypeForBytes(bytes, claimed) };
      }
    }
  }
  return downloadHubFile(url, options, maxBytes);
}

/** Face slots need a Studio https URL. Copy a hub-only file into this user's R2 first. */
async function studioHttpsForHubUrl(
  bucket: R2Bucket,
  url: string,
  options: InlineStudioMediaOptions,
): Promise<string> {
  const userId = options.auth?.userId;
  const secret = options.auth?.secret;
  const origin = resolvePublicBaseUrl(options.publicBaseUrl);
  if (!userId || !secret || !origin) throw new OxenMediaInlineError(FACE_COPY_FAIL);
  if (options.db) {
    const key = await studioKeyForHubUrl(options.db, userId, url);
    if (key && (await bucket.head(key))) {
      return createSignedMediaUrl(origin, key, secret);
    }
  }
  const file = await downloadHubFile(url, options, HUB_HTTPS_COPY_MAX_BYTES);
  const stored = await putMediaObject(bucket, file.bytes, file.contentType, `u/${userId}`);
  return createSignedMediaUrl(origin, stored.key, secret);
}

export async function inlineStudioMediaRefs(
  bucket: R2Bucket,
  urls: string[],
  options?: InlineStudioMediaOptions,
): Promise<string[]> {
  const maxBytes = options?.maxBytes ?? OXEN_INLINE_MEDIA_MAX_BYTES;
  const out: string[] = [];
  for (const [index, url] of urls.entries()) {
    await assertAuthorizedStudioMediaUrl(url, options?.auth);
    // Seedance face upload rejects data: URIs (`unsupported_url_scheme`).
    if (options?.keepHttps?.[index]) {
      out.push(
        isOxenHostedMediaUrl(url) ? await studioHttpsForHubUrl(bucket, url, options ?? {}) : url,
      );
      continue;
    }
    if (url.startsWith("data:")) {
      out.push(url);
      continue;
    }
    if (isOxenHostedMediaUrl(url)) {
      const file = await bytesForHubUrl(bucket, url, options ?? {}, maxBytes);
      const encoded = await encodeImageForOxen(options?.images, file.bytes, file.contentType);
      out.push(arrayBufferToDataUri(encoded.bytes, encoded.contentType));
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
  signing?: {
    publicBaseUrl?: string | null;
    secret: string;
    verifySecrets?: string[];
    userId: string;
    apiKey?: string;
    db?: D1Database;
    fetchHub?: (apiKey: string, url: string) => Promise<HubMediaBytes>;
  },
): Promise<string[]> {
  const auth: StudioMediaAuth | undefined =
    signing?.secret && signing.userId
      ? { userId: signing.userId, secret: signing.secret, verifySecrets: signing.verifySecrets }
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
  return inlineStudioMediaRefs(bucket, prepared, {
    images,
    keepHttps,
    auth,
    apiKey: signing?.apiKey,
    db: signing?.db,
    publicBaseUrl: signing?.publicBaseUrl,
    fetchHub: signing?.fetchHub,
  });
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
