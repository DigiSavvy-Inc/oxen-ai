import { ownedMediaKey } from "./galleries";
import { GALLERY_MAX_ITEMS } from "./gallery-limits";
import {
  deleteStoredMedia,
  removeStudioGenerations,
  type LibraryAssetRow,
  type OxenRemoval,
} from "./library";
import { forgetSlotFiles } from "./slots";
import type { Env } from "./types";

/** D1 allows 100 bound parameters per statement. */
const KEY_CHUNK = 90;

function chunked<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let at = 0; at < items.length; at += size) chunks.push(items.slice(at, at + size));
  return chunks;
}

/** Distinct stored keys this user owns, or null when the list is not usable. One gallery's worth at most. */
export function parseGalleryFileKeys(userId: string, raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const keys = new Set<string>();
  for (const value of raw) {
    const key = ownedMediaKey(userId, value);
    if (!key) return null;
    keys.add(key);
  }
  if (keys.size === 0 || keys.size > GALLERY_MAX_ITEMS) return null;
  return [...keys];
}

async function generationsForKeys(
  db: D1Database,
  userId: string,
  keys: readonly string[],
): Promise<LibraryAssetRow[]> {
  const rows: LibraryAssetRow[] = [];
  for (const chunk of chunked(keys, KEY_CHUNK)) {
    const marks = chunk.map(() => "?").join(", ");
    const found = await db
      .prepare(
        `SELECT id, status, result_key, thumb_key, last_frame_key, oxen_generation_id, result_url
         FROM generations WHERE user_id = ? AND result_key IN (${marks})`,
      )
      .bind(userId, ...chunk)
      .all<LibraryAssetRow>();
    rows.push(...(found.results ?? []));
  }
  return rows;
}

/** Takes the files out of every gallery this user has, and marks those galleries as changed. */
async function forgetGalleryFiles(db: D1Database, userId: string, keys: readonly string[]): Promise<void> {
  const galleryIds = new Set<string>();
  for (const chunk of chunked(keys, KEY_CHUNK)) {
    const marks = chunk.map(() => "?").join(", ");
    const found = await db
      .prepare(
        `SELECT DISTINCT gallery_id FROM gallery_items WHERE user_id = ? AND media_key IN (${marks})`,
      )
      .bind(userId, ...chunk)
      .all<{ gallery_id: string }>();
    for (const row of found.results ?? []) galleryIds.add(row.gallery_id);
    await db
      .prepare(`DELETE FROM gallery_items WHERE user_id = ? AND media_key IN (${marks})`)
      .bind(userId, ...chunk)
      .run();
  }
  const now = Math.floor(Date.now() / 1000);
  for (const chunk of chunked([...galleryIds], KEY_CHUNK)) {
    const marks = chunk.map(() => "?").join(", ");
    await db
      .prepare(`UPDATE galleries SET updated_at = ? WHERE user_id = ? AND id IN (${marks})`)
      .bind(now, userId, ...chunk)
      .run();
  }
}

/**
 * Deletes gallery files from Studio and, when asked, their Oxen copies. A file that came from a
 * generation goes the way a library delete takes it. A dropped file has no Oxen copy, so only its
 * stored bytes go. Either way no gallery or slot is left pointing at a file that is gone.
 */
export async function deleteGalleryFiles(
  env: Env,
  userId: string,
  keys: readonly string[],
  options: { apiKey?: string | null; fromOxen?: boolean } = {},
): Promise<{ deleted: number } & OxenRemoval> {
  const rows = await generationsForKeys(env.DB, userId, keys);
  const oxen = await removeStudioGenerations(env, userId, rows, options);
  const generated = new Set(rows.map((row) => row.result_key));
  const dropped = keys.filter((key) => !generated.has(key));
  await deleteStoredMedia(env, dropped);
  await forgetSlotFiles(env.DB, userId, dropped);
  await forgetGalleryFiles(env.DB, userId, keys);
  return { deleted: keys.length, ...oxen };
}
