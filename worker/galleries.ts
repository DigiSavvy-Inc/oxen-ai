export type GalleryKind = "image" | "video" | "audio";

export type GalleryItemInput = {
  kind: GalleryKind;
  name: string;
  key: string;
};

export type StoredGalleryItem = GalleryItemInput & {
  id: string;
  position: number;
};

export type StoredGallery = {
  id: string;
  name: string;
  updatedAt: number;
  items: StoredGalleryItem[];
};

export type GallerySummary = {
  id: string;
  name: string;
  updatedAt: number;
};

export const GALLERY_NAME_MAX = 80;
export const GALLERY_ITEM_NAME_MAX = 180;
export const GALLERY_MAX_ITEMS = 24;
export const GALLERY_MAX_ROWS = 100;

type GalleryRow = {
  id: string;
  name: string;
  updated_at: number;
};

type ItemRow = {
  id: string;
  kind: string;
  name: string;
  media_key: string;
  position: number;
};

export function acceptGalleryName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name || name.length > GALLERY_NAME_MAX) return null;
  return name;
}

export function galleryKeyForUser(userId: string, raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!userId || raw.length > 512) return null;
  if (raw.includes("..") || raw.includes("\\") || raw.includes("\0")) return null;
  const prefix = `u/${userId}/`;
  if (!raw.startsWith(prefix)) return null;
  return raw;
}

function acceptKind(raw: unknown): GalleryKind | null {
  switch (raw) {
    case "image":
    case "video":
    case "audio":
      return raw;
    default:
      return null;
  }
}

export function acceptGalleryItems(userId: string, raw: unknown): GalleryItemInput[] | null {
  if (!Array.isArray(raw) || raw.length > GALLERY_MAX_ITEMS) return null;
  const items: GalleryItemInput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const record = entry as { kind?: unknown; name?: unknown; key?: unknown };
    const kind = acceptKind(record.kind);
    const key = galleryKeyForUser(userId, record.key);
    if (!kind || typeof record.name !== "string" || !key) return null;
    const name = record.name.trim();
    if (!name || name.length > GALLERY_ITEM_NAME_MAX) return null;
    items.push({ kind, name, key });
  }
  return items;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export async function listGalleries(
  db: D1Database,
  userId: string,
  query = "",
): Promise<GallerySummary[]> {
  const q = query.trim();
  const statement = q
    ? db
        .prepare(
          `SELECT id, name, updated_at FROM galleries
           WHERE user_id = ? AND name LIKE ? ESCAPE '\\'
           ORDER BY updated_at DESC
           LIMIT ?`,
        )
        .bind(userId, `%${escapeLike(q)}%`, GALLERY_MAX_ROWS)
    : db
        .prepare(
          `SELECT id, name, updated_at FROM galleries
           WHERE user_id = ?
           ORDER BY updated_at DESC
           LIMIT ?`,
        )
        .bind(userId, GALLERY_MAX_ROWS);
  const { results } = await statement.all<GalleryRow>();
  return (results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
  }));
}

async function itemsForGallery(
  db: D1Database,
  userId: string,
  galleryId: string,
): Promise<StoredGalleryItem[]> {
  const { results } = await db
    .prepare(
      `SELECT id, kind, name, media_key, position FROM gallery_items
       WHERE gallery_id = ? AND user_id = ?
       ORDER BY position ASC`,
    )
    .bind(galleryId, userId)
    .all<ItemRow>();
  const items: StoredGalleryItem[] = [];
  for (const row of results ?? []) {
    const kind = acceptKind(row.kind);
    if (!kind) continue;
    items.push({
      id: row.id,
      kind,
      name: row.name,
      key: row.media_key,
      position: row.position,
    });
  }
  return items;
}

export async function getGallery(
  db: D1Database,
  userId: string,
  id: string,
): Promise<StoredGallery | null> {
  const row = await db
    .prepare(
      `SELECT id, name, updated_at FROM galleries
       WHERE id = ? AND user_id = ?`,
    )
    .bind(id, userId)
    .first<GalleryRow>();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
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
    await db
      .prepare(
        `INSERT INTO gallery_items (id, gallery_id, user_id, kind, name, media_key, position)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, galleryId, userId, item.kind, item.name, item.key, position)
      .run();
    stored.push({ ...item, id, position });
  }
  return stored;
}

export async function saveGallery(
  db: D1Database,
  userId: string,
  input: { id?: string | null; name: unknown; items: unknown },
): Promise<StoredGallery | null> {
  const name = acceptGalleryName(input.name);
  const items = acceptGalleryItems(userId, input.items);
  if (!name || !items) return null;
  const now = Math.floor(Date.now() / 1000);
  const requestedId = typeof input.id === "string" ? input.id.trim() : "";
  if (requestedId) {
    const existing = await getGallery(db, userId, requestedId);
    if (!existing) return null;
    await db
      .prepare(`UPDATE galleries SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
      .bind(name, now, requestedId, userId)
      .run();
    const stored = await replaceItems(db, userId, requestedId, items);
    return { id: requestedId, name, updatedAt: now, items: stored };
  }
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO galleries (id, user_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, name, now, now)
    .run();
  const stored = await replaceItems(db, userId, id, items);
  await trimGalleries(db, userId);
  return { id, name, updatedAt: now, items: stored };
}
