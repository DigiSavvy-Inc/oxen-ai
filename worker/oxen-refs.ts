const MEDIA_PATH_PREFIX = "/api/media/";

export function isOxenHostedMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "hub.oxen.ai";
  } catch {
    return false;
  }
}

export function studioMediaKeyFromUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("data:")) return null;
  try {
    const url =
      trimmed.startsWith("http://") || trimmed.startsWith("https://")
        ? new URL(trimmed)
        : new URL(trimmed, "https://studio.digisavvy.dev");
    if (!url.pathname.startsWith(MEDIA_PATH_PREFIX)) return null;
    const key = decodeURIComponent(url.pathname.slice(MEDIA_PATH_PREFIX.length));
    if (!key || key.includes("..")) return null;
    return key;
  } catch {
    return null;
  }
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
