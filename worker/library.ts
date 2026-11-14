import { createImageThumbnail, isRasterImage, THUMB_MAX_BYTES } from "./thumbs";
import { putMediaObject } from "./media";
import { cancelGeneration } from "./oxen";
import { deleteOxenResultUrls } from "./oxen-delete";
import { deleteUserSlotFiles, forgetSlotFiles } from "./slots";
import type { Env } from "./types";

export type CleanupAction = "failed" | "thumbs" | "all";

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

/** D1 allows 100 bound parameters per statement. */
const ID_CHUNK = 90;
const R2_DELETE_CHUNK = 1000;

/** Most generations one bulk delete request takes. */
export const BULK_DELETE_MAX_IDS = 200;

export function parseCleanupAction(raw: unknown): CleanupAction | null {
  if (raw === "failed" || raw === "thumbs" || raw === "all") return raw;
  return null;
}

export function parseFromOxenFlag(raw: unknown): boolean {
  return raw === true || raw === 1 || raw === "1" || raw === "true";
}

/** Distinct generation ids from a request body, or null when it is not a usable list. */
export function parseBulkDeleteIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = new Set<string>();
  for (const value of raw) {
    if (typeof value !== "string" || !value.trim() || value.length > 128) return null;
    ids.add(value.trim());
  }
  if (ids.size === 0 || ids.size > BULK_DELETE_MAX_IDS) return null;
  return [...ids];
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

/**
 * What happened to the Oxen copies of deleted items. `oxenDeleted` counts files Oxen confirmed it
 * removed, `oxenAlreadyGone` files it no longer had, and `oxenFailed` files that may still be there.
 */
export type OxenRemoval = {
  oxenDeleted: number;
  oxenAlreadyGone: number;
  oxenFailed: number;
};

const NO_OXEN_REMOVAL: OxenRemoval = { oxenDeleted: 0, oxenAlreadyGone: 0, oxenFailed: 0 };

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function isMissingTableError(err: unknown, table: string): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes(table) || message.includes("SQLITE_ERROR");
}

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
    if (!isMissingTableError(err, "generation_tags")) throw err;
  }
  await env.DB.prepare(`DELETE FROM generations WHERE id = ? AND user_id = ?`)
    .bind(row.id, userId)
    .run();
}

/** Removes many generations with a fixed number of R2 and D1 calls per chunk, not per row. */
async function deleteGenerationRecords(
  env: Env,
  userId: string,
  rows: LibraryAssetRow[],
): Promise<void> {
  const keys = rows
    .flatMap((row) => [row.result_key, row.thumb_key, row.last_frame_key])
    .filter((key): key is string => Boolean(key));
  for (const chunk of chunked(keys, R2_DELETE_CHUNK)) {
    try {
      await env.MEDIA.delete(chunk);
    } catch {
      /* ignore missing objects */
    }
  }
  for (const chunk of chunked(rows.map((row) => row.id), ID_CHUNK)) {
    const marks = chunk.map(() => "?").join(", ");
    try {
      await env.DB.prepare(
        `DELETE FROM generation_tags WHERE user_id = ? AND generation_id IN (${marks})`,
      )
        .bind(userId, ...chunk)
        .run();
    } catch (err) {
      if (!isMissingTableError(err, "generation_tags")) throw err;
    }
    await env.DB.prepare(`DELETE FROM generations WHERE user_id = ? AND id IN (${marks})`)
      .bind(userId, ...chunk)
      .run();
  }
}

/** Queue DELETE only cancels a job that is still queued or running. Finished jobs are left alone. */
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

/** Removes the Oxen copies of `rows` in one pass. A failure here never stops the Studio delete. */
async function removeOxenCopies(
  apiKey: string | null,
  rows: LibraryAssetRow[],
): Promise<OxenRemoval> {
  const urls = [
    ...new Set(rows.map((row) => row.result_url?.trim() ?? "").filter((url) => url.length > 0)),
  ];
  if (urls.length === 0) return { ...NO_OXEN_REMOVAL };
  if (!apiKey) return { ...NO_OXEN_REMOVAL, oxenFailed: urls.length };
  try {
    const report = await deleteOxenResultUrls(apiKey, urls);
    return {
      oxenDeleted: report.removed,
      oxenAlreadyGone: report.alreadyGone,
      oxenFailed: report.failed,
    };
  } catch (err) {
    console.error("oxen_delete_error", err instanceof Error ? err.name : "unknown");
    return { ...NO_OXEN_REMOVAL, oxenFailed: urls.length };
  }
}

export async function findOwnedGenerations(
  env: Env,
  userId: string,
  ids: string[],
): Promise<LibraryAssetRow[]> {
  const rows: LibraryAssetRow[] = [];
  for (const chunk of chunked(ids, ID_CHUNK)) {
    const marks = chunk.map(() => "?").join(", ");
    const found = await env.DB.prepare(
      `SELECT id, status, result_key, thumb_key, last_frame_key, oxen_generation_id, result_url
       FROM generations WHERE user_id = ? AND id IN (${marks})`,
    )
      .bind(userId, ...chunk)
      .all<LibraryAssetRow>();
    rows.push(...(found.results ?? []));
  }
  return rows;
}

/**
 * Deletes generations from Studio and, when asked, their Oxen copies. The Oxen files of the whole
 * set go in one pass, so files committed to the repository cost one commit however many there are.
 */
export async function removeStudioGenerations(
  env: Env,
  userId: string,
  rows: LibraryAssetRow[],
  options: { apiKey?: string | null; fromOxen?: boolean } = {},
): Promise<OxenRemoval> {
  if (rows.length === 0) return { ...NO_OXEN_REMOVAL };
  const apiKey = options.apiKey ?? null;
  if (apiKey) await cancelInFlightOxenJobs(apiKey, rows);
  const oxen = options.fromOxen ? await removeOxenCopies(apiKey, rows) : { ...NO_OXEN_REMOVAL };
  await deleteGenerationRecords(env, userId, rows);
  await forgetSlotFiles(
    env.DB,
    userId,
    rows.flatMap((row) => (row.result_key ? [row.result_key] : [])),
  );
  return oxen;
}

export function removeStudioGeneration(
  env: Env,
  userId: string,
  row: LibraryAssetRow,
  options: { apiKey?: string | null; fromOxen?: boolean } = {},
): Promise<OxenRemoval> {
  return removeStudioGenerations(env, userId, [row], options);
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
): Promise<{ deleted: number; r2Deleted: number } & OxenRemoval> {
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
  if (apiKey) await cancelInFlightOxenJobs(apiKey, rows);
  const oxen = options.fromOxen ? await removeOxenCopies(apiKey, rows) : { ...NO_OXEN_REMOVAL };
  try {
    await env.DB.prepare(`DELETE FROM generation_tags WHERE user_id = ?`)
      .bind(userId)
      .run();
  } catch (err) {
    if (!isMissingTableError(err, "generation_tags")) throw err;
  }
  await env.DB.prepare(`DELETE FROM generations WHERE user_id = ?`).bind(userId).run();
  try {
    await env.DB.prepare(`DELETE FROM gallery_items WHERE user_id = ?`).bind(userId).run();
    await env.DB.prepare(`DELETE FROM galleries WHERE user_id = ?`).bind(userId).run();
  } catch (err) {
    if (!isMissingTableError(err, "galleries")) throw err;
  }
  await deleteUserSlotFiles(env.DB, userId);
  const r2Deleted = await deleteUserR2Prefix(env, userId);
  return { deleted: rows.length, r2Deleted, ...oxen };
}

/** Failed, cancelled, or succeeded with no stored file. In-flight jobs stay. */
export const UNFINISHED_GENERATION_SQL =
  "(status IN ('failed', 'cancelled') OR (status = 'succeeded' AND COALESCE(result_url, '') = '' AND COALESCE(result_key, '') = ''))";

export async function deleteFailedGenerations(
  env: Env,
  userId: string,
): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT id, status, result_key, thumb_key, last_frame_key FROM generations
     WHERE user_id = ? AND ${UNFINISHED_GENERATION_SQL}`,
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
