import { getGallery, ownedMediaKey } from "./galleries";
import { presentGallery } from "./gallery-present";
import { displayStoredMediaUrl } from "./media";
import { acceptMediaKind, normalizeMediaRole, type MediaKind, type MediaRole } from "./schema";
import type { Env } from "./types";

export type CastKind = MediaKind;

export const CAST_BUDGET_DEFAULT = 20;
export const CAST_BUDGET_MAX = 96;
export const CAST_FILE_MAX = 96;
export const CAST_ENTRY_MAX = 64;

export type CastFileInput = {
  type: "file";
  kind: CastKind;
  name: string;
  key: string;
  role: MediaRole | null;
  active: boolean;
};

export type CastGalleryItemInput = {
  key: string;
  active: boolean;
  excluded: boolean;
  role: MediaRole | null;
};

export type CastGalleryInput = {
  type: "gallery";
  id: string;
  active: boolean;
  items: CastGalleryItemInput[];
};

export type CastInput = CastFileInput | CastGalleryInput;

export type CastFileJson = CastFileInput & {
  id: string;
  url: string | null;
  thumbUrl: string | null;
};

export type CastGalleryItemJson = {
  id: string;
  kind: CastKind;
  name: string;
  key: string;
  url: string | null;
  thumbUrl: string | null;
  galleryRole: MediaRole | null;
  roleOverride: MediaRole | null;
  active: boolean;
  excluded: boolean;
};

export type CastGalleryJson = {
  type: "gallery";
  id: string;
  name: string;
  active: boolean;
  items: CastGalleryItemJson[];
};

export type CastEntryJson = CastFileJson | CastGalleryJson;

type MediaRow = {
  id: string;
  kind: string;
  name: string;
  media_key: string;
  role: string | null;
  position: number;
  active: number | null;
};

type GalleryLinkRow = {
  gallery_id: string;
  position: number;
  active: number | null;
};

type CastItemRow = {
  gallery_id: string;
  media_key: string;
  active: number;
  excluded: number;
  role: string | null;
};

function acceptFlag(raw: unknown, fallback: boolean): boolean {
  return typeof raw === "boolean" ? raw : fallback;
}

function acceptRole(kind: CastKind, raw: unknown): MediaRole | null {
  if (kind === "audio") return null;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return normalizeMediaRole(raw);
}

export function acceptProjectBudget(raw: unknown): number | null {
  if (raw == null || raw === "") return CAST_BUDGET_DEFAULT;
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < 1 || rounded > CAST_BUDGET_MAX) return null;
  return rounded;
}

/** The cast as the client sends it. Keys must belong to this user; unknown shapes reject the save. */
export function acceptProjectCast(userId: string, raw: unknown): CastInput[] | null {
  if (!Array.isArray(raw) || raw.length > CAST_ENTRY_MAX) return null;
  const entries: CastInput[] = [];
  const galleryIds = new Set<string>();
  let files = 0;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const record = entry as Record<string, unknown>;
    if (record.type === "gallery") {
      if (typeof record.id !== "string" || !record.id.trim()) return null;
      const id = record.id.trim();
      if (galleryIds.has(id)) continue;
      galleryIds.add(id);
      const items: CastGalleryItemInput[] = [];
      if (Array.isArray(record.items)) {
        for (const item of record.items) {
          if (!item || typeof item !== "object") return null;
          const itemRecord = item as Record<string, unknown>;
          const key = ownedMediaKey(userId, itemRecord.key);
          if (!key) return null;
          items.push({
            key,
            active: acceptFlag(itemRecord.active, true),
            excluded: acceptFlag(itemRecord.excluded, false),
            role:
              typeof itemRecord.role === "string" && itemRecord.role.trim()
                ? normalizeMediaRole(itemRecord.role)
                : null,
          });
        }
      }
      entries.push({ type: "gallery", id, active: acceptFlag(record.active, true), items });
      continue;
    }
    if (record.type === "file") {
      const kind = acceptMediaKind(record.kind);
      const key = ownedMediaKey(userId, record.key);
      if (!kind || typeof record.name !== "string" || !key) return null;
      const name = record.name.trim();
      if (!name || name.length > 180) return null;
      files += 1;
      if (files > CAST_FILE_MAX) return null;
      entries.push({
        type: "file",
        kind,
        name,
        key,
        role: acceptRole(kind, record.role),
        active: acceptFlag(record.active, true),
      });
      continue;
    }
    return null;
  }
  return entries;
}

async function mediaRows(db: D1Database, userId: string, projectId: string): Promise<MediaRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, kind, name, media_key, role, position, active FROM project_media
       WHERE project_id = ? AND user_id = ?
       ORDER BY position ASC`,
    )
    .bind(projectId, userId)
    .all<MediaRow>();
  return results ?? [];
}

async function galleryLinkRows(db: D1Database, projectId: string): Promise<GalleryLinkRow[]> {
  const { results } = await db
    .prepare(
      `SELECT gallery_id, position, active FROM project_galleries
       WHERE project_id = ? ORDER BY position ASC`,
    )
    .bind(projectId)
    .all<GalleryLinkRow>();
  return results ?? [];
}

async function castItemRows(db: D1Database, projectId: string): Promise<CastItemRow[]> {
  const { results } = await db
    .prepare(
      `SELECT gallery_id, media_key, active, excluded, role FROM project_cast_items
       WHERE project_id = ?`,
    )
    .bind(projectId)
    .all<CastItemRow>();
  return results ?? [];
}

/** The project's cast in saved order: galleries with their items, and loose files. */
export async function loadProjectCast(
  env: Env,
  userId: string,
  projectId: string,
): Promise<CastEntryJson[]> {
  const [media, links, overrides] = await Promise.all([
    mediaRows(env.DB, userId, projectId),
    galleryLinkRows(env.DB, projectId),
    castItemRows(env.DB, projectId),
  ]);
  const overrideFor = new Map<string, CastItemRow>();
  for (const row of overrides) overrideFor.set(`${row.gallery_id}\n${row.media_key}`, row);

  const positioned: { position: number; order: number; entry: CastEntryJson }[] = [];
  let order = 0;
  for (const link of links) {
    const gallery = await getGallery(env.DB, userId, link.gallery_id);
    if (!gallery) continue;
    const shown = await presentGallery(env, userId, gallery);
    const items: CastGalleryItemJson[] = shown.items.map((item) => {
      const override = overrideFor.get(`${gallery.id}\n${item.key}`);
      return {
        id: item.id,
        kind: item.kind,
        name: item.name,
        key: item.key,
        url: item.url || null,
        thumbUrl: item.thumbUrl,
        galleryRole: item.kind === "audio" ? null : item.role,
        roleOverride:
          item.kind === "audio" || !override?.role ? null : normalizeMediaRole(override.role),
        active: override ? override.active !== 0 : true,
        excluded: override ? override.excluded !== 0 : false,
      };
    });
    positioned.push({
      position: link.position,
      order: order++,
      entry: {
        type: "gallery",
        id: gallery.id,
        name: gallery.name,
        active: link.active == null || link.active !== 0,
        items,
      },
    });
  }
  for (const row of media) {
    const kind = acceptMediaKind(row.kind) ?? "image";
    const url = await displayStoredMediaUrl(env, row.media_key, null);
    positioned.push({
      position: row.position,
      order: order++,
      entry: {
        type: "file",
        id: row.id,
        kind,
        name: row.name,
        key: row.media_key,
        role: kind === "audio" ? null : normalizeMediaRole(row.role),
        active: row.active == null || row.active !== 0,
        url,
        thumbUrl: kind === "image" ? url : null,
      },
    });
  }
  positioned.sort((a, b) => a.position - b.position || a.order - b.order);
  return positioned.map((item) => item.entry);
}

/** Statements that replace the stored cast. Galleries the user does not own are dropped. */
export async function castWriteStatements(
  db: D1Database,
  userId: string,
  projectId: string,
  cast: CastInput[],
): Promise<D1PreparedStatement[]> {
  const statements: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM project_media WHERE project_id = ? AND user_id = ?`).bind(projectId, userId),
    db.prepare(`DELETE FROM project_galleries WHERE project_id = ?`).bind(projectId),
    db.prepare(`DELETE FROM project_cast_items WHERE project_id = ?`).bind(projectId),
  ];
  let position = 0;
  for (const entry of cast) {
    if (entry.type === "gallery") {
      const owned = await db
        .prepare(`SELECT id FROM galleries WHERE id = ? AND user_id = ?`)
        .bind(entry.id, userId)
        .first<{ id: string }>();
      if (!owned) continue;
      statements.push(
        db
          .prepare(
            `INSERT INTO project_galleries (project_id, gallery_id, position, active) VALUES (?, ?, ?, ?)`,
          )
          .bind(projectId, entry.id, position, entry.active ? 1 : 0),
      );
      for (const item of entry.items) {
        if (item.active && !item.excluded && !item.role) continue;
        statements.push(
          db
            .prepare(
              `INSERT INTO project_cast_items (project_id, gallery_id, media_key, active, excluded, role)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .bind(projectId, entry.id, item.key, item.active ? 1 : 0, item.excluded ? 1 : 0, item.role),
        );
      }
    } else {
      statements.push(
        db
          .prepare(
            `INSERT INTO project_media (id, project_id, user_id, kind, name, media_key, role, position, active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            projectId,
            userId,
            entry.kind,
            entry.name,
            entry.key,
            entry.role,
            position,
            entry.active ? 1 : 0,
          ),
      );
    }
    position += 1;
  }
  return statements;
}
