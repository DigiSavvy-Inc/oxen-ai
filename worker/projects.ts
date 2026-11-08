import { galleryKeyForUser } from "./galleries";
import {
  acceptLookBody,
  acceptLookName,
  appliedLooks,
  cappedLookIds,
  LOOK_BODY_MAX,
  LOOK_NAME_MAX,
  sortLooks,
  type Look,
  type LookGroup,
} from "./looks";
import { displayStoredMediaUrl } from "./media";
import { normalizeMediaRole, type MediaRole } from "./schema";
import type { Env } from "./types";

export const PROJECT_NAME_MAX = 80;
export const STYLE_NAME_MAX = LOOK_NAME_MAX;
export const STYLE_BODY_MAX = LOOK_BODY_MAX;
export const PROJECT_PROMPT_MAX = 8000;
export const PROJECT_MEDIA_MAX = 24;
export const PROJECT_MAX = 50;
export const LOOKS_PER_PROFILE_MAX = 200;
const SESSION_NAME_MAX = 80;

export type ProjectKind = "image" | "video" | "audio";

export type ProjectMediaInput = {
  kind: ProjectKind;
  name: string;
  key: string;
  role: MediaRole | null;
};

export type ProjectAttachment = ProjectMediaInput & { url: string | null };

export type StyleRecord = Look;

export type SessionSummary = {
  id: string;
  name: string;
  updatedAt: number;
};

export type ProjectSummary = {
  id: string;
  name: string;
  updatedAt: number;
  sessions: SessionSummary[];
};

export type ShareRecord = {
  id: string;
  token: string;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
};

export type SessionRecord = SessionSummary & {
  prompt: string;
  lookIds: string[];
  mode: string | null;
  model: string;
  params: Record<string, unknown>;
  attachments: ProjectAttachment[];
  generationIds: string[];
};

export type ProjectRecord = {
  id: string;
  name: string;
  prompt: string;
  /** Applied looks in chip order, at most PROJECT_LOOKS_MAX. */
  lookIds: string[];
  updatedAt: number;
  media: ProjectAttachment[];
  galleryIds: string[];
  sessions: SessionRecord[];
  shares: ShareRecord[];
};

export type ShareSnapshot = {
  name: string;
  prompt: string;
  looks: Look[];
  media: ProjectAttachment[];
};

type StyleRow = { id: string; name: string; body: string; group_name: string | null; starred: number };
type ProjectRow = {
  id: string;
  name: string;
  prompt: string;
  style_id: string | null;
  updated_at: number;
};
type MediaRow = {
  id: string;
  kind: string;
  name: string;
  media_key: string;
  role: string | null;
  position: number;
};

export function acceptProjectName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name || name.length > PROJECT_NAME_MAX) return null;
  return name;
}

export const acceptStyleName = acceptLookName;
export const acceptStyleBody = acceptLookBody;

export function acceptProjectPrompt(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length > PROJECT_PROMPT_MAX) return null;
  return raw.trim();
}

export function shareExpiresAt(now: number, days: number | null): number | null {
  if (days == null) return null;
  if (!Number.isFinite(days)) return null;
  const clamped = Math.min(90, Math.max(1, Math.round(days)));
  return now + clamped * 86400;
}

export function shareIsOpen(
  row: { expires_at: number | null; revoked_at: number | null },
  now: number,
): boolean {
  if (row.revoked_at != null) return false;
  if (row.expires_at != null && row.expires_at <= now) return false;
  return true;
}

function acceptKind(raw: unknown): ProjectKind | null {
  switch (raw) {
    case "image":
    case "video":
    case "audio":
      return raw;
    default:
      return null;
  }
}

export function acceptProjectMedia(userId: string, raw: unknown): ProjectMediaInput[] | null {
  if (!Array.isArray(raw) || raw.length > PROJECT_MEDIA_MAX) return null;
  const items: ProjectMediaInput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const record = entry as { kind?: unknown; name?: unknown; key?: unknown; role?: unknown };
    const kind = acceptKind(record.kind);
    const key = galleryKeyForUser(userId, record.key);
    if (!kind || typeof record.name !== "string" || !key) return null;
    const name = record.name.trim();
    if (!name || name.length > 180) return null;
    items.push({
      kind,
      name,
      key,
      role: kind === "audio" ? null : normalizeMediaRole(typeof record.role === "string" ? record.role : null),
    });
  }
  return items;
}

function parseParams(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value as Record<string, unknown>;
  } catch {
    return {};
  }
}

function parseAttachments(userId: string, raw: string): ProjectMediaInput[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return acceptProjectMedia(userId, value) ?? [];
  } catch {
    return [];
  }
}

function parseLookIds(raw: string | null | undefined, fallback: string | null): string[] {
  try {
    const value = JSON.parse(raw ?? "[]") as unknown;
    if (Array.isArray(value)) {
      const ids = cappedLookIds(value.filter((item): item is string => typeof item === "string"));
      if (ids.length > 0) return ids;
    }
  } catch {
    /* an older session only had style_id */
  }
  return fallback ? [fallback] : [];
}

function lookFromRow(row: StyleRow): Look {
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    group: lookGroupFromDb(row.group_name),
    starred: row.starred === 1,
  };
}

function lookGroupFromDb(value: string | null): LookGroup | null {
  switch (value) {
    case "Camera":
    case "Light":
    case "Color":
    case "Era":
    case "Motion":
    case "Other":
      return value;
    default:
      return null;
  }
}

function sessionName(raw: unknown, prompt: string): string {
  if (typeof raw === "string" && raw.trim()) return raw.trim().slice(0, SESSION_NAME_MAX);
  const line = prompt.split("\n").map((part) => part.trim()).find(Boolean) ?? "";
  return (line || "Session").slice(0, SESSION_NAME_MAX);
}

async function withUrls(
  env: Env,
  items: ProjectMediaInput[],
): Promise<ProjectAttachment[]> {
  return Promise.all(
    items.map(async (item) => ({
      ...item,
      url: await displayStoredMediaUrl(env, item.key, null),
    })),
  );
}

export async function listStyles(db: D1Database, userId: string, profileId: string): Promise<Look[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, body, group_name, starred FROM styles
       WHERE user_id = ? AND profile_id = ?
       ORDER BY starred DESC, updated_at DESC
       LIMIT ?`,
    )
    .bind(userId, profileId, LOOKS_PER_PROFILE_MAX)
    .all<StyleRow>();
  return sortLooks((results ?? []).map(lookFromRow));
}

export async function createStyle(
  db: D1Database,
  userId: string,
  profileId: string,
  name: string,
  body: string,
  group: LookGroup | null = null,
): Promise<Look> {
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO styles (id, user_id, profile_id, name, body, group_name, starred, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .bind(id, userId, profileId, name, body, group, now, now)
    .run();
  return { id, name, body, group, starred: false };
}

export async function updateStyle(
  db: D1Database,
  userId: string,
  id: string,
  patch: { name?: string; body?: string; group?: LookGroup | null; starred?: boolean },
): Promise<Look | null> {
  const row = await db
    .prepare(`SELECT id, name, body, group_name, starred FROM styles WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .first<StyleRow>();
  if (!row) return null;
  const current = lookFromRow(row);
  const next: Look = {
    id,
    name: patch.name ?? current.name,
    body: patch.body ?? current.body,
    group: patch.group === undefined ? current.group : patch.group,
    starred: patch.starred ?? current.starred,
  };
  await db
    .prepare(
      `UPDATE styles SET name = ?, body = ?, group_name = ?, starred = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .bind(next.name, next.body, next.group, next.starred ? 1 : 0, Math.floor(Date.now() / 1000), id, userId)
    .run();
  return next;
}

export async function deleteStyle(db: D1Database, userId: string, id: string): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM styles WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .run();
  await db.batch([
    db.prepare(`UPDATE projects SET style_id = NULL WHERE user_id = ? AND style_id = ?`).bind(userId, id),
    db
      .prepare(
        `DELETE FROM project_looks WHERE style_id = ?
         AND project_id IN (SELECT id FROM projects WHERE user_id = ?)`,
      )
      .bind(id, userId),
  ]);
  return (result.meta.changes ?? 0) > 0;
}

export async function listProjects(
  db: D1Database,
  userId: string,
  profileId: string,
): Promise<ProjectSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, updated_at FROM projects
       WHERE user_id = ? AND profile_id = ?
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .bind(userId, profileId, PROJECT_MAX)
    .all<{ id: string; name: string; updated_at: number }>();
  const projects = results ?? [];
  if (projects.length === 0) return [];
  const ids = projects.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(", ");
  const { results: sessions } = await db
    .prepare(
      `SELECT id, project_id, name, updated_at FROM project_sessions
       WHERE user_id = ? AND project_id IN (${placeholders})
       ORDER BY updated_at DESC`,
    )
    .bind(userId, ...ids)
    .all<{ id: string; project_id: string; name: string; updated_at: number }>();
  return projects.map((row) => ({
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
    sessions: (sessions ?? [])
      .filter((session) => session.project_id === row.id)
      .map((session) => ({ id: session.id, name: session.name, updatedAt: session.updated_at })),
  }));
}

export async function createProject(
  db: D1Database,
  userId: string,
  profileId: string,
  name: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO projects (id, user_id, profile_id, name, prompt, style_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', NULL, ?, ?)`,
    )
    .bind(id, userId, profileId, name, now, now)
    .run();
  return id;
}

/** The requested looks that belong to this user, in order. Null when one is not theirs. */
async function ownedLookIds(db: D1Database, userId: string, ids: string[]): Promise<string[] | null> {
  const wanted = cappedLookIds(ids);
  if (wanted.length === 0) return [];
  const placeholders = wanted.map(() => "?").join(", ");
  const { results } = await db
    .prepare(`SELECT id FROM styles WHERE user_id = ? AND id IN (${placeholders})`)
    .bind(userId, ...wanted)
    .all<{ id: string }>();
  const owned = new Set((results ?? []).map((row) => row.id));
  return wanted.every((id) => owned.has(id)) ? wanted : null;
}

async function ownedProject(db: D1Database, userId: string, id: string): Promise<ProjectRow | null> {
  return db
    .prepare(
      `SELECT id, name, prompt, style_id, updated_at FROM projects WHERE id = ? AND user_id = ?`,
    )
    .bind(id, userId)
    .first<ProjectRow>();
}

async function generationIdsFor(
  db: D1Database,
  userId: string,
  sessionId: string,
): Promise<string[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT id FROM generations
         WHERE user_id = ? AND session_id = ?
         ORDER BY created_at ASC`,
      )
      .bind(userId, sessionId)
      .all<{ id: string }>();
    return (results ?? []).map((row) => row.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("no such column")) return [];
    throw err;
  }
}

async function presentSession(
  env: Env,
  userId: string,
  row: {
    id: string;
    name: string;
    prompt: string;
    style_id: string | null;
    look_ids_json?: string | null;
    mode: string | null;
    model: string;
    params_json: string;
    attachments_json: string;
    updated_at: number;
  },
): Promise<SessionRecord> {
  const stored = parseAttachments(userId, row.attachments_json);
  return {
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
    prompt: row.prompt,
    lookIds: parseLookIds(row.look_ids_json, row.style_id),
    mode: row.mode,
    model: row.model,
    params: parseParams(row.params_json),
    attachments: await withUrls(env, stored),
    generationIds: await generationIdsFor(env.DB, userId, row.id),
  };
}

export async function getProject(
  env: Env,
  userId: string,
  id: string,
): Promise<ProjectRecord | null> {
  const row = await ownedProject(env.DB, userId, id);
  if (!row) return null;
  const { results: media } = await env.DB
    .prepare(
      `SELECT id, kind, name, media_key, role, position FROM project_media
       WHERE project_id = ? AND user_id = ?
       ORDER BY position ASC`,
    )
    .bind(id, userId)
    .all<MediaRow>();
  const { results: galleries } = await env.DB
    .prepare(
      `SELECT gallery_id FROM project_galleries WHERE project_id = ? ORDER BY position ASC`,
    )
    .bind(id)
    .all<{ gallery_id: string }>();
  const { results: looks } = await env.DB
    .prepare(`SELECT style_id FROM project_looks WHERE project_id = ? ORDER BY position ASC`)
    .bind(id)
    .all<{ style_id: string }>();
  const lookIds = cappedLookIds((looks ?? []).map((item) => item.style_id));
  const { results: sessions } = await env.DB
    .prepare(
      `SELECT id, name, prompt, style_id, look_ids_json, mode, model, params_json, attachments_json, updated_at
       FROM project_sessions
       WHERE project_id = ? AND user_id = ?
       ORDER BY updated_at DESC`,
    )
    .bind(id, userId)
    .all<{
      id: string;
      name: string;
      prompt: string;
      style_id: string | null;
      look_ids_json: string | null;
      mode: string | null;
      model: string;
      params_json: string;
      attachments_json: string;
      updated_at: number;
    }>();
  const { results: shares } = await env.DB
    .prepare(
      `SELECT id, token, expires_at, revoked_at, created_at FROM project_shares
       WHERE project_id = ? AND user_id = ?
       ORDER BY created_at DESC`,
    )
    .bind(id, userId)
    .all<{
      id: string;
      token: string;
      expires_at: number | null;
      revoked_at: number | null;
      created_at: number;
    }>();
  const items = (media ?? []).map((item) => ({
    kind: acceptKind(item.kind) ?? "image",
    name: item.name,
    key: item.media_key,
    role: item.kind === "audio" ? null : normalizeMediaRole(item.role),
  }));
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    lookIds: lookIds.length > 0 ? lookIds : row.style_id ? [row.style_id] : [],
    updatedAt: row.updated_at,
    media: await withUrls(env, items),
    galleryIds: (galleries ?? []).map((item) => item.gallery_id),
    sessions: await Promise.all((sessions ?? []).map((session) => presentSession(env, userId, session))),
    shares: (shares ?? []).map((share) => ({
      id: share.id,
      token: share.token,
      expiresAt: share.expires_at,
      revokedAt: share.revoked_at,
      createdAt: share.created_at,
    })),
  };
}

export async function updateProject(
  db: D1Database,
  userId: string,
  id: string,
  patch: {
    name: string;
    prompt: string;
    lookIds: string[];
    media: ProjectMediaInput[];
    galleryIds: string[];
  },
): Promise<boolean> {
  const current = await ownedProject(db, userId, id);
  if (!current) return false;
  const lookIds = await ownedLookIds(db, userId, patch.lookIds);
  if (!lookIds) return false;
  const galleryIds: string[] = [];
  for (const galleryId of patch.galleryIds) {
    if (galleryIds.includes(galleryId)) continue;
    const row = await db
      .prepare(`SELECT id FROM galleries WHERE id = ? AND user_id = ?`)
      .bind(galleryId, userId)
      .first<{ id: string }>();
    if (row) galleryIds.push(row.id);
  }
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `UPDATE projects SET name = ?, prompt = ?, style_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    )
    .bind(patch.name, patch.prompt, lookIds[0] ?? null, now, id, userId)
    .run();
  const statements: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM project_media WHERE project_id = ? AND user_id = ?`).bind(id, userId),
    db.prepare(`DELETE FROM project_galleries WHERE project_id = ?`).bind(id),
    db.prepare(`DELETE FROM project_looks WHERE project_id = ?`).bind(id),
  ];
  lookIds.forEach((lookId, index) => {
    statements.push(
      db
        .prepare(`INSERT INTO project_looks (project_id, style_id, position) VALUES (?, ?, ?)`)
        .bind(id, lookId, index),
    );
  });
  patch.media.forEach((item, index) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO project_media (id, project_id, user_id, kind, name, media_key, role, position)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), id, userId, item.kind, item.name, item.key, item.role, index),
    );
  });
  galleryIds.forEach((galleryId, index) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO project_galleries (project_id, gallery_id, position) VALUES (?, ?, ?)`,
        )
        .bind(id, galleryId, index),
    );
  });
  await db.batch(statements);
  return true;
}

export async function deleteProject(db: D1Database, userId: string, id: string): Promise<boolean> {
  const current = await ownedProject(db, userId, id);
  if (!current) return false;
  await db.batch([
    db.prepare(`DELETE FROM project_media WHERE project_id = ? AND user_id = ?`).bind(id, userId),
    db.prepare(`DELETE FROM project_galleries WHERE project_id = ?`).bind(id),
    db.prepare(`DELETE FROM project_looks WHERE project_id = ?`).bind(id),
    db.prepare(`DELETE FROM project_sessions WHERE project_id = ? AND user_id = ?`).bind(id, userId),
    db.prepare(`DELETE FROM project_shares WHERE project_id = ? AND user_id = ?`).bind(id, userId),
    db.prepare(`DELETE FROM projects WHERE id = ? AND user_id = ?`).bind(id, userId),
  ]);
  return true;
}

export async function saveSession(
  db: D1Database,
  userId: string,
  projectId: string,
  input: {
    id?: string | null;
    name?: unknown;
    prompt: string;
    lookIds: string[];
    mode: string | null;
    model: string;
    params: Record<string, unknown>;
    attachments: ProjectMediaInput[];
    generationIds: string[];
  },
): Promise<string | null> {
  const project = await ownedProject(db, userId, projectId);
  if (!project) return null;
  const now = Math.floor(Date.now() / 1000);
  const name = sessionName(input.name, input.prompt);
  const params = JSON.stringify(input.params);
  const attachments = JSON.stringify(input.attachments);
  const lookIds = (await ownedLookIds(db, userId, input.lookIds)) ?? [];
  const lookIdsJson = JSON.stringify(lookIds);
  const styleId = lookIds[0] ?? null;
  let id = input.id?.trim() || "";
  if (id) {
    const existing = await db
      .prepare(`SELECT id FROM project_sessions WHERE id = ? AND project_id = ? AND user_id = ?`)
      .bind(id, projectId, userId)
      .first<{ id: string }>();
    if (!existing) id = "";
  }
  if (!id) {
    id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO project_sessions (
           id, project_id, user_id, name, prompt, style_id, look_ids_json, mode, model, params_json, attachments_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        projectId,
        userId,
        name,
        input.prompt,
        styleId,
        lookIdsJson,
        input.mode,
        input.model,
        params,
        attachments,
        now,
        now,
      )
      .run();
  } else {
    await db
      .prepare(
        `UPDATE project_sessions
         SET name = ?, prompt = ?, style_id = ?, look_ids_json = ?, mode = ?, model = ?, params_json = ?, attachments_json = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .bind(name, input.prompt, styleId, lookIdsJson, input.mode, input.model, params, attachments, now, id, userId)
      .run();
  }
  const ids = [...new Set(input.generationIds.filter((item) => typeof item === "string" && item))];
  if (ids.length > 0) {
    try {
      const placeholders = ids.map(() => "?").join(", ");
      await db
        .prepare(
          `UPDATE generations SET session_id = ?
           WHERE user_id = ? AND id IN (${placeholders})`,
        )
        .bind(id, userId, ...ids)
        .run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("no such column")) throw err;
    }
  }
  await db
    .prepare(`UPDATE projects SET updated_at = ? WHERE id = ? AND user_id = ?`)
    .bind(now, projectId, userId)
    .run();
  return id;
}

export async function createShare(
  db: D1Database,
  userId: string,
  projectId: string,
  expiresAt: number | null,
): Promise<ShareRecord | null> {
  const project = await ownedProject(db, userId, projectId);
  if (!project) return null;
  const now = Math.floor(Date.now() / 1000);
  const share: ShareRecord = {
    id: crypto.randomUUID(),
    token: crypto.randomUUID(),
    expiresAt,
    revokedAt: null,
    createdAt: now,
  };
  await db
    .prepare(
      `INSERT INTO project_shares (id, project_id, user_id, token, expires_at, revoked_at, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    )
    .bind(share.id, projectId, userId, share.token, share.expiresAt, now)
    .run();
  return share;
}

export async function revokeShare(
  db: D1Database,
  userId: string,
  projectId: string,
  shareId: string,
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare(
      `UPDATE project_shares SET revoked_at = ?
       WHERE id = ? AND project_id = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .bind(now, shareId, projectId, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function readShare(env: Env, token: string): Promise<ShareSnapshot | null> {
  const row = await env.DB
    .prepare(
      `SELECT project_id, user_id, expires_at, revoked_at FROM project_shares WHERE token = ?`,
    )
    .bind(token)
    .first<{
      project_id: string;
      user_id: string;
      expires_at: number | null;
      revoked_at: number | null;
    }>();
  if (!row || !shareIsOpen(row, Math.floor(Date.now() / 1000))) return null;
  const project = await getProject(env, row.user_id, row.project_id);
  if (!project) return null;
  let looks: Look[] = [];
  if (project.lookIds.length > 0) {
    const placeholders = project.lookIds.map(() => "?").join(", ");
    const { results } = await env.DB
      .prepare(
        `SELECT id, name, body, group_name, starred FROM styles WHERE user_id = ? AND id IN (${placeholders})`,
      )
      .bind(row.user_id, ...project.lookIds)
      .all<StyleRow>();
    looks = appliedLooks(project.lookIds, (results ?? []).map(lookFromRow));
  }
  return {
    name: project.name,
    prompt: project.prompt,
    looks,
    media: project.media,
  };
}
