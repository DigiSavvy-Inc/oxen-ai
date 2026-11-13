import {
  acceptGalleryHandle,
  acceptGalleryLabel,
  acceptGalleryTake,
  defaultGalleryHandle,
  galleryLabelInvalid,
} from "./gallery-handle";
import { GALLERY_MAX_ITEMS } from "./gallery-limits";
import { acceptMediaKind, normalizeMediaRole, type MediaKind, type MediaRole } from "./schema";

export { GALLERY_MAX_ITEMS };

export type GalleryKind = MediaKind;

export type GalleryItemInput = {
  kind: GalleryKind;
  name: string;
  key: string;
  role: MediaRole | null;
  label: string | null;
};

export class GalleryRejected extends Error {
  readonly code: "handle" | "label";

  constructor(code: "handle" | "label", message: string) {
    super(message);
    this.name = "GalleryRejected";
    this.code = code;
  }
}

export type StoredGalleryItem = GalleryItemInput & {
  id: string;
  position: number;
};

export type StoredGallery = {
  id: string;
  name: string;
  handle: string;
  takeCount: number;
  profileId: string | null;
  updatedAt: number;
  items: StoredGalleryItem[];
};

export type GallerySummary = {
  id: string;
  name: string;
  handle: string;
  takeCount: number;
  updatedAt: number;
};

export const GALLERY_NAME_MAX = 80;
export const GALLERY_ITEM_NAME_MAX = 180;
export const GALLERY_MAX_ROWS = 100;

type GalleryRow = {
  id: string;
  name: string;
  updated_at: number;
  handle?: string | null;
  take_count?: number | null;
  profile_id?: string | null;
};

type ItemRow = {
  id: string;
  kind: string;
  name: string;
  media_key: string;
  position: number;
  role?: string | null;
  label?: string | null;
};

export function acceptGalleryName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name || name.length > GALLERY_NAME_MAX) return null;
  return name;
}

/** A stored key this user owns (under `u/{userId}/`), or null for anything else. */
export function ownedMediaKey(userId: string, raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!userId || raw.length > 512) return null;
  if (raw.includes("..") || raw.includes("\\") || raw.includes("\0")) return null;
  const prefix = `u/${userId}/`;
  if (!raw.startsWith(prefix)) return null;
  return raw;
}

function acceptItemRole(kind: GalleryKind, raw: unknown): MediaRole | null {
  if (kind === "audio") return null;
  if (typeof raw !== "string" || !raw.trim()) return "character";
  return normalizeMediaRole(raw);
}

function storedRole(kind: GalleryKind, raw: string | null | undefined): MediaRole | null {
  if (kind === "audio") return null;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return normalizeMediaRole(raw);
}

function missingColumn(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("no such column");
}

export function acceptGalleryItems(userId: string, raw: unknown): GalleryItemInput[] | null {
  if (!Array.isArray(raw) || raw.length > GALLERY_MAX_ITEMS) return null;
  const items: GalleryItemInput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const record = entry as { kind?: unknown; name?: unknown; key?: unknown; role?: unknown; label?: unknown };
    const kind = acceptMediaKind(record.kind);
    const key = ownedMediaKey(userId, record.key);
    if (!kind || typeof record.name !== "string" || !key) return null;
    const name = record.name.trim();
    if (!name || name.length > GALLERY_ITEM_NAME_MAX || galleryLabelInvalid(record.label)) return null;
    items.push({
      kind,
      name,
      key,
      role: acceptItemRole(kind, record.role),
      label: acceptGalleryLabel(record.label),
    });
  }
  return items;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function storedHandle(row: GalleryRow): string {
  const saved = typeof row.handle === "string" ? row.handle.trim() : "";
  if (saved && acceptGalleryHandle(saved)) return saved;
  return defaultGalleryHandle(row.name);
}

function storedTake(row: GalleryRow): number {
  return acceptGalleryTake(row.take_count) ?? 1;
}

function summaryFromRow(row: GalleryRow): GallerySummary {
  return {
    id: row.id,
    name: row.name,
    handle: storedHandle(row),
    takeCount: storedTake(row),
    updatedAt: row.updated_at,
  };
}

function galleryListStatement(
  db: D1Database,
  userId: string,
  query: string,
  profileId: string | null | undefined,
  columns: string,
) {
  const q = query.trim();
  const profile = profileId ? " AND profile_id = ?" : "";
  return q
    ? db
        .prepare(
          `SELECT ${columns} FROM galleries
           WHERE user_id = ? AND name LIKE ? ESCAPE '\\'${profile}
           ORDER BY updated_at DESC
           LIMIT ?`,
        )
        .bind(
          ...(profileId
            ? [userId, `%${escapeLike(q)}%`, profileId, GALLERY_MAX_ROWS]
            : [userId, `%${escapeLike(q)}%`, GALLERY_MAX_ROWS]),
        )
    : db
        .prepare(
          `SELECT ${columns} FROM galleries
           WHERE user_id = ?${profile}
           ORDER BY updated_at DESC
           LIMIT ?`,
        )
        .bind(...(profileId ? [userId, profileId, GALLERY_MAX_ROWS] : [userId, GALLERY_MAX_ROWS]));
}

export async function listGalleries(
  db: D1Database,
  userId: string,
  query = "",
  profileId?: string | null,
): Promise<GallerySummary[]> {
  try {
    const { results } = await galleryListStatement(
      db,
      userId,
      query,
      profileId,
      "id, name, updated_at, handle, take_count",
    ).all<GalleryRow>();
    return (results ?? []).map(summaryFromRow);
  } catch (err) {
    if (!missingColumn(err)) throw err;
    const { results } = await galleryListStatement(db, userId, query, profileId, "id, name, updated_at").all<
      GalleryRow
    >();
    return (results ?? []).map(summaryFromRow);
  }
}

async function itemRows(
  db: D1Database,
  userId: string,
  galleryId: string,
): Promise<ItemRow[]> {
  const queries = [
    `SELECT id, kind, name, media_key, position, role, label FROM gallery_items
     WHERE gallery_id = ? AND user_id = ?
     ORDER BY position ASC`,
    `SELECT id, kind, name, media_key, position, role FROM gallery_items
     WHERE gallery_id = ? AND user_id = ?
     ORDER BY position ASC`,
    `SELECT id, kind, name, media_key, position FROM gallery_items
     WHERE gallery_id = ? AND user_id = ?
     ORDER BY position ASC`,
  ];
  let last: unknown = null;
  for (const sql of queries) {
    try {
      const { results } = await db.prepare(sql).bind(galleryId, userId).all<ItemRow>();
      return results ?? [];
    } catch (err) {
      if (!missingColumn(err)) throw err;
      last = err;
    }
  }
  throw last;
}

async function itemsForGallery(
  db: D1Database,
  userId: string,
  galleryId: string,
): Promise<StoredGalleryItem[]> {
  const rows = await itemRows(db, userId, galleryId);
  const items: StoredGalleryItem[] = [];
  for (const row of rows) {
    const kind = acceptMediaKind(row.kind);
    if (!kind) continue;
    items.push({
      id: row.id,
      kind,
      name: row.name,
      key: row.media_key,
      position: row.position,
      role: storedRole(kind, row.role),
      label: acceptGalleryLabel(row.label),
    });
  }
  return items;
}

export async function getGallery(
  db: D1Database,
  userId: string,
  id: string,
): Promise<StoredGallery | null> {
  let row: GalleryRow | null = null;
  try {
    row = await db
      .prepare(
        `SELECT id, name, updated_at, handle, take_count, profile_id FROM galleries
         WHERE id = ? AND user_id = ?`,
      )
      .bind(id, userId)
      .first<GalleryRow>();
  } catch (err) {
    if (!missingColumn(err)) throw err;
    row = await db
      .prepare(
        `SELECT id, name, updated_at FROM galleries
         WHERE id = ? AND user_id = ?`,
      )
      .bind(id, userId)
      .first<GalleryRow>();
  }
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    handle: storedHandle(row),
    takeCount: storedTake(row),
    profileId: row.profile_id ?? null,
    updatedAt: row.updated_at,
    items: await itemsForGallery(db, userId, row.id),
  };
}

async function trimGalleries(db: D1Database, userId: string): Promise<void> {
  const { results } = await db
    .prepare(
      `SELECT id FROM galleries
       WHERE user_id = ?
       ORDER BY updated_at DESC`,
    )
    .bind(userId)
    .all<{ id: string }>();
  const extra = (results ?? []).slice(GALLERY_MAX_ROWS);
  for (const row of extra) {
    await db.prepare(`DELETE FROM gallery_items WHERE gallery_id = ? AND user_id = ?`).bind(row.id, userId).run();
    await db.prepare(`DELETE FROM galleries WHERE id = ? AND user_id = ?`).bind(row.id, userId).run();
  }
}

async function replaceItems(
  db: D1Database,
  userId: string,
  galleryId: string,
  items: GalleryItemInput[],
): Promise<StoredGalleryItem[]> {
  await db
    .prepare(`DELETE FROM gallery_items WHERE gallery_id = ? AND user_id = ?`)
    .bind(galleryId, userId)
    .run();
  const stored: StoredGalleryItem[] = [];
  for (let position = 0; position < items.length; position += 1) {
    const item = items[position];
    if (!item) continue;
    const id = crypto.randomUUID();
    try {
      await db
        .prepare(
          `INSERT INTO gallery_items (id, gallery_id, user_id, kind, name, media_key, position, role, label)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, galleryId, userId, item.kind, item.name, item.key, position, item.role, item.label)
        .run();
    } catch (err) {
      if (!missingColumn(err)) throw err;
      try {
        await db
          .prepare(
            `INSERT INTO gallery_items (id, gallery_id, user_id, kind, name, media_key, position, role)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, galleryId, userId, item.kind, item.name, item.key, position, item.role)
          .run();
      } catch (inner) {
        if (!missingColumn(inner)) throw inner;
        await db
          .prepare(
            `INSERT INTO gallery_items (id, gallery_id, user_id, kind, name, media_key, position)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, galleryId, userId, item.kind, item.name, item.key, position)
          .run();
      }
    }
    stored.push({ ...item, id, position });
  }
  return stored;
}

export async function deleteGallery(db: D1Database, userId: string, id: string): Promise<boolean> {
  const existing = await getGallery(db, userId, id);
  if (!existing) return false;
  await db.prepare(`DELETE FROM gallery_items WHERE gallery_id = ? AND user_id = ?`).bind(id, userId).run();
  await db.prepare(`DELETE FROM galleries WHERE id = ? AND user_id = ?`).bind(id, userId).run();
  return true;
}

function chosenHandle(name: string, raw: unknown, existing: string): string {
  if (raw === undefined) return existing || defaultGalleryHandle(name);
  if (typeof raw === "string" && !raw.trim()) return defaultGalleryHandle(name);
  const accepted = acceptGalleryHandle(raw);
  if (!accepted) {
    throw new GalleryRejected(
      "handle",
      "Use a handle of letters and numbers. Image, Video, and Audio are reserved.",
    );
  }
  return accepted;
}

function assertUniqueLabels(items: readonly GalleryItemInput[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.label) continue;
    const key = item.label.toLowerCase();
    if (seen.has(key)) {
      throw new GalleryRejected("label", "Labels in a gallery have to be different.");
    }
    seen.add(key);
  }
}

async function handleTaken(
  db: D1Database,
  userId: string,
  handle: string,
  profileId: string | null,
  exceptId: string,
): Promise<boolean> {
  if (!handle) return false;
  try {
    const { results } = await db
      .prepare(
        `SELECT id FROM galleries
         WHERE user_id = ? AND handle = ? COLLATE NOCASE AND id != ?
           AND IFNULL(profile_id, '') = IFNULL(?, '')
         LIMIT 1`,
      )
      .bind(userId, handle, exceptId, profileId)
      .all<{ id: string }>();
    return (results ?? []).length > 0;
  } catch (err) {
    if (!missingColumn(err)) throw err;
    return false;
  }
}

export async function saveGallery(
  db: D1Database,
  userId: string,
  input: {
    id?: string | null;
    name: unknown;
    items: unknown;
    profileId?: string | null;
    handle?: unknown;
    takeCount?: unknown;
  },
): Promise<StoredGallery | null> {
  const name = acceptGalleryName(input.name);
  const items = acceptGalleryItems(userId, input.items);
  if (!name || !items) return null;
  assertUniqueLabels(items);
  const take = input.takeCount === undefined ? null : acceptGalleryTake(input.takeCount);
  if (input.takeCount !== undefined && take == null) return null;
  const now = Math.floor(Date.now() / 1000);
  const requestedId = typeof input.id === "string" ? input.id.trim() : "";
  if (requestedId) {
    const existing = await getGallery(db, userId, requestedId);
    if (!existing) return null;
    const handle = chosenHandle(name, input.handle, existing.handle);
    const takeCount = take ?? existing.takeCount;
    if (await handleTaken(db, userId, handle, existing.profileId, requestedId)) {
      throw new GalleryRejected("handle", "A gallery on this profile already uses that handle.");
    }
    try {
      await db
        .prepare(
          `UPDATE galleries SET name = ?, handle = ?, take_count = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
        )
        .bind(name, handle || null, takeCount, now, requestedId, userId)
        .run();
    } catch (err) {
      if (!missingColumn(err)) throw err;
      await db
        .prepare(`UPDATE galleries SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
        .bind(name, now, requestedId, userId)
        .run();
    }
    const stored = await replaceItems(db, userId, requestedId, items);
    return {
      id: requestedId,
      name,
      handle,
      takeCount,
      profileId: existing.profileId,
      updatedAt: now,
      items: stored,
    };
  }
  const id = crypto.randomUUID();
  const profileId = typeof input.profileId === "string" ? input.profileId : null;
  const handle = chosenHandle(name, input.handle, "");
  const takeCount = take ?? 1;
  if (await handleTaken(db, userId, handle, profileId, id)) {
    throw new GalleryRejected("handle", "A gallery on this profile already uses that handle.");
  }
  try {
    await db
      .prepare(
        `INSERT INTO galleries (id, user_id, name, created_at, updated_at, profile_id, handle, take_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, userId, name, now, now, profileId, handle || null, takeCount)
      .run();
  } catch (err) {
    if (!missingColumn(err)) throw err;
    try {
      await db
        .prepare(
          `INSERT INTO galleries (id, user_id, name, created_at, updated_at, profile_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, userId, name, now, now, profileId)
        .run();
    } catch (inner) {
      const message = inner instanceof Error ? inner.message : String(inner);
      if (!message.includes("no such column")) throw inner;
      await db
        .prepare(
          `INSERT INTO galleries (id, user_id, name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(id, userId, name, now, now)
        .run();
    }
  }
  const stored = await replaceItems(db, userId, id, items);
  await trimGalleries(db, userId);
  return { id, name, handle, takeCount, profileId, updatedAt: now, items: stored };
}
