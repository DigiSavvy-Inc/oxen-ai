import { createImageThumbnail, isRasterImage } from "./thumbs";
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

export async function backfillMissingThumbnails(
  env: Env,
  userId: string,
  limit = 8,
): Promise<{ built: number; remaining: boolean }> {
  const rows = await env.DB.prepare(
    `SELECT id, status, result_key, thumb_key FROM generations
     WHERE user_id = ? AND status = 'succeeded' AND result_key IS NOT NULL
       AND (thumb_key IS NULL OR thumb_key = '')
     ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(userId, limit)
    .all<LibraryAssetRow>();
  const list = rows.results ?? [];
  let built = 0;
  for (const row of list) {
    if (!row.result_key) continue;
    const object = await env.MEDIA.get(row.result_key);
    if (!object) continue;
    const contentType = object.httpMetadata?.contentType || "application/octet-stream";
    if (!isRasterImage(contentType)) continue;
    const bytes = await object.arrayBuffer();
    const thumb = await createImageThumbnail(env.IMAGES, bytes, contentType);
    if (!thumb) continue;
    const ext = ".jpg";
    const key = `u/${userId}/thumbs/${crypto.randomUUID()}${ext}`;
    await env.MEDIA.put(key, thumb.bytes, {
      httpMetadata: { contentType: thumb.contentType },
    });
    try {
      await env.DB.prepare(
        `UPDATE generations SET thumb_key = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      )
        .bind(key, Math.floor(Date.now() / 1000), row.id, userId)
        .run();
      built += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("thumb_key") || message.includes("SQLITE_ERROR")) {
        await env.MEDIA.delete(key);
        break;
      }
      throw err;
    }
  }
  return { built, remaining: list.length >= limit };
}
