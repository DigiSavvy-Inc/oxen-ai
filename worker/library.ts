import { createImageThumbnail, isRasterImage, THUMB_MAX_BYTES } from "./thumbs";
import { putMediaObject } from "./media";
import type { Env } from "./types";

export type CleanupAction = "failed" | "thumbs";

export function parseCleanupAction(raw: unknown): CleanupAction | null {
  if (raw === "failed" || raw === "thumbs") return raw;
  return null;
}

export type LibraryAssetRow = {
  id: string;
  status: string;
  result_key?: string | null;
  thumb_key?: string | null;
  oxen_generation_id?: string;
};

export async function deleteStoredMedia(
  env: Env,
  keys: Array<string | null | undefined>,
): Promise<void> {
  for (const key of keys) {
    if (!key) continue;
    try {
      await env.MEDIA.delete(key);
    } catch {
      /* ignore missing objects */
    }
  }
}

export async function deleteGenerationRecord(
  env: Env,
  userId: string,
  row: LibraryAssetRow,
): Promise<void> {
  await deleteStoredMedia(env, [row.result_key, row.thumb_key]);
  try {
    await env.DB.prepare(
      `DELETE FROM generation_tags WHERE user_id = ? AND generation_id = ?`,
    )
      .bind(userId, row.id)
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("generation_tags") && !message.includes("SQLITE_ERROR")) {
      throw err;
    }
  }
  await env.DB.prepare(`DELETE FROM generations WHERE id = ? AND user_id = ?`)
    .bind(row.id, userId)
    .run();
}

export async function deleteFailedGenerations(
  env: Env,
  userId: string,
): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT id, status, result_key, thumb_key FROM generations
     WHERE user_id = ? AND status IN ('failed', 'cancelled')`,
  )
    .bind(userId)
    .all<LibraryAssetRow>();
  const list = rows.results ?? [];
  for (const row of list) {
    await deleteGenerationRecord(env, userId, row);
  }
  return list.length;
}

export type BackfillThumbnailsOptions = {
  limit?: number;
  rebuildOversized?: boolean;
};

export function thumbIsReusable(
  existing: { size: number } | null,
  rebuildOversized: boolean,
): boolean {
  if (!existing || existing.size <= 0) return false;
  if (!rebuildOversized) return true;
  return existing.size <= THUMB_MAX_BYTES;
}

export async function backfillMissingThumbnails(
  env: Env,
  userId: string,
  options: BackfillThumbnailsOptions | number = {},
): Promise<{ built: number; remaining: boolean }> {
  const parsed = typeof options === "number" ? { limit: options } : options;
  const limit = parsed.limit ?? 8;
  const rebuildOversized = parsed.rebuildOversized === true;
  const fetchLimit = rebuildOversized ? Math.max(limit * 3, 24) : limit;
  const filter = rebuildOversized
    ? `AND result_key IS NOT NULL`
    : `AND result_key IS NOT NULL AND thumb_key IS NULL`;
  const rows = await env.DB.prepare(
    `SELECT id, status, result_key, thumb_key FROM generations
     WHERE user_id = ? AND status = 'succeeded' ${filter}
     ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(userId, fetchLimit)
    .all<LibraryAssetRow>();
  const list = rows.results ?? [];
  let built = 0;
  let considered = 0;
  for (const row of list) {
    if (built >= limit) break;
    if (!row.result_key) continue;
    if (rebuildOversized) {
      const existing = row.thumb_key ? await env.MEDIA.head(row.thumb_key) : null;
      if (thumbIsReusable(existing, true)) continue;
    }
    considered += 1;
    const object = await env.MEDIA.get(row.result_key);
    if (!object) continue;
    const contentType = object.httpMetadata?.contentType || "application/octet-stream";
    if (!isRasterImage(contentType)) continue;
    const bytes = await object.arrayBuffer();
    const thumb = await createImageThumbnail(env.IMAGES, bytes, contentType);
    if (!thumb) continue;
    const stored = await putMediaObject(
      env.MEDIA,
      thumb.bytes,
      thumb.contentType,
      `u/${userId}/thumbs`,
    );
    if (row.thumb_key && row.thumb_key !== stored.key) {
      await deleteStoredMedia(env, [row.thumb_key]);
    }
    try {
      await env.DB.prepare(
        `UPDATE generations SET thumb_key = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      )
        .bind(stored.key, Math.floor(Date.now() / 1000), row.id, userId)
        .run();
      built += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("thumb_key") || message.includes("SQLITE_ERROR")) {
        await env.MEDIA.delete(stored.key);
        break;
      }
      throw err;
    }
  }
  return { built, remaining: considered >= limit || built >= limit };
}
