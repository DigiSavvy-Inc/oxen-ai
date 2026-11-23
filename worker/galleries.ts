import {
  acceptGalleryHandle,
  acceptGalleryLabel,
  acceptGalleryTake,
  defaultGalleryHandle,
  galleryLabelInvalid,
} from "./gallery-handle";
import { GALLERY_MAX_ITEMS } from "./gallery-limits";
import { GALLERY_CAPTION_MAX, GALLERY_NOTE_MAX, stripGalleryControls } from "./gallery-text";
import { acceptMediaKind, normalizeMediaRole, type MediaKind, type MediaRole } from "./schema";

export { GALLERY_MAX_ITEMS };

export type GalleryKind = MediaKind;

export type GalleryItemInput = {
  kind: GalleryKind;
  name: string;
  key: string;
  role: MediaRole | null;
  label: string | null;
  /**
   * Absent when the request did not send a note, so an update keeps the saved one.
   * Null clears it. A note is for people and is not sent to the model.
   */
  note?: string | null;
};

export class GalleryRejected extends Error {
  readonly code: "handle" | "label" | "caption" | "note";

  constructor(code: "handle" | "label" | "caption" | "note", message: string) {
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
  /** For people. Not sent to the model. */
  caption: string | null;
  profileId: string | null;
  updatedAt: number;
  items: StoredGalleryItem[];
};

export type GallerySummary = {
  id: string;
  name: string;
  handle: string;
  takeCount: number;
  caption: string | null;
  updatedAt: number;
  /** The collection this gallery is filed in, or null when ungrouped or collections are not installed. */
  collectionId: string | null;
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
  collection_id?: string | null;
  caption?: string | null;
};

type ItemRow = {
  id: string;
  kind: string;
  name: string;
  media_key: string;
  position: number;
  role?: string | null;
  label?: string | null;
  note?: string | null;
};

export function acceptGalleryName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name || name.length > GALLERY_NAME_MAX) return null;
  return name;
}

function peopleText(raw: unknown, max: number, kind: "caption" | "note"): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") {
    throw new GalleryRejected(kind, kind === "caption" ? "A caption has to be text." : "A note has to be text.");
  }
  const text = stripGalleryControls(raw).trim();
  if (!text) return null;
  if (text.length > max) {
    throw new GalleryRejected(
      kind,
      kind === "caption"
        ? `A caption can be up to ${GALLERY_CAPTION_MAX} characters.`
        : `A note can be up to ${GALLERY_NOTE_MAX} characters.`,
    );
  }
  return text;
}

/** Trimmed caption, or null when it is empty. Over-length and non-text are refused, not cut down. */
export function acceptGalleryCaption(raw: unknown): string | null {
  return peopleText(raw, GALLERY_CAPTION_MAX, "caption");
}

/** Trimmed note, or null when it is empty. Over-length and non-text are refused, not cut down. */
export function acceptGalleryNote(raw: unknown): string | null {
  return peopleText(raw, GALLERY_NOTE_MAX, "note");
}

function storedPeopleText(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const text = stripGalleryControls(raw).trim();
  return text || null;
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
  // D1 says "no such column: caption". node:sqlite says "no column named caption".
  return message.includes("no such column") || message.includes("no column named");
}

export function acceptGalleryItems(userId: string, raw: unknown): GalleryItemInput[] | null {
  if (!Array.isArray(raw) || raw.length > GALLERY_MAX_ITEMS) return null;
  const items: GalleryItemInput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const record = entry as {
      kind?: unknown;
      name?: unknown;
      key?: unknown;
      role?: unknown;
      label?: unknown;
      note?: unknown;
    };
    const kind = acceptMediaKind(record.kind);
    const key = ownedMediaKey(userId, record.key);
    if (!kind || typeof record.name !== "string" || !key) return null;
    const name = record.name.trim();
    if (!name || name.length > GALLERY_ITEM_NAME_MAX || galleryLabelInvalid(record.label)) return null;
    const item: GalleryItemInput = {
      kind,
      name,
      key,
      role: acceptItemRole(kind, record.role),
      label: acceptGalleryLabel(record.label),
    };
    // Absent means "leave the saved note". Null or blank clears it.
    if ("note" in record) item.note = acceptGalleryNote(record.note);
    items.push(item);
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
    caption: storedPeopleText(row.caption),
    updatedAt: row.updated_at,
    collectionId: typeof row.collection_id === "string" && row.collection_id ? row.collection_id : null,
  };
}

function galleryListStatement(
  db: D1Database,
  userId: string,
  query: string,
  profileId: string | null | undefined,
  columns: string,
  /** Also match the caption and any item note. Off once those columns are missing. */
  rich: boolean,
) {
  const q = query.trim();
  const profile = profileId ? " AND profile_id = ?" : "";
  if (!q) {
    return db
      .prepare(
        `SELECT ${columns} FROM galleries
         WHERE user_id = ?${profile}
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .bind(...(profileId ? [userId, profileId, GALLERY_MAX_ROWS] : [userId, GALLERY_MAX_ROWS]));
  }
  const pattern = `%${escapeLike(q)}%`;
  if (rich) {
    return db
      .prepare(
        `SELECT ${columns} FROM galleries
         WHERE user_id = ? AND (
           name LIKE ? ESCAPE '\\'
           OR IFNULL(caption, '') LIKE ? ESCAPE '\\'
           OR id IN (
             SELECT gallery_id FROM gallery_items
             WHERE user_id = ? AND IFNULL(note, '') LIKE ? ESCAPE '\\'
           )
         )${profile}
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .bind(
        ...(profileId
          ? [userId, pattern, pattern, userId, pattern, profileId, GALLERY_MAX_ROWS]
          : [userId, pattern, pattern, userId, pattern, GALLERY_MAX_ROWS]),
      );
  }
  return db
    .prepare(
      `SELECT ${columns} FROM galleries
       WHERE user_id = ? AND name LIKE ? ESCAPE '\\'${profile}
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .bind(
      ...(profileId
        ? [userId, pattern, profileId, GALLERY_MAX_ROWS]
        : [userId, pattern, GALLERY_MAX_ROWS]),
    );
}

export async function listGalleries(
  db: D1Database,
  userId: string,
  query = "",
  profileId?: string | null,
): Promise<GallerySummary[]> {
  // Newest columns first; a database without a later migration falls back a step at a time.
  const columnSets = [
    "id, name, updated_at, handle, take_count, collection_id, caption",
    "id, name, updated_at, handle, take_count, collection_id",
    "id, name, updated_at, handle, take_count",
    "id, name, updated_at",
  ];
  let rich = true;
  let last: unknown = null;
  for (const columns of columnSets) {
    try {
      const { results } = await galleryListStatement(db, userId, query, profileId, columns, rich).all<GalleryRow>();
      return (results ?? []).map(summaryFromRow);
    } catch (err) {
      if (!missingColumn(err)) throw err;
      rich = false;
      last = err;
    }
  }
  throw last;
}

async function itemRows(
  db: D1Database,
  userId: string,
  galleryId: string,
): Promise<ItemRow[]> {
  const queries = [
    `SELECT id, kind, name, media_key, position, role, label, note FROM gallery_items
     WHERE gallery_id = ? AND user_id = ?
     ORDER BY position ASC`,
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

function storedItem(row: ItemRow): StoredGalleryItem | null {
  const kind = acceptMediaKind(row.kind);
  if (!kind) return null;
  return {
    id: row.id,
    kind,
    name: row.name,
    key: row.media_key,
    position: row.position,
    role: storedRole(kind, row.role),
    label: acceptGalleryLabel(row.label),
    note: storedPeopleText(row.note),
  };
}

async function itemsForGallery(
  db: D1Database,
  userId: string,
  galleryId: string,
): Promise<StoredGalleryItem[]> {
  const rows = await itemRows(db, userId, galleryId);
  const items: StoredGalleryItem[] = [];
  for (const row of rows) {
    const item = storedItem(row);
    if (item) items.push(item);
  }
  return items;
}

/**
 * D1 allows 100 bound parameters on a statement, and one Worker invocation can keep only
 * six D1 calls in flight. The list used to open two queries per gallery at the same time,
 * so a profile with more than a handful of galleries was refused and the list never arrived.
 * One user id plus these ids stays under the parameter cap.
 */
const GALLERY_ID_CHUNK = 90;

const ITEM_LIST_COLUMNS = [
  "id, gallery_id, kind, name, media_key, position, role, label, note",
  "id, gallery_id, kind, name, media_key, position, role, label",
  "id, gallery_id, kind, name, media_key, position, role",
  "id, gallery_id, kind, name, media_key, position",
];

/** Every item of these galleries, in saved order, read a chunk at a time. */
export async function itemsForGalleries(
  db: D1Database,
  userId: string,
  galleryIds: readonly string[],
): Promise<Map<string, StoredGalleryItem[]>> {
  const map = new Map<string, StoredGalleryItem[]>();
  const unique = [...new Set(galleryIds.filter(Boolean))];
  if (unique.length === 0) return map;
  let shape = 0;
  for (let offset = 0; offset < unique.length; ) {
    const chunk = unique.slice(offset, offset + GALLERY_ID_CHUNK);
    const marks = chunk.map(() => "?").join(", ");
    const columns = ITEM_LIST_COLUMNS[shape] ?? ITEM_LIST_COLUMNS[ITEM_LIST_COLUMNS.length - 1];
    try {
      const { results } = await db
        .prepare(
          `SELECT ${columns} FROM gallery_items
           WHERE user_id = ? AND gallery_id IN (${marks})
           ORDER BY position ASC`,
        )
        .bind(userId, ...chunk)
        .all<ItemRow & { gallery_id: string }>();
      for (const row of results ?? []) {
        const item = storedItem(row);
        if (!item || !row.gallery_id) continue;
        const list = map.get(row.gallery_id);
        if (list) list.push(item);
        else map.set(row.gallery_id, [item]);
      }
      offset += chunk.length;
    } catch (err) {
      if (!missingColumn(err) || shape >= ITEM_LIST_COLUMNS.length - 1) throw err;
      shape += 1;
      map.clear();
      offset = 0;
    }
  }
  return map;
}

export async function getGallery(
  db: D1Database,
  userId: string,
  id: string,
): Promise<StoredGallery | null> {
  const queries = [
    `SELECT id, name, updated_at, handle, take_count, profile_id, caption FROM galleries
     WHERE id = ? AND user_id = ?`,
    `SELECT id, name, updated_at, handle, take_count, profile_id FROM galleries
     WHERE id = ? AND user_id = ?`,
    `SELECT id, name, updated_at FROM galleries
     WHERE id = ? AND user_id = ?`,
  ];
  let row: GalleryRow | null = null;
  let last: unknown = null;
  for (const sql of queries) {
    try {
      row = await db.prepare(sql).bind(id, userId).first<GalleryRow>();
      last = null;
      break;
    } catch (err) {
      if (!missingColumn(err)) throw err;
      last = err;
    }
  }
  if (last) throw last;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    handle: storedHandle(row),
    takeCount: storedTake(row),
    caption: storedPeopleText(row.caption),
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

type ItemWriteShape = "note" | "label" | "role" | "plain";

function insertItem(
  db: D1Database,
  shape: ItemWriteShape,
  row: StoredGalleryItem,
  galleryId: string,
  userId: string,
): D1PreparedStatement {
  switch (shape) {
    case "note":
      return db
        .prepare(
          `INSERT INTO gallery_items (id, gallery_id, user_id, kind, name, media_key, position, role, label, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.id,
          galleryId,
          userId,
          row.kind,
          row.name,
          row.key,
          row.position,
          row.role,
          row.label,
          row.note ?? null,
        );
    case "label":
      return db
        .prepare(
          `INSERT INTO gallery_items (id, gallery_id, user_id, kind, name, media_key, position, role, label)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(row.id, galleryId, userId, row.kind, row.name, row.key, row.position, row.role, row.label);
    case "role":
      return db
        .prepare(
          `INSERT INTO gallery_items (id, gallery_id, user_id, kind, name, media_key, position, role)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(row.id, galleryId, userId, row.kind, row.name, row.key, row.position, row.role);
    case "plain":
      return db
        .prepare(
          `INSERT INTO gallery_items (id, gallery_id, user_id, kind, name, media_key, position)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(row.id, galleryId, userId, row.kind, row.name, row.key, row.position);
    default: {
      const _never: never = shape;
      return _never;
    }
  }
}

/**
 * Replaces every item row. One `batch()` is one D1 round trip: a gallery save rewrites the
 * whole set (up to 96), and awaiting each insert on its own made that wait on ~100 requests.
 * A database from before role or label was added retries the same batch with fewer columns.
 * The batch is one transaction, so a failed shape leaves the previous rows in place.
 */
async function replaceItems(
  db: D1Database,
  userId: string,
  galleryId: string,
  items: GalleryItemInput[],
): Promise<StoredGalleryItem[]> {
  const stored: StoredGalleryItem[] = items.map((item, position) => ({
    ...item,
    id: crypto.randomUUID(),
    position,
  }));
  const rewrite = (shape: ItemWriteShape) =>
    db.batch([
      db.prepare(`DELETE FROM gallery_items WHERE gallery_id = ? AND user_id = ?`).bind(galleryId, userId),
      ...stored.map((row) => insertItem(db, shape, row, galleryId, userId)),
    ]);
  try {
    await rewrite("note");
  } catch (err) {
    if (!missingColumn(err)) throw err;
    try {
      await rewrite("label");
    } catch (inner) {
      if (!missingColumn(inner)) throw inner;
      try {
        await rewrite("role");
      } catch (older) {
        if (!missingColumn(older)) throw older;
        await rewrite("plain");
      }
    }
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

export async function galleryHandleTaken(
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

/** An Everywhere slot uses this handle. Missing table means slots are not installed yet. */
async function everywhereSlotHandleTaken(
  db: D1Database,
  userId: string,
  handle: string,
  profileId: string | null,
): Promise<boolean> {
  if (!handle) return false;
  try {
    const { results } = await db
      .prepare(
        `SELECT id FROM slots
         WHERE user_id = ? AND project_id IS NULL AND handle = ? COLLATE NOCASE
           AND IFNULL(profile_id, '') = IFNULL(?, '')
         LIMIT 1`,
      )
      .bind(userId, handle, profileId)
      .all<{ id: string }>();
    return (results ?? []).length > 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("no such table") || message.includes("no such column")) return false;
    throw err;
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
    /** Absent on an update keeps the saved caption. Null or blank clears it. */
    caption?: unknown;
    /** Store no handle. Used when the wanted handle is already a gallery or an Everywhere slot. */
    forceEmptyHandle?: boolean;
  },
): Promise<StoredGallery | null> {
  const name = acceptGalleryName(input.name);
  const accepted = acceptGalleryItems(userId, input.items);
  if (!name || !accepted) return null;
  assertUniqueLabels(accepted);
  const take = input.takeCount === undefined ? null : acceptGalleryTake(input.takeCount);
  if (input.takeCount !== undefined && take == null) return null;
  const now = Math.floor(Date.now() / 1000);
  const requestedId = typeof input.id === "string" ? input.id.trim() : "";
  if (requestedId) {
    const existing = await getGallery(db, userId, requestedId);
    if (!existing) return null;
    const items = notesForSave(accepted, existing.items);
    const caption = input.caption === undefined ? existing.caption : acceptGalleryCaption(input.caption);
    const handle = input.forceEmptyHandle ? "" : chosenHandle(name, input.handle, existing.handle);
    const takeCount = take ?? existing.takeCount;
    // A gallery saved from a slot, or one older than handles, shows a handle made from its
    // name without owning it. Saving it again with that same handle keeps it unowned.
    const unchanged = handle.toLowerCase() === existing.handle.toLowerCase();
    let owned = !input.forceEmptyHandle;
    if (owned && (await galleryHandleTaken(db, userId, handle, existing.profileId, requestedId))) {
      if (!unchanged) throw new GalleryRejected("handle", "A gallery on this profile already uses that handle.");
      owned = false;
    }
    if (owned && (await everywhereSlotHandleTaken(db, userId, handle, existing.profileId))) {
      if (!unchanged) throw new GalleryRejected("handle", "A slot on this profile already uses that handle.");
      owned = false;
    }
    try {
      await db
        .prepare(
          `UPDATE galleries SET name = ?, caption = ?, handle = ?, take_count = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
        )
        .bind(name, caption, owned && handle ? handle : null, takeCount, now, requestedId, userId)
        .run();
    } catch (err) {
      if (!missingColumn(err)) throw err;
      try {
        await db
          .prepare(
            `UPDATE galleries SET name = ?, handle = ?, take_count = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
          )
          .bind(name, owned && handle ? handle : null, takeCount, now, requestedId, userId)
          .run();
      } catch (inner) {
        if (!missingColumn(inner)) throw inner;
        await db
          .prepare(`UPDATE galleries SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
          .bind(name, now, requestedId, userId)
          .run();
      }
    }
    const stored = await replaceItems(db, userId, requestedId, items);
    return {
      id: requestedId,
      name,
      handle,
      takeCount,
      caption,
      profileId: existing.profileId,
      updatedAt: now,
      items: stored,
    };
  }
  const id = crypto.randomUUID();
  const items = notesForSave(accepted, null);
  const caption = input.caption === undefined ? null : acceptGalleryCaption(input.caption);
  const profileId = typeof input.profileId === "string" ? input.profileId : null;
  const handle = input.forceEmptyHandle ? "" : chosenHandle(name, input.handle, "");
  const takeCount = take ?? 1;
  if (!input.forceEmptyHandle && (await galleryHandleTaken(db, userId, handle, profileId, id))) {
    throw new GalleryRejected("handle", "A gallery on this profile already uses that handle.");
  }
  if (!input.forceEmptyHandle && (await everywhereSlotHandleTaken(db, userId, handle, profileId))) {
    throw new GalleryRejected("handle", "A slot on this profile already uses that handle.");
  }
  try {
    await db
      .prepare(
        `INSERT INTO galleries (id, user_id, name, created_at, updated_at, profile_id, handle, take_count, caption)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, userId, name, now, now, profileId, handle || null, takeCount, caption)
      .run();
  } catch (err) {
    if (!missingColumn(err)) throw err;
    try {
      await db
        .prepare(
          `INSERT INTO galleries (id, user_id, name, created_at, updated_at, profile_id, handle, take_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, userId, name, now, now, profileId, handle || null, takeCount)
        .run();
    } catch (inner) {
      if (!missingColumn(inner)) throw inner;
      try {
        await db
          .prepare(
            `INSERT INTO galleries (id, user_id, name, created_at, updated_at, profile_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(id, userId, name, now, now, profileId)
          .run();
      } catch (older) {
        if (!missingColumn(older)) throw older;
        await db
          .prepare(
            `INSERT INTO galleries (id, user_id, name, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(id, userId, name, now, now)
          .run();
      }
    }
  }
  const stored = await replaceItems(db, userId, id, items);
  await trimGalleries(db, userId);
  return { id, name, handle, takeCount, caption, profileId, updatedAt: now, items: stored };
}

/** A missing note keeps the one already stored for that file. A sent note replaces it. */
function notesForSave(
  items: readonly GalleryItemInput[],
  existing: readonly StoredGalleryItem[] | null,
): GalleryItemInput[] {
  const kept = new Map((existing ?? []).map((item) => [item.key, item.note ?? null]));
  return items.map((item) => ({
    ...item,
    note: item.note === undefined ? (kept.get(item.key) ?? null) : item.note,
  }));
}
