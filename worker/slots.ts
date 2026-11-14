import {
  acceptGalleryHandle,
  acceptGalleryLabel,
  acceptGalleryTake,
  defaultGalleryHandle,
  galleryLabelInvalid,
} from "./gallery-handle";
import { GALLERY_MAX_ITEMS } from "./gallery-limits";
import { thumbKeyByResult } from "./gallery-present";
import {
  acceptGalleryName,
  galleryHandleTaken,
  getGallery,
  ownedMediaKey,
  saveGallery,
  type GalleryItemInput,
} from "./galleries";
import { displayStoredMediaUrl } from "./media";
import { acceptMediaKind, normalizeMediaRole, type MediaKind, type MediaRole } from "./schema";
import type { Env } from "./types";

/** Slots on one profile, including ones kept to a single project. */
export const SLOT_PROFILE_MAX = 200;
/** Files a slot stores itself. A linked gallery is not counted here. */
export const SLOT_FILES_MAX = 12;
export const SLOT_NOTE_MAX = 2000;
export const SLOT_NAME_MAX = 80;

export class SlotRejected extends Error {
  readonly code: "handle" | "label" | "note" | "limit" | "file" | "name";

  constructor(code: SlotRejected["code"], message: string) {
    super(message);
    this.name = "SlotRejected";
    this.code = code;
  }
}

export type SlotFileInput = {
  kind: MediaKind;
  name: string;
  key: string;
  label: string | null;
  role: MediaRole | null;
};

export type SlotFileJson = SlotFileInput & {
  id: string;
  url: string | null;
  thumbUrl: string | null;
};

export type SlotJson = {
  id: string;
  name: string;
  handle: string;
  /** How many of this slot's files a mention attaches, from 1 to 4. */
  take: number;
  note: string;
  /** Null means the slot works in every project and with no project open. */
  projectId: string | null;
  galleryId: string | null;
  galleryName: string | null;
  position: number;
  files: SlotFileJson[];
};

type SlotRow = {
  id: string;
  user_id: string;
  profile_id: string | null;
  project_id: string | null;
  name: string;
  handle: string;
  take_count: number;
  note: string;
  gallery_id: string | null;
  position: number;
};

type FileRow = {
  id: string;
  slot_id: string;
  kind: string;
  name: string;
  media_key: string;
  label: string | null;
  role: string | null;
  position: number;
};

function missingTable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("no such table") || message.includes("no such column");
}

export function acceptSlotName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name || name.length > SLOT_NAME_MAX) return null;
  return name;
}

/** Empty is allowed. A note that contains @ is rejected so mentions cannot nest. */
export function acceptSlotNote(raw: unknown): string {
  if (raw == null || raw === "") return "";
  if (typeof raw !== "string") {
    throw new SlotRejected("note", "A note can be up to 2000 characters.");
  }
  const note = raw.trim();
  if (!note) return "";
  if (note.includes("@")) throw new SlotRejected("note", "A note can’t contain @.");
  if (note.length > SLOT_NOTE_MAX) throw new SlotRejected("note", "A note can be up to 2000 characters.");
  return note;
}

function acceptHandle(raw: unknown, name: string): string {
  if (raw === undefined || (typeof raw === "string" && !raw.trim())) {
    const fallback = defaultGalleryHandle(name);
    if (!fallback) {
      throw new SlotRejected("handle", "Use a handle of letters and numbers. Image, Video, and Audio are reserved.");
    }
    return fallback;
  }
  const handle = acceptGalleryHandle(raw);
  if (!handle) {
    throw new SlotRejected("handle", "Use a handle of letters and numbers. Image, Video, and Audio are reserved.");
  }
  return handle;
}

/**
 * Files one append request may offer: a full library page of groups with four outputs each.
 * Only what fits under SLOT_FILES_MAX is kept.
 */
export const SLOT_APPEND_MAX = 400;

export function acceptSlotFiles(userId: string, raw: unknown, max = SLOT_FILES_MAX): SlotFileInput[] {
  if (!Array.isArray(raw)) throw new SlotRejected("file", "A slot’s files have to be a list.");
  if (raw.length > max) {
    throw new SlotRejected("limit", max === SLOT_FILES_MAX ? "A slot holds 12 files." : `Add up to ${max} files at once.`);
  }
  const files: SlotFileInput[] = [];
  const labels = new Set<string>();
  const keys = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") throw new SlotRejected("file", "A slot can only hold files you own.");
    const record = entry as { kind?: unknown; name?: unknown; key?: unknown; role?: unknown; label?: unknown };
    const kind = acceptMediaKind(record.kind);
    const key = ownedMediaKey(userId, record.key);
    if (!kind || typeof record.name !== "string" || !key) {
      throw new SlotRejected("file", "A slot can only hold files you own.");
    }
    const name = record.name.trim();
    if (!name || name.length > 180) throw new SlotRejected("file", "A slot can only hold files you own.");
    if (galleryLabelInvalid(record.label)) {
      throw new SlotRejected("label", "Use a label of letters and numbers, up to 24.");
    }
    const label = acceptGalleryLabel(record.label);
    if (label) {
      const mark = label.toLowerCase();
      if (labels.has(mark)) throw new SlotRejected("label", "Labels in a slot have to be different.");
      labels.add(mark);
    }
    if (keys.has(key)) continue;
    keys.add(key);
    files.push({
      kind,
      name,
      key,
      label,
      role: kind === "audio" ? null : normalizeMediaRole(typeof record.role === "string" ? record.role : null),
    });
  }
  return files;
}

async function profileSlotCount(db: D1Database, userId: string, profileId: string | null): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM slots
       WHERE user_id = ? AND IFNULL(profile_id, '') = IFNULL(?, '')`,
    )
    .bind(userId, profileId)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
}

async function projectHandleTaken(
  db: D1Database,
  projectId: string,
  handle: string,
  exceptId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM slots
       WHERE project_id = ? AND handle = ? COLLATE NOCASE AND id != ?
       LIMIT 1`,
    )
    .bind(projectId, handle, exceptId)
    .first<{ id: string }>();
  return Boolean(row);
}

/** An Everywhere slot already uses this handle on the profile. */
export async function everywhereSlotHandleTaken(
  db: D1Database,
  userId: string,
  handle: string,
  profileId: string | null,
  exceptId = "",
): Promise<boolean> {
  if (!handle) return false;
  try {
    const row = await db
      .prepare(
        `SELECT id FROM slots
         WHERE user_id = ? AND project_id IS NULL AND handle = ? COLLATE NOCASE
           AND IFNULL(profile_id, '') = IFNULL(?, '') AND id != ?
         LIMIT 1`,
      )
      .bind(userId, handle, profileId, exceptId)
      .first<{ id: string }>();
    return Boolean(row);
  } catch (err) {
    if (missingTable(err)) return false;
    throw err;
  }
}

async function assertHandleFree(
  db: D1Database,
  userId: string,
  profileId: string | null,
  projectId: string | null,
  handle: string,
  exceptId: string,
): Promise<void> {
  if (projectId) {
    if (await projectHandleTaken(db, projectId, handle, exceptId)) {
      throw new SlotRejected("handle", "A slot in this project already uses that handle.");
    }
    return;
  }
  if (await everywhereSlotHandleTaken(db, userId, handle, profileId, exceptId)) {
    throw new SlotRejected("handle", "A slot on this profile already uses that handle.");
  }
  if (await galleryHandleTaken(db, userId, handle, profileId, exceptId)) {
    throw new SlotRejected("handle", "A gallery on this profile already uses that handle.");
  }
}

async function ownedProjectProfile(
  db: D1Database,
  userId: string,
  projectId: string,
): Promise<string | null> {
  const row = await db
    .prepare(`SELECT profile_id FROM projects WHERE id = ? AND user_id = ?`)
    .bind(projectId, userId)
    .first<{ profile_id: string | null }>();
  if (!row) throw new SlotRejected("name", "That project isn’t on this profile.");
  return row.profile_id;
}

function acceptProjectId(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new SlotRejected("name", "That project isn’t on this profile.");
  }
  return raw.trim();
}

async function slotRow(db: D1Database, userId: string, id: string): Promise<SlotRow | null> {
  return db
    .prepare(
      `SELECT id, user_id, profile_id, project_id, name, handle, take_count, note, gallery_id, position
       FROM slots WHERE id = ? AND user_id = ?`,
    )
    .bind(id, userId)
    .first<SlotRow>();
}

async function fileRows(db: D1Database, userId: string, slotIds: string[]): Promise<FileRow[]> {
  if (slotIds.length === 0) return [];
  const rows: FileRow[] = [];
  for (let offset = 0; offset < slotIds.length; offset += 40) {
    const chunk = slotIds.slice(offset, offset + 40);
    const marks = chunk.map(() => "?").join(", ");
    const { results } = await db
      .prepare(
        `SELECT id, slot_id, kind, name, media_key, label, role, position FROM slot_files
         WHERE user_id = ? AND slot_id IN (${marks})
         ORDER BY position ASC`,
      )
      .bind(userId, ...chunk)
      .all<FileRow>();
    rows.push(...(results ?? []));
  }
  return rows;
}

async function replaceFiles(db: D1Database, userId: string, slotId: string, files: SlotFileInput[]): Promise<void> {
  await db.prepare(`DELETE FROM slot_files WHERE slot_id = ? AND user_id = ?`).bind(slotId, userId).run();
  for (let position = 0; position < files.length; position += 1) {
    const file = files[position];
    if (!file) continue;
    await db
      .prepare(
        `INSERT INTO slot_files (id, slot_id, user_id, kind, name, media_key, label, role, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        slotId,
        userId,
        file.kind,
        file.name,
        file.key,
        file.label,
        file.role,
        position,
      )
      .run();
  }
}

function storedRole(kind: string, raw: string | null): MediaRole | null {
  if (kind === "audio") return null;
  if (!raw?.trim()) return null;
  return normalizeMediaRole(raw);
}

async function signFiles(
  env: Env,
  userId: string,
  rows: FileRow[],
): Promise<Map<string, SlotFileJson>> {
  const thumbs = await thumbKeyByResult(
    env.DB,
    userId,
    rows.map((row) => row.media_key),
  );
  const signed = new Map<string, SlotFileJson>();
  await Promise.all(
    rows.map(async (row) => {
      const kind = acceptMediaKind(row.kind);
      if (!kind) return;
      const thumbKey = thumbs.get(row.media_key) ?? null;
      const previewKey = kind === "image" ? thumbKey || row.media_key : thumbKey;
      const [url, thumbUrl] = await Promise.all([
        displayStoredMediaUrl(env, row.media_key, null),
        previewKey ? displayStoredMediaUrl(env, previewKey, null) : Promise.resolve(null),
      ]);
      signed.set(row.id, {
        id: row.id,
        kind,
        name: row.name,
        key: row.media_key,
        label: row.label,
        role: storedRole(kind, row.role),
        url,
        thumbUrl,
      });
    }),
  );
  return signed;
}

export async function listSlots(env: Env, userId: string, profileId: string | null): Promise<SlotJson[]> {
  let rows: SlotRow[] = [];
  try {
    const { results } = await env.DB
      .prepare(
        `SELECT id, user_id, profile_id, project_id, name, handle, take_count, note, gallery_id, position
         FROM slots
         WHERE user_id = ? AND IFNULL(profile_id, '') = IFNULL(?, '')
         ORDER BY project_id IS NULL, project_id, position ASC`,
      )
      .bind(userId, profileId)
      .all<SlotRow>();
    rows = results ?? [];
  } catch (err) {
    if (missingTable(err)) return [];
    throw err;
  }
  return presentSlots(env, userId, rows);
}

async function presentSlots(env: Env, userId: string, rows: SlotRow[]): Promise<SlotJson[]> {
  const own = await fileRows(
    env.DB,
    userId,
    rows.filter((row) => !row.gallery_id).map((row) => row.id),
  );
  const signed = await signFiles(env, userId, own);
  const bySlot = new Map<string, SlotFileJson[]>();
  for (const file of own) {
    const json = signed.get(file.id);
    if (!json) continue;
    const list = bySlot.get(file.slot_id) ?? [];
    list.push(json);
    bySlot.set(file.slot_id, list);
  }
  const galleryIds = [...new Set(rows.flatMap((row) => (row.gallery_id ? [row.gallery_id] : [])))];
  const galleries = new Map<string, Awaited<ReturnType<typeof getGallery>>>();
  await Promise.all(
    galleryIds.map(async (id) => {
      galleries.set(id, await getGallery(env.DB, userId, id));
    }),
  );
  const linkedRows: FileRow[] = [];
  for (const gallery of galleries.values()) {
    if (!gallery) continue;
    gallery.items.forEach((item, position) => {
      linkedRows.push({
        id: item.id,
        slot_id: gallery.id,
        kind: item.kind,
        name: item.name,
        media_key: item.key,
        label: item.label,
        role: item.role,
        position,
      });
    });
  }
  const linkedSigned = await signFiles(env, userId, linkedRows);
  const linkedByGallery = new Map<string, SlotFileJson[]>();
  for (const row of linkedRows) {
    const json = linkedSigned.get(row.id);
    if (!json) continue;
    const list = linkedByGallery.get(row.slot_id) ?? [];
    list.push(json);
    linkedByGallery.set(row.slot_id, list);
  }
  return rows.map((row) => {
    // A gallery that was deleted leaves the slot with its name and note and no files.
    const gallery = row.gallery_id ? (galleries.get(row.gallery_id) ?? null) : null;
    const files = gallery ? (linkedByGallery.get(gallery.id) ?? []) : (bySlot.get(row.id) ?? []);
    return {
      id: row.id,
      name: row.name,
      handle: row.handle,
      take: acceptGalleryTake(row.take_count) ?? 1,
      note: row.note ?? "",
      projectId: row.project_id,
      galleryId: gallery?.id ?? null,
      galleryName: gallery?.name ?? null,
      position: row.position,
      files,
    };
  });
}

export async function projectSlotHandles(db: D1Database, userId: string, projectId: string): Promise<string[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT handle FROM slots WHERE user_id = ? AND project_id = ? ORDER BY position ASC`,
      )
      .bind(userId, projectId)
      .all<{ handle: string }>();
    return (results ?? []).map((row) => row.handle).filter(Boolean);
  } catch (err) {
    if (missingTable(err)) return [];
    throw err;
  }
}

async function nextPosition(db: D1Database, userId: string, profileId: string | null): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(MAX(position), -1) AS n FROM slots
       WHERE user_id = ? AND IFNULL(profile_id, '') = IFNULL(?, '')`,
    )
    .bind(userId, profileId)
    .first<{ n: number }>();
  return Number(row?.n ?? -1) + 1;
}

export async function createSlot(
  env: Env,
  userId: string,
  profileId: string,
  input: {
    name?: unknown;
    handle?: unknown;
    takeCount?: unknown;
    note?: unknown;
    projectId?: unknown;
    galleryId?: unknown;
    files?: unknown;
  },
): Promise<SlotJson | null> {
  const name = acceptSlotName(input.name);
  if (!name) throw new SlotRejected("name", "A slot needs a name.");
  const handle = acceptHandle(input.handle, name);
  const take = input.takeCount === undefined ? 1 : acceptGalleryTake(input.takeCount);
  if (take == null) throw new SlotRejected("limit", "Take is from 1 to 4.");
  const note = input.note === undefined ? "" : acceptSlotNote(input.note);
  const projectId = input.projectId === undefined ? null : acceptProjectId(input.projectId);
  if (projectId) {
    const projectProfile = await ownedProjectProfile(env.DB, userId, projectId);
    if ((projectProfile ?? "") !== profileId) {
      throw new SlotRejected("name", "That project isn’t on this profile.");
    }
  }
  if ((await profileSlotCount(env.DB, userId, profileId)) >= SLOT_PROFILE_MAX) {
    throw new SlotRejected("limit", "A profile can have 200 slots.");
  }
  await assertHandleFree(env.DB, userId, profileId, projectId, handle, "");
  const galleryId = await acceptGalleryLink(env.DB, userId, profileId, input.galleryId);
  const files = galleryId ? [] : input.files === undefined ? [] : acceptSlotFiles(userId, input.files);
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  const position = await nextPosition(env.DB, userId, profileId);
  await env.DB
    .prepare(
      `INSERT INTO slots (
         id, user_id, profile_id, project_id, name, handle, take_count, note, gallery_id, position, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, profileId, projectId, name, handle, take, note, galleryId, position, now, now)
    .run();
  if (files.length > 0) await replaceFiles(env.DB, userId, id, files);
  const row = await slotRow(env.DB, userId, id);
  if (!row) return null;
  const [slot] = await presentSlots(env, userId, [row]);
  return slot ?? null;
}

async function acceptGalleryLink(
  db: D1Database,
  userId: string,
  profileId: string | null,
  raw: unknown,
): Promise<string | null> {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string" || !raw.trim()) throw new SlotRejected("file", "That gallery isn’t on this profile.");
  const gallery = await getGallery(db, userId, raw.trim());
  if (!gallery || (gallery.profileId ?? "") !== (profileId ?? "")) {
    throw new SlotRejected("file", "That gallery isn’t on this profile.");
  }
  return gallery.id;
}

export async function updateSlot(
  env: Env,
  userId: string,
  profileId: string,
  id: string,
  patch: {
    name?: unknown;
    handle?: unknown;
    takeCount?: unknown;
    note?: unknown;
    projectId?: unknown;
    galleryId?: unknown;
    files?: unknown;
  },
): Promise<SlotJson | null> {
  const current = await slotRow(env.DB, userId, id);
  if (!current || (current.profile_id ?? "") !== profileId) return null;
  const name = patch.name === undefined ? current.name : acceptSlotName(patch.name);
  if (!name) throw new SlotRejected("name", "A slot needs a name.");
  const handle = patch.handle === undefined ? current.handle : acceptHandle(patch.handle, name);
  const take = patch.takeCount === undefined ? acceptGalleryTake(current.take_count) ?? 1 : acceptGalleryTake(patch.takeCount);
  if (take == null) throw new SlotRejected("limit", "Take is from 1 to 4.");
  const note = patch.note === undefined ? current.note : acceptSlotNote(patch.note);
  const projectId = patch.projectId === undefined ? current.project_id : acceptProjectId(patch.projectId);
  if (projectId) {
    const projectProfile = await ownedProjectProfile(env.DB, userId, projectId);
    if ((projectProfile ?? "") !== profileId) {
      throw new SlotRejected("name", "That project isn’t on this profile.");
    }
  }
  if (handle !== current.handle || projectId !== current.project_id) {
    await assertHandleFree(env.DB, userId, profileId, projectId, handle, id);
  }
  const galleryTouched = patch.galleryId !== undefined;
  const galleryId = galleryTouched
    ? await acceptGalleryLink(env.DB, userId, profileId, patch.galleryId)
    : current.gallery_id && (await getGallery(env.DB, userId, current.gallery_id))
      ? current.gallery_id
      : null;
  if (patch.files !== undefined && galleryId && !galleryTouched) {
    throw new SlotRejected("file", "This slot uses a gallery. Its files come from there.");
  }
  const files = patch.files === undefined ? null : acceptSlotFiles(userId, patch.files);
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(
      `UPDATE slots
       SET name = ?, handle = ?, take_count = ?, note = ?, project_id = ?, gallery_id = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .bind(name, handle, take, note, projectId, galleryId, now, id, userId)
    .run();
  if (galleryId) await replaceFiles(env.DB, userId, id, []);
  else if (files) await replaceFiles(env.DB, userId, id, files);
  const row = await slotRow(env.DB, userId, id);
  if (!row) return null;
  const [slot] = await presentSlots(env, userId, [row]);
  return slot ?? null;
}

export async function deleteSlot(db: D1Database, userId: string, profileId: string, id: string): Promise<boolean> {
  const current = await slotRow(db, userId, id);
  if (!current || (current.profile_id ?? "") !== profileId) return false;
  await db.prepare(`DELETE FROM slot_files WHERE slot_id = ? AND user_id = ?`).bind(id, userId).run();
  await db.prepare(`DELETE FROM slots WHERE id = ? AND user_id = ?`).bind(id, userId).run();
  return true;
}

export type SlotAppendResult = {
  slot: SlotJson;
  added: number;
  /** Already in the slot, so skipped. */
  already: number;
  /** Did not fit under SLOT_FILES_MAX. */
  full: number;
};

/**
 * Add files to the end of a slot's own files, in the order given. A file already in the slot is
 * skipped. Each insert checks the key and the cap in the same statement, so two quick adds can't
 * duplicate a file or go past 12, and what fits is kept when the rest does not.
 */
export async function appendSlotFiles(
  env: Env,
  userId: string,
  profileId: string,
  id: string,
  raw: unknown,
): Promise<SlotAppendResult | null> {
  const current = await slotRow(env.DB, userId, id);
  if (!current || (current.profile_id ?? "") !== profileId) return null;
  if (current.gallery_id) {
    const gallery = await getGallery(env.DB, userId, current.gallery_id);
    if (gallery) {
      throw new SlotRejected("file", `This slot uses the gallery ${gallery.name}. Its files come from there.`);
    }
    // The linked gallery was deleted, so the slot keeps its own files again.
    await env.DB
      .prepare(`UPDATE slots SET gallery_id = NULL WHERE id = ? AND user_id = ?`)
      .bind(id, userId)
      .run();
  }
  const incoming = acceptSlotFiles(userId, raw, SLOT_APPEND_MAX);
  let added = 0;
  let already = 0;
  let full = 0;
  // Set once the slot is full. The rest are only sorted into already-in or did-not-fit.
  let heldKeys: Set<string> | null = null;
  for (const file of incoming) {
    if (heldKeys) {
      if (heldKeys.has(file.key)) already += 1;
      else full += 1;
      continue;
    }
    const result = await env.DB
      .prepare(
        `INSERT INTO slot_files (id, slot_id, user_id, kind, name, media_key, label, role, position)
         SELECT ?, ?, ?, ?, ?, ?,
           CASE WHEN EXISTS (
             SELECT 1 FROM slot_files WHERE slot_id = ? AND label = ? COLLATE NOCASE
           ) THEN NULL ELSE ? END,
           ?,
           (SELECT COALESCE(MAX(position), -1) + 1 FROM slot_files WHERE slot_id = ?)
         WHERE NOT EXISTS (SELECT 1 FROM slot_files WHERE slot_id = ? AND media_key = ?)
           AND (SELECT COUNT(*) FROM slot_files WHERE slot_id = ?) < ?`,
      )
      .bind(
        crypto.randomUUID(),
        id,
        userId,
        file.kind,
        file.name,
        file.key,
        id,
        file.label,
        file.label,
        file.role,
        id,
        id,
        file.key,
        id,
        SLOT_FILES_MAX,
      )
      .run();
    if (Number(result.meta?.changes ?? 0) > 0) {
      added += 1;
      continue;
    }
    const present = await env.DB
      .prepare(`SELECT 1 AS n FROM slot_files WHERE slot_id = ? AND media_key = ? LIMIT 1`)
      .bind(id, file.key)
      .first<{ n: number }>();
    if (present) {
      already += 1;
      continue;
    }
    full += 1;
    const { results } = await env.DB
      .prepare(`SELECT media_key FROM slot_files WHERE slot_id = ?`)
      .bind(id)
      .all<{ media_key: string }>();
    heldKeys = new Set((results ?? []).map((row) => row.media_key));
  }
  if (added > 0) {
    await env.DB
      .prepare(`UPDATE slots SET updated_at = ? WHERE id = ? AND user_id = ?`)
      .bind(Math.floor(Date.now() / 1000), id, userId)
      .run();
  }
  const row = await slotRow(env.DB, userId, id);
  if (!row) return null;
  const [slot] = await presentSlots(env, userId, [row]);
  if (!slot) return null;
  return { slot, added, already, full };
}

/** Drop slot files that pointed at media this user just deleted. */
export async function forgetSlotFiles(db: D1Database, userId: string, keys: readonly string[]): Promise<void> {
  const unique = [...new Set(keys.filter((key) => typeof key === "string" && key.length > 0))];
  for (let offset = 0; offset < unique.length; offset += 40) {
    const chunk = unique.slice(offset, offset + 40);
    const marks = chunk.map(() => "?").join(", ");
    try {
      await db
        .prepare(`DELETE FROM slot_files WHERE user_id = ? AND media_key IN (${marks})`)
        .bind(userId, ...chunk)
        .run();
    } catch (err) {
      if (!missingTable(err)) throw err;
    }
  }
}

export async function deleteUserSlotFiles(db: D1Database, userId: string): Promise<void> {
  try {
    await db.prepare(`DELETE FROM slot_files WHERE user_id = ?`).bind(userId).run();
  } catch (err) {
    if (!missingTable(err)) throw err;
  }
  try {
    await db.prepare(`DELETE FROM slots WHERE user_id = ?`).bind(userId).run();
  } catch (err) {
    if (!missingTable(err)) throw err;
  }
}

export async function deleteSlotsForProject(db: D1Database, userId: string, projectId: string): Promise<void> {
  try {
    await db
      .prepare(
        `DELETE FROM slot_files WHERE user_id = ? AND slot_id IN (
           SELECT id FROM slots WHERE project_id = ? AND user_id = ?
         )`,
      )
      .bind(userId, projectId, userId)
      .run();
    await db.prepare(`DELETE FROM slots WHERE project_id = ? AND user_id = ?`).bind(projectId, userId).run();
  } catch (err) {
    if (!missingTable(err)) throw err;
  }
}

async function resolvedFiles(env: Env, userId: string, row: SlotRow): Promise<SlotFileInput[]> {
  if (row.gallery_id) {
    const gallery = await getGallery(env.DB, userId, row.gallery_id);
    if (!gallery) return [];
    return gallery.items.map((item) => ({
      kind: item.kind,
      name: item.name,
      key: item.key,
      label: item.label,
      role: item.role,
    }));
  }
  const rows = await fileRows(env.DB, userId, [row.id]);
  return rows.flatMap((file) => {
    const kind = acceptMediaKind(file.kind);
    if (!kind) return [];
    return [
      {
        kind,
        name: file.name,
        key: file.media_key,
        label: file.label,
        role: storedRole(kind, file.role),
      },
    ];
  });
}

async function galleryHandleIsFree(
  db: D1Database,
  userId: string,
  profileId: string | null,
  handle: string,
): Promise<boolean> {
  if (!handle) return false;
  if (await galleryHandleTaken(db, userId, handle, profileId, "")) return false;
  if (await everywhereSlotHandleTaken(db, userId, handle, profileId, "")) return false;
  return true;
}

export async function saveSlotAsGallery(
  env: Env,
  userId: string,
  profileId: string,
  slotId: string,
): Promise<{ slot: SlotJson; galleryId: string } | null> {
  const current = await slotRow(env.DB, userId, slotId);
  if (!current || (current.profile_id ?? "") !== profileId) return null;
  const files = await resolvedFiles(env, userId, current);
  if (files.length === 0) throw new SlotRejected("file", "This slot has no files to save.");
  const handleFree = await galleryHandleIsFree(env.DB, userId, profileId, current.handle);
  const gallery = await saveGallery(env.DB, userId, {
    name: current.name,
    items: files.slice(0, GALLERY_MAX_ITEMS),
    profileId,
    handle: handleFree ? current.handle : "",
    takeCount: acceptGalleryTake(current.take_count) ?? 1,
    forceEmptyHandle: !handleFree,
  });
  if (!gallery) throw new SlotRejected("file", "This slot has no files to save.");
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(`UPDATE slots SET gallery_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .bind(gallery.id, now, slotId, userId)
    .run();
  await replaceFiles(env.DB, userId, slotId, []);
  const row = await slotRow(env.DB, userId, slotId);
  if (!row) return null;
  const [slot] = await presentSlots(env, userId, [row]);
  if (!slot) return null;
  return { slot, galleryId: gallery.id };
}

/**
 * One gallery named after the project, from the own files of the slots kept to that project.
 * A later copy of a label is saved without the label.
 */
export async function saveProjectSlotsAsGallery(
  env: Env,
  userId: string,
  profileId: string,
  projectId: string,
): Promise<{ galleryId: string; omitted: number } | null> {
  const project = await env.DB
    .prepare(`SELECT name, profile_id FROM projects WHERE id = ? AND user_id = ?`)
    .bind(projectId, userId)
    .first<{ name: string; profile_id: string | null }>();
  if (!project || (project.profile_id ?? "") !== profileId) return null;
  const { results } = await env.DB
    .prepare(
      `SELECT id FROM slots
       WHERE user_id = ? AND project_id = ? AND gallery_id IS NULL
       ORDER BY position ASC`,
    )
    .bind(userId, projectId)
    .all<{ id: string }>();
  const ids = (results ?? []).map((row) => row.id);
  const rows = await fileRows(env.DB, userId, ids);
  const items: GalleryItemInput[] = [];
  const labels = new Set<string>();
  let omitted = 0;
  for (const row of rows) {
    const kind = acceptMediaKind(row.kind);
    if (!kind) continue;
    if (items.length >= GALLERY_MAX_ITEMS) {
      omitted += 1;
      continue;
    }
    let label = row.label;
    if (label && labels.has(label.toLowerCase())) label = null;
    if (label) labels.add(label.toLowerCase());
    items.push({
      kind,
      name: row.name,
      key: row.media_key,
      label,
      role: storedRole(kind, row.role),
    });
  }
  if (items.length === 0) throw new SlotRejected("file", "These slots have no files of their own.");
  const name = acceptGalleryName(project.name) ?? project.name.slice(0, 80);
  const wanted = defaultGalleryHandle(name);
  const handleFree = await galleryHandleIsFree(env.DB, userId, profileId, wanted);
  const gallery = await saveGallery(env.DB, userId, {
    name,
    items,
    profileId,
    handle: handleFree ? wanted : "",
    takeCount: 1,
    forceEmptyHandle: !handleFree,
  });
  if (!gallery) throw new SlotRejected("file", "These slots have no files of their own.");
  return { galleryId: gallery.id, omitted };
}
