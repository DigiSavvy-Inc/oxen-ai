/** Request fields that carry media references to `/api/generate`. */
export const MEDIA_REF_FIELDS = [
  "images",
  "videos",
  "audios",
  "input_image",
  "input_images",
  "input_face_images",
  "input_video",
  "input_videos",
  "input_face_videos",
  "input_audios",
] as const;

/** Renew a link that would expire while the request is on its way. */
export const MEDIA_LINK_RENEW_MARGIN_SECONDS = 10 * 60;

/** The Worker renews this many links per request. */
export const MEDIA_LINK_RENEW_BATCH = 64;

export type RenewMediaLinks = (urls: string[]) => Promise<(string | null)[]>;

/** Expiry of a signed Studio media link, in epoch seconds. Null for any other URL. */
export function mediaLinkExpiry(url: string): number | null {
  if (!url || url.startsWith("data:") || url.startsWith("blob:")) return null;
  let parsed: URL;
  try {
    parsed = new URL(url, "https://studio.local");
  } catch {
    return null;
  }
  if (!parsed.pathname.startsWith("/api/media/")) return null;
  const raw = parsed.searchParams.get("exp");
  const exp = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(exp) ? exp : null;
}

export function mediaLinkNeedsRenewal(
  url: string,
  nowSeconds: number,
  marginSeconds = MEDIA_LINK_RENEW_MARGIN_SECONDS,
): boolean {
  const exp = mediaLinkExpiry(url);
  return exp != null && exp - nowSeconds < marginSeconds;
}

function refsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}

/** Each reference in the request whose signed link has expired or is about to. */
export function expiringMediaRefs(body: Record<string, unknown>, nowSeconds: number): string[] {
  const found = new Set<string>();
  for (const field of MEDIA_REF_FIELDS) {
    for (const url of refsIn(body[field])) {
      if (mediaLinkNeedsRenewal(url, nowSeconds)) found.add(url);
    }
  }
  return [...found];
}

function swap(value: unknown, renewed: Map<string, string>): unknown {
  if (typeof value === "string") return renewed.get(value) ?? value;
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? (renewed.get(item) ?? item) : item));
  }
  return value;
}

/**
 * The same request with expiring Studio links exchanged for new ones.
 * A link the Worker will not renew is sent as it is, and the Worker refuses it there.
 */
export async function withLiveMediaRefs(
  body: Record<string, unknown>,
  renew: RenewMediaLinks,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<Record<string, unknown>> {
  const stale = expiringMediaRefs(body, nowSeconds);
  if (stale.length === 0) return body;
  const renewed = new Map<string, string>();
  try {
    for (let offset = 0; offset < stale.length; offset += MEDIA_LINK_RENEW_BATCH) {
      const batch = stale.slice(offset, offset + MEDIA_LINK_RENEW_BATCH);
      const fresh = await renew(batch);
      batch.forEach((url, index) => {
        const next = fresh[index];
        if (typeof next === "string" && next) renewed.set(url, next);
      });
    }
  } catch {
    return body;
  }
  if (renewed.size === 0) return body;
  const next: Record<string, unknown> = { ...body };
  for (const field of MEDIA_REF_FIELDS) {
    if (field in next) next[field] = swap(next[field], renewed);
  }
  return next;
}
