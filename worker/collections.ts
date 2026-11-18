import { acceptGalleryLabel } from "./gallery-handle";
import { ownedMediaKey } from "./galleries";
import { COLLECTION_MAX_PER_PROFILE, COLLECTION_NAME_MAX } from "./gallery-limits";
import { previewFor, thumbKeyByResult } from "./gallery-present";
import { clampHistoryPageSize } from "./history-page-size";
import type { LibraryMedia } from "./library-page";
import { displayStoredMediaUrl } from "./media";
import { acceptMediaKind, normalizeMediaRole, type MediaKind } from "./schema";
import type { Env } from "./types";

/**
 * Collections (#67) sit one level above galleries. A gallery row carries `collection_id`, so a
 * gallery is in one collection or none. Every function here also runs on a database that does
 * not have `0032_collections.sql` yet: reads answer "not ready" and writes answer "unavailable".
 */

export type CollectionCoverJson = {
  key: string;
  kind: "image" | "video";
  thumbUrl: string | null;
  /** True when the user picked it. False for the automatic cover. */
  chosen: boolean;
};

export type CollectionJson = {
  id: string;
  name: string;
  position: number;
  updatedAt: number;
  /** In saved order. */
  galleryIds: string[];
  /** Distinct files across its galleries. */
  itemCount: number;
  cover: CollectionCoverJson | null;
};

export type CollectionAssetJson = {
  key: string;
  kind: MediaKind;
  name: string;
  role: string | null;
  label: string | null;
  url: string;
  thumbUrl: string | null;
  /** First gallery, in collection order, that holds it. */
  galleryId: string;
  galleryName: string;
  /** How many of the collection's galleries hold it. */
  galleryCount: number;
};

export type CollectionAssetsPage = {
  assets: CollectionAssetJson[];
  page: number;
  pageSize: number;
  total: number;
  media: LibraryMedia;
};

export type CollectionFailure = "name" | "limit" | "missing" | "gallery" | "cover" | "order" | "unavailable";

export type CollectionResult<T> = T | { error: CollectionFailure };

/** Most ids one order request takes. Above the collection and gallery caps. */
export const COLLECTION_ORDER_MAX_IDS = 200;

/** D1 allows 100 bound parameters per statement. */
const ID_CHUNK = 90;

const SAME_PROFILE = "IFNULL(profile_id, '') = IFNULL(?, '')";

type CollectionRow = {
  id: string;
  name: string;
  cover_key: string | null;
  position: number;
  created_at: number;
  updated_at: number;
};

type FiledGalleryRow = {
  id: string;
  name: string;
  collection_id: string;
  collection_position: number;
};

type ItemRow = {
  gallery_id: string;
  kind: string;
  name: string;
  media_key: string;
  position: number;
  role: string | null;
  label: string | null;
};

function missingCollections(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("no such table") || message.includes("no such column");
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let at = 0; at < items.length; at += size) chunks.push(items.slice(at, at + size));
  return chunks;
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

export function acceptCollectionName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name || name.length > COLLECTION_NAME_MAX) return null;
  return name;
}

/** Distinct ids from an order request, or null when the list is not usable. */
export function acceptOrderIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > COLLECTION_ORDER_MAX_IDS) return null;
  const ids: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string" || !value.trim() || value.length > 128) return null;
    const id = value.trim();
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** `wanted` first (only ids already in `current`), then the rest in their current order. */
function reordered(current: readonly string[], wanted: readonly string[]): string[] {
  const known = new Set(current);
  const front = wanted.filter((id) => known.has(id));
  const placed = new Set(front);
  return [...front, ...current.filter((id) => !placed.has(id))];
}

async function collectionRows(db: D1Database, userId: string, profileId: string | null): Promise<CollectionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, cover_key, position, created_at, updated_at FROM collections
       WHERE user_id = ? AND ${SAME_PROFILE}
       ORDER BY position ASC, created_at ASC, id ASC`,
    )
    .bind(userId, profileId)
    .all<CollectionRow>();
  return results ?? [];
}

async function collectionRow(
  db: D1Database,
  userId: string,
  profileId: string | null,
  id: string,
): Promise<CollectionRow | null> {
  return db
    .prepare(
      `SELECT id, name, cover_key, position, created_at, updated_at FROM collections
       WHERE id = ? AND user_id = ? AND ${SAME_PROFILE}`,
    )
    .bind(id, userId, profileId)
    .first<CollectionRow>();
}

/** Galleries on this profile filed in any collection, each collection's in saved order. */
async function filedGalleries(
  db: D1Database,
  userId: string,
  profileId: string | null,
  collectionId?: string,
): Promise<FiledGalleryRow[]> {
  const one = collectionId ? " AND collection_id = ?" : " AND collection_id IS NOT NULL";
  const { results } = await db
    .prepare(
      `SELECT id, name, collection_id, collection_position FROM galleries
       WHERE user_id = ? AND ${SAME_PROFILE}${one}
       ORDER BY collection_position ASC, updated_at DESC, id ASC`,
    )
    .bind(...(collectionId ? [userId, profileId, collectionId] : [userId, profileId]))
    .all<FiledGalleryRow>();
  return results ?? [];
}

/** Item rows of these galleries, keyed by gallery, each in saved item order. */
async function itemsByGallery(
  db: D1Database,
  userId: string,
  galleryIds: readonly string[],
): Promise<Map<string, ItemRow[]>> {
  const map = new Map<string, ItemRow[]>();
  for (const chunk of chunked(galleryIds, ID_CHUNK)) {
    const marks = chunk.map(() => "?").join(", ");
    const { results } = await db
      .prepare(
        `SELECT gallery_id, kind, name, media_key, position, role, label FROM gallery_items
         WHERE user_id = ? AND gallery_id IN (${marks})
         ORDER BY position ASC`,
      )
      .bind(userId, ...chunk)
      .all<ItemRow>();
    for (const row of results ?? []) {
      const list = map.get(row.gallery_id) ?? [];
      list.push(row);
      map.set(row.gallery_id, list);
    }
  }
  return map;
}

function groupByCollection(galleries: readonly FiledGalleryRow[]): Map<string, FiledGalleryRow[]> {
  const map = new Map<string, FiledGalleryRow[]>();
  for (const gallery of galleries) {
    const list = map.get(gallery.collection_id) ?? [];
    list.push(gallery);
    map.set(gallery.collection_id, list);
  }
  return map;
}

type CoverPick = { key: string; kind: "image" | "video"; name: string; chosen: boolean };

/**
 * A chosen cover counts only while one of the collection's galleries still holds it. Otherwise
 * the cover is the featured (first) image of the first gallery that has one.
 */
function pickCover(
  coverKey: string | null,
  galleries: readonly FiledGalleryRow[],
  items: Map<string, ItemRow[]>,
): CoverPick | null {
  const rows = galleries.flatMap((gallery) => items.get(gallery.id) ?? []);
  if (coverKey) {
    const chosen = rows.find((row) => row.media_key === coverKey);
    if (chosen && (chosen.kind === "image" || chosen.kind === "video")) {
      return { key: chosen.media_key, kind: chosen.kind, name: chosen.name, chosen: true };
    }
  }
  for (const gallery of galleries) {
    const first = (items.get(gallery.id) ?? []).find((row) => row.kind === "image");
    if (first) return { key: first.media_key, kind: "image", name: first.name, chosen: false };
  }
  return null;
}

async function presentCollections(
  env: Env,
  userId: string,
  rows: readonly CollectionRow[],
  filed: readonly FiledGalleryRow[],
): Promise<CollectionJson[]> {
  const ids = new Set(rows.map((row) => row.id));
  const grouped = groupByCollection(filed.filter((gallery) => ids.has(gallery.collection_id)));
  const items = await itemsByGallery(
    env.DB,
    userId,
    [...grouped.values()].flat().map((gallery) => gallery.id),
  );
  const covers = rows.map((row) => pickCover(row.cover_key, grouped.get(row.id) ?? [], items));
  const thumbs = await thumbKeyByResult(
    env.DB,
    userId,
    covers.flatMap((cover) => (cover ? [cover.key] : [])),
  );
  return Promise.all(
    rows.map(async (row, index) => {
      const galleries = grouped.get(row.id) ?? [];
      const keys = new Set(galleries.flatMap((gallery) => (items.get(gallery.id) ?? []).map((item) => item.media_key)));
      const pick = covers[index] ?? null;
      const cover: CollectionCoverJson | null = pick
        ? {
            key: pick.key,
            kind: pick.kind,
            thumbUrl: (await previewFor(env, pick, thumbs)).thumbUrl,
            chosen: pick.chosen,
          }
        : null;
      return {
        id: row.id,
        name: row.name,
        position: row.position,
        updatedAt: row.updated_at,
        galleryIds: galleries.map((gallery) => gallery.id),
        itemCount: keys.size,
        cover,
      };
    }),
  );
}

/** The active profile's collections in saved order. `ready` is false before the migration. */
export async function listCollections(
  env: Env,
  userId: string,
  profileId: string | null,
): Promise<{ collections: CollectionJson[]; ready: boolean }> {
  let rows: CollectionRow[];
  let filed: FiledGalleryRow[];
  try {
    rows = await collectionRows(env.DB, userId, profileId);
    filed = await filedGalleries(env.DB, userId, profileId);
  } catch (err) {
    if (!missingCollections(err)) throw err;
    return { collections: [], ready: false };
  }
  return { collections: await presentCollections(env, userId, rows, filed), ready: true };
}

/** One collection as the list shows it, or null when it is not on this profile. */
export async function getCollection(
  env: Env,
  userId: string,
  profileId: string | null,
  id: string,
): Promise<CollectionJson | null> {
  const { collections } = await listCollections(env, userId, profileId);
  return collections.find((collection) => collection.id === id) ?? null;
}

/** True when the collection is on this profile, false when not, null before the migration. */
export async function collectionExists(
  db: D1Database,
  userId: string,
  profileId: string | null,
  id: string,
): Promise<boolean | null> {
  try {
    return (await collectionRow(db, userId, profileId, id)) != null;
  } catch (err) {
    if (!missingCollections(err)) throw err;
    return null;
  }
}

/** Adds a collection at the end of the list. At the cap it is refused and nothing is removed. */
export async function createCollection(
  db: D1Database,
  userId: string,
  profileId: string | null,
  nameRaw: unknown,
): Promise<CollectionResult<{ id: string }>> {
  const name = acceptCollectionName(nameRaw);
  if (!name) return { error: "name" };
  try {
    const id = crypto.randomUUID();
    const stamp = now();
    // One statement counts, places, and inserts, so two creates at once cannot pass the cap together.
    const inserted = await db
      .prepare(
        `INSERT INTO collections (id, user_id, profile_id, name, cover_key, position, created_at, updated_at)
         SELECT ?, ?, ?, ?, NULL,
           (SELECT IFNULL(MAX(position) + 1, 0) FROM collections WHERE user_id = ? AND ${SAME_PROFILE}),
           ?, ?
         WHERE (SELECT COUNT(*) FROM collections WHERE user_id = ? AND ${SAME_PROFILE}) < ?`,
      )
      .bind(
        id,
        userId,
        profileId,
        name,
        userId,
        profileId,
        stamp,
        stamp,
        userId,
        profileId,
        COLLECTION_MAX_PER_PROFILE,
      )
      .run();
    if (Number(inserted.meta?.changes ?? 0) === 0) return { error: "limit" };
    return { id };
  } catch (err) {
    if (!missingCollections(err)) throw err;
    return { error: "unavailable" };
  }
}

/**
 * Renames a collection or sets its cover. `coverKey: null` goes back to the automatic cover. A
 * chosen cover has to be an image or video in one of the collection's galleries right now.
 */
export async function updateCollection(
  db: D1Database,
  userId: string,
  profileId: string | null,
  id: string,
  patch: { name?: unknown; coverKey?: unknown },
): Promise<CollectionResult<{ id: string }>> {
  let row: CollectionRow | null;
  try {
    row = await collectionRow(db, userId, profileId, id);
  } catch (err) {
    if (!missingCollections(err)) throw err;
    return { error: "unavailable" };
  }
  if (!row) return { error: "missing" };
  let name = row.name;
  if (patch.name !== undefined) {
    const accepted = acceptCollectionName(patch.name);
    if (!accepted) return { error: "name" };
    name = accepted;
  }
  let coverKey = row.cover_key;
  if (patch.coverKey === null) {
    coverKey = null;
  } else if (patch.coverKey !== undefined) {
    const key = ownedMediaKey(userId, patch.coverKey);
    if (!key) return { error: "cover" };
    const galleries = await filedGalleries(db, userId, profileId, id);
    const items = await itemsByGallery(
      db,
      userId,
      galleries.map((gallery) => gallery.id),
    );
    const pick = pickCover(key, galleries, items);
    if (!pick?.chosen) return { error: "cover" };
    coverKey = key;
  }
  if (name === row.name && coverKey === row.cover_key) return { id };
  // The write checks the profile again, so a collection moved to another profile mid-request is left alone.
  const saved = await db
    .prepare(
      `UPDATE collections SET name = ?, cover_key = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND ${SAME_PROFILE}`,
    )
    .bind(name, coverKey, now(), id, userId, profileId)
    .run();
  if (Number(saved.meta?.changes ?? 0) === 0) return { error: "missing" };
  return { id };
}

/** Ungroups the collection's galleries, then deletes the collection. No gallery or file goes. */
export async function deleteCollection(
  db: D1Database,
  userId: string,
  profileId: string | null,
  id: string,
): Promise<CollectionResult<{ ungrouped: number }>> {
  let row: CollectionRow | null;
  try {
    row = await collectionRow(db, userId, profileId, id);
  } catch (err) {
    if (!missingCollections(err)) throw err;
    return { error: "unavailable" };
  }
  if (!row) return { error: "missing" };
  // One batch runs as one transaction: the galleries are ungrouped and the row goes together, or neither.
  // Both statements check the profile again, so a collection moved mid-request is left as it is.
  const [cleared, removed] = await db.batch([
    db
      .prepare(
        `UPDATE galleries SET collection_id = NULL, collection_position = 0
         WHERE user_id = ? AND collection_id = ?
           AND EXISTS (SELECT 1 FROM collections WHERE id = ? AND user_id = ? AND ${SAME_PROFILE})`,
      )
      .bind(userId, id, id, userId, profileId),
    db
      .prepare(`DELETE FROM collections WHERE id = ? AND user_id = ? AND ${SAME_PROFILE}`)
      .bind(id, userId, profileId),
  ]);
  if (Number(removed?.meta?.changes ?? 0) === 0) return { error: "missing" };
  return { ungrouped: Number(cleared?.meta?.changes ?? 0) };
}

/** Saves the order of this profile's collections. Unknown ids are ignored; unlisted ones follow. */
export async function orderCollections(
  db: D1Database,
  userId: string,
  profileId: string | null,
  idsRaw: unknown,
): Promise<CollectionResult<{ ids: string[] }>> {
  const wanted = acceptOrderIds(idsRaw);
  if (!wanted) return { error: "order" };
  let rows: CollectionRow[];
  try {
    rows = await collectionRows(db, userId, profileId);
  } catch (err) {
    if (!missingCollections(err)) throw err;
    return { error: "unavailable" };
  }
  const ids = reordered(
    rows.map((row) => row.id),
    wanted,
  );
  const before = new Map(rows.map((row) => [row.id, row.position]));
  for (let position = 0; position < ids.length; position += 1) {
    const id = ids[position]!;
    if (before.get(id) === position) continue;
    await db
      .prepare(`UPDATE collections SET position = ? WHERE id = ? AND user_id = ? AND ${SAME_PROFILE}`)
      .bind(position, id, userId, profileId)
      .run();
  }
  return { ids };
}

/** Saves the order of galleries inside one collection. Ids not in it are ignored. */
export async function orderCollectionGalleries(
  db: D1Database,
  userId: string,
  profileId: string | null,
  collectionId: string,
  idsRaw: unknown,
): Promise<CollectionResult<{ galleryIds: string[] }>> {
  const wanted = acceptOrderIds(idsRaw);
  if (!wanted) return { error: "order" };
  let galleries: FiledGalleryRow[];
  try {
    if (!(await collectionRow(db, userId, profileId, collectionId))) return { error: "missing" };
    galleries = await filedGalleries(db, userId, profileId, collectionId);
  } catch (err) {
    if (!missingCollections(err)) throw err;
    return { error: "unavailable" };
  }
  const galleryIds = reordered(
    galleries.map((gallery) => gallery.id),
    wanted,
  );
  const before = new Map(galleries.map((gallery) => [gallery.id, gallery.collection_position]));
  for (let position = 0; position < galleryIds.length; position += 1) {
    const id = galleryIds[position]!;
    if (before.get(id) === position) continue;
    // Order lives on the gallery row; items and updated_at stay as they are.
    await db
      .prepare(
        `UPDATE galleries SET collection_position = ?
         WHERE id = ? AND user_id = ? AND collection_id = ? AND ${SAME_PROFILE}`,
      )
      .bind(position, id, userId, collectionId, profileId)
      .run();
  }
  return { galleryIds };
}

/**
 * Files one gallery at the end of a collection, or ungroups it with `null`. Filing it somewhere
 * else moves it. One small UPDATE on the gallery row: items, order, handle, and updated_at stay.
 */
export async function fileGallery(
  db: D1Database,
  userId: string,
  profileId: string | null,
  galleryId: string,
  collectionId: string | null,
): Promise<CollectionResult<{ galleryId: string; collectionId: string | null }>> {
  let gallery: { id: string; collection_id: string | null } | null;
  try {
    gallery = await db
      .prepare(`SELECT id, collection_id FROM galleries WHERE id = ? AND user_id = ? AND ${SAME_PROFILE}`)
      .bind(galleryId, userId, profileId)
      .first<{ id: string; collection_id: string | null }>();
    if (!gallery) return { error: "gallery" };
    if (collectionId && !(await collectionRow(db, userId, profileId, collectionId))) {
      return { error: "missing" };
    }
  } catch (err) {
    if (!missingCollections(err)) throw err;
    return { error: "unavailable" };
  }
  if ((gallery.collection_id ?? null) === collectionId) return { galleryId, collectionId };
  if (!collectionId) {
    await db
      .prepare(`UPDATE galleries SET collection_id = NULL, collection_position = 0 WHERE id = ? AND user_id = ?`)
      .bind(galleryId, userId)
      .run();
    return { galleryId, collectionId: null };
  }
  // One statement places the gallery at the end and only lands while the collection still exists on
  // this profile, so a collection deleted mid-request never ends up holding a gallery.
  const filed = await db
    .prepare(
      `UPDATE galleries SET collection_id = ?,
         collection_position = (
           SELECT IFNULL(MAX(collection_position) + 1, 0) FROM galleries WHERE user_id = ? AND collection_id = ?
         )
       WHERE id = ? AND user_id = ?
         AND EXISTS (SELECT 1 FROM collections WHERE id = ? AND user_id = ? AND ${SAME_PROFILE})`,
    )
    .bind(collectionId, userId, collectionId, galleryId, userId, collectionId, userId, profileId)
    .run();
  if (Number(filed.meta?.changes ?? 0) === 0) return { error: "missing" };
  return { galleryId, collectionId };
}

export type CollectionAssetsQuery = {
  media: LibraryMedia;
  page: number;
  pageSize: number;
};

export function parseCollectionAssetsQuery(
  mediaRaw: string | undefined,
  pageRaw: string | undefined,
  pageSizeRaw: string | undefined,
  defaultPageSize: number,
): CollectionAssetsQuery {
  const media: LibraryMedia = mediaRaw === "image" || mediaRaw === "video" || mediaRaw === "audio" ? mediaRaw : "";
  const parsedPage = Number(pageRaw);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1;
  const pageSize = clampHistoryPageSize(pageSizeRaw ?? defaultPageSize);
  return { media, page, pageSize };
}

type AssetEntry = {
  row: ItemRow;
  kind: MediaKind;
  gallery: FiledGalleryRow;
  holders: Set<string>;
};

/**
 * One page of every file across the collection's galleries, in gallery order then item order.
 * A file in two of its galleries appears once. Links are signed only for the page returned.
 */
export async function collectionAssets(
  env: Env,
  userId: string,
  profileId: string | null,
  collectionId: string,
  query: CollectionAssetsQuery,
): Promise<CollectionResult<CollectionAssetsPage>> {
  let galleries: FiledGalleryRow[];
  try {
    if (!(await collectionRow(env.DB, userId, profileId, collectionId))) return { error: "missing" };
    galleries = await filedGalleries(env.DB, userId, profileId, collectionId);
  } catch (err) {
    if (!missingCollections(err)) throw err;
    return { error: "unavailable" };
  }
  const items = await itemsByGallery(
    env.DB,
    userId,
    galleries.map((gallery) => gallery.id),
  );
  const byKey = new Map<string, AssetEntry>();
  const ordered: AssetEntry[] = [];
  for (const gallery of galleries) {
    for (const row of items.get(gallery.id) ?? []) {
      const seen = byKey.get(row.media_key);
      if (seen) {
        seen.holders.add(gallery.id);
        continue;
      }
      const kind = acceptMediaKind(row.kind);
      if (!kind) continue;
      const entry: AssetEntry = { row, kind, gallery, holders: new Set([gallery.id]) };
      byKey.set(row.media_key, entry);
      ordered.push(entry);
    }
  }
  const matched = query.media ? ordered.filter((entry) => entry.kind === query.media) : ordered;
  const start = (query.page - 1) * query.pageSize;
  const page = matched.slice(start, start + query.pageSize);
  const thumbs = await thumbKeyByResult(
    env.DB,
    userId,
    page.map((entry) => entry.row.media_key),
  );
  const assets = await Promise.all(
    page.map(async ({ row, kind, gallery, holders }) => {
      const preview = await previewFor(env, { kind, name: row.name, key: row.media_key }, thumbs);
      return {
        key: row.media_key,
        kind,
        name: row.name,
        role: kind === "audio" || !row.role?.trim() ? null : normalizeMediaRole(row.role),
        label: acceptGalleryLabel(row.label),
        url: (await displayStoredMediaUrl(env, row.media_key, null)) ?? "",
        thumbUrl: preview.thumbUrl,
        galleryId: gallery.id,
        galleryName: gallery.name,
        galleryCount: holders.size,
      };
    }),
  );
  return { assets, page: query.page, pageSize: query.pageSize, total: matched.length, media: query.media };
}
