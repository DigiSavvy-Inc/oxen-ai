import { createImageThumbnail, isRasterImage, THUMB_MAX_BYTES } from "./thumbs";
import { putMediaObject } from "./media";
import { cancelGeneration } from "./oxen";
import { deleteOxenGeneration, deleteOxenResultUrls } from "./oxen-delete";
import type { Env } from "./types";

export type CleanupAction = "failed" | "thumbs" | "all";

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

export function parseCleanupAction(raw: unknown): CleanupAction | null {
  if (raw === "failed" || raw === "thumbs" || raw === "all") return raw;
  return null;
}

export function parseFromOxenFlag(raw: unknown): boolean {
  return raw === true || raw === 1 || raw === "1" || raw === "true";
}

export type LibraryAssetRow = {
  id: string;
  status: string;
  result_key?: string | null;
  thumb_key?: string | null;
  last_frame_key?: string | null;
  oxen_generation_id?: string | null;
  result_url?: string | null;
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
  await deleteStoredMedia(env, [row.result_key, row.thumb_key, row.last_frame_key]);
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

async function cancelInFlightOxenJobs(
  apiKey: string,
  rows: LibraryAssetRow[],
): Promise<void> {
  for (const row of rows) {
    if (!row.oxen_generation_id || TERMINAL_STATUSES.has(row.status)) continue;
    try {
      await cancelGeneration(apiKey, row.oxen_generation_id);
    } catch {
      /* already finished or missing on Oxen */
    }
  }
}

export async function removeStudioGeneration(
  env: Env,
  userId: string,
  row: LibraryAssetRow,
  options: { apiKey?: string | null; fromOxen?: boolean } = {},
): Promise<{ oxenDeleted: number; oxenFailed: number }> {
  const apiKey = options.apiKey ?? null;
  let oxenDeleted = 0;
  let oxenFailed = 0;
  if (options.fromOxen) {
    if (apiKey) {
      if (row.oxen_generation_id) {
        try {
          await deleteOxenGeneration(apiKey, row.oxen_generation_id, row.result_url);
          oxenDeleted = 1;
        } catch {
          oxenFailed = 1;
        }
      } else {
        const result = await deleteOxenResultUrls(apiKey, [row.result_url]);
        oxenDeleted = result.deleted;
        oxenFailed = result.failed;
      }
    } else if (row.result_url) {
      oxenFailed = 1;
    }
  } else if (apiKey) {
    await cancelInFlightOxenJobs(apiKey, [row]);
  }
  await deleteGenerationRecord(env, userId, row);
  return { oxenDeleted, oxenFailed };
}

export async function deleteUserR2Prefix(env: Env, userId: string): Promise<number> {
  const prefix = `u/${userId}/`;
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const listed = await env.MEDIA.list({ prefix, cursor, limit: 1000 });
    const keys = listed.objects.map((object) => object.key);
    if (keys.length > 0) {
      await Promise.all(keys.map((key) => env.MEDIA.delete(key)));
      deleted += keys.length;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return deleted;
}

export async function deleteAllUserMedia(
  env: Env,
  userId: string,
  options: { apiKey?: string | null; fromOxen?: boolean } = {},
): Promise<{
  deleted: number;
  r2Deleted: number;
  oxenDeleted: number;
  oxenFailed: number;
}> {
  const rows =
    (
      await env.DB.prepare(
        `SELECT id, status, result_key, thumb_key, last_frame_key, oxen_generation_id, result_url
         FROM generations WHERE user_id = ?`,
      )
        .bind(userId)
        .all<LibraryAssetRow>()
    ).results ?? [];
  const apiKey = options.apiKey ?? null;
  let oxenDeleted = 0;
  let oxenFailed = 0;
  if (apiKey) await cancelInFlightOxenJobs(apiKey, rows);
  if (options.fromOxen) {
    if (apiKey) {
      const result = await deleteOxenResultUrls(
        apiKey,
        rows.map((row) => row.result_url),
      );
      oxenDeleted = result.deleted;
      oxenFailed = result.failed;
    } else {
      oxenFailed = rows.filter((row) => row.result_url).length;
    }
  }
  try {
    await env.DB.prepare(`DELETE FROM generation_tags WHERE user_id = ?`)
      .bind(userId)
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("generation_tags") && !message.includes("SQLITE_ERROR")) {
      throw err;
    }
  }
  await env.DB.prepare(`DELETE FROM generations WHERE user_id = ?`).bind(userId).run();
  try {
    await env.DB.prepare(`DELETE FROM gallery_items WHERE user_id = ?`).bind(userId).run();
    await env.DB.prepare(`DELETE FROM galleries WHERE user_id = ?`).bind(userId).run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("galleries") && !message.includes("SQLITE_ERROR")) {
      throw err;
    }
  }
  const r2Deleted = await deleteUserR2Prefix(env, userId);
  return { deleted: rows.length, r2Deleted, oxenDeleted, oxenFailed };
}

export async function deleteFailedGenerations(
  env: Env,
  userId: string,
): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT id, status, result_key, thumb_key, last_frame_key FROM generations
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
