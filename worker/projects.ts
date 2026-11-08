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
import {
  CAST_BUDGET_DEFAULT,
  castWriteStatements,
  loadProjectCast,
  type CastEntryJson,
  type CastInput,
} from "./project-cast";
import {
  defaultsFromJson,
  draftFromJson,
  type ComposerDefaults,
  type ComposerDraft,
} from "./project-draft";
import { projectJobStats } from "./project-jobs";
import type { Env } from "./types";

export const PROJECT_NAME_MAX = 80;
export const STYLE_NAME_MAX = LOOK_NAME_MAX;
export const STYLE_BODY_MAX = LOOK_BODY_MAX;
export const PROJECT_PROMPT_MAX = 8000;
export const PROJECT_MAX = 50;
export const LOOKS_PER_PROFILE_MAX = 200;

export type StyleRecord = Look;

export type ProjectSummary = {
  id: string;
  name: string;
  updatedAt: number;
  castCount: number;
  galleryCount: number;
  jobCount: number;
  /** When the newest job was run, or null before the first run. */
  lastRunAt: number | null;
};

export type ShareRecord = {
  id: string;
  token: string;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
};

export type ProjectRecord = {
  id: string;
  name: string;
  prompt: string;
  /** Applied looks in chip order, at most PROJECT_LOOKS_MAX. */
  lookIds: string[];
  updatedAt: number;
  budget: number;
  cast: CastEntryJson[];
  galleryIds: string[];
  /** The composer state from the last visit, or null when the project was never opened. */
  draft: ComposerDraft | null;
  /** Mode, model, and settings from the last run, or null before the first run. */
  defaults: ComposerDefaults | null;
  jobCount: number;
  lastRunAt: number | null;
  shares: ShareRecord[];
};

export type ShareSnapshot = {
  name: string;
  prompt: string;
  looks: Look[];
  budget: number;
  cast: CastEntryJson[];
};

type StyleRow = { id: string; name: string; body: string; group_name: string | null; starred: number };
type ProjectRow = {
  id: string;
  name: string;
  prompt: string;
  style_id: string | null;
  updated_at: number;
  budget: number | null;
  draft_json?: string | null;
  defaults_json?: string | null;
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
  const [counts, jobs] = await Promise.all([
    castCounts(db, userId, ids),
    projectJobStats(db, userId, ids),
  ]);
  return projects.map((row) => ({
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
    castCount: counts.get(row.id)?.items ?? 0,
    galleryCount: counts.get(row.id)?.galleries ?? 0,
    jobCount: jobs.get(row.id)?.jobs ?? 0,
    lastRunAt: jobs.get(row.id)?.lastRunAt || null,
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

/** Items and galleries per project. Excluded gallery items are not counted; inactive ones are. */
async function castCounts(
  db: D1Database,
  userId: string,
  projectIds: string[],
): Promise<Map<string, { items: number; galleries: number }>> {
  const counts = new Map<string, { items: number; galleries: number }>();
  if (projectIds.length === 0) return counts;
  const placeholders = projectIds.map(() => "?").join(", ");
  const bump = (id: string, items: number, galleries: number) => {
    const current = counts.get(id) ?? { items: 0, galleries: 0 };
    counts.set(id, { items: current.items + items, galleries: current.galleries + galleries });
  };
  const { results: files } = await db
    .prepare(
      `SELECT project_id, COUNT(*) AS n FROM project_media
       WHERE user_id = ? AND project_id IN (${placeholders}) GROUP BY project_id`,
    )
    .bind(userId, ...projectIds)
    .all<{ project_id: string; n: number }>();
  for (const row of files ?? []) bump(row.project_id, Number(row.n) || 0, 0);
  const { results: galleries } = await db
    .prepare(
      `SELECT pg.project_id AS project_id, pg.gallery_id AS gallery_id,
              (SELECT COUNT(*) FROM gallery_items gi WHERE gi.gallery_id = pg.gallery_id AND gi.user_id = ?) AS n
       FROM project_galleries pg
       WHERE pg.project_id IN (${placeholders})`,
    )
    .bind(userId, ...projectIds)
    .all<{ project_id: string; gallery_id: string; n: number }>();
  const { results: excluded } = await db
    .prepare(
      `SELECT project_id, gallery_id, COUNT(*) AS n FROM project_cast_items
       WHERE excluded = 1 AND project_id IN (${placeholders}) GROUP BY project_id, gallery_id`,
    )
    .bind(...projectIds)
    .all<{ project_id: string; gallery_id: string; n: number }>();
  const excludedFor = new Map<string, number>();
  for (const row of excluded ?? []) excludedFor.set(`${row.project_id}\n${row.gallery_id}`, Number(row.n) || 0);
  for (const row of galleries ?? []) {
    const removed = excludedFor.get(`${row.project_id}\n${row.gallery_id}`) ?? 0;
    bump(row.project_id, Math.max(0, (Number(row.n) || 0) - removed), 1);
  }
  return counts;
}

async function ownedProject(db: D1Database, userId: string, id: string): Promise<ProjectRow | null> {
  return db
    .prepare(
      `SELECT id, name, prompt, style_id, updated_at, budget, draft_json, defaults_json
       FROM projects WHERE id = ? AND user_id = ?`,
    )
    .bind(id, userId)
    .first<ProjectRow>();
}

export async function getProject(
  env: Env,
  userId: string,
  id: string,
): Promise<ProjectRecord | null> {
  const row = await ownedProject(env.DB, userId, id);
  if (!row) return null;
  const { results: looks } = await env.DB
    .prepare(`SELECT style_id FROM project_looks WHERE project_id = ? ORDER BY position ASC`)
    .bind(id)
    .all<{ style_id: string }>();
  const lookIds = cappedLookIds((looks ?? []).map((item) => item.style_id));
  const cast = await loadProjectCast(env, userId, id);
  const jobs = await projectJobStats(env.DB, userId, [id]);
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
  return {
    id: row.id,
    name: row.name,
    prompt: row.prompt,
    lookIds: lookIds.length > 0 ? lookIds : row.style_id ? [row.style_id] : [],
    updatedAt: row.updated_at,
    budget: row.budget ?? CAST_BUDGET_DEFAULT,
    cast,
    galleryIds: cast.flatMap((entry) => (entry.type === "gallery" ? [entry.id] : [])),
    draft: draftFromJson(row.draft_json),
    defaults: defaultsFromJson(row.defaults_json),
    jobCount: jobs.get(id)?.jobs ?? 0,
    lastRunAt: jobs.get(id)?.lastRunAt || null,
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
    budget: number;
    cast: CastInput[];
  },
): Promise<boolean> {
  const current = await ownedProject(db, userId, id);
  if (!current) return false;
  const lookIds = await ownedLookIds(db, userId, patch.lookIds);
  if (!lookIds) return false;
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `UPDATE projects SET name = ?, prompt = ?, style_id = ?, budget = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .bind(patch.name, patch.prompt, lookIds[0] ?? null, patch.budget, now, id, userId)
    .run();
  const statements: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM project_looks WHERE project_id = ?`).bind(id),
  ];
  lookIds.forEach((lookId, index) => {
    statements.push(
      db
        .prepare(`INSERT INTO project_looks (project_id, style_id, position) VALUES (?, ?, ?)`)
        .bind(id, lookId, index),
    );
  });
  statements.push(...(await castWriteStatements(db, userId, id, patch.cast)));
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
    db.prepare(`DELETE FROM project_cast_items WHERE project_id = ?`).bind(id),
    db.prepare(`DELETE FROM project_sessions WHERE project_id = ? AND user_id = ?`).bind(id, userId),
    db.prepare(`DELETE FROM project_shares WHERE project_id = ? AND user_id = ?`).bind(id, userId),
    // The runs stay in the library; they just stop belonging to a project.
    db.prepare(`UPDATE generations SET project_id = NULL WHERE project_id = ? AND user_id = ?`).bind(id, userId),
    db.prepare(`DELETE FROM projects WHERE id = ? AND user_id = ?`).bind(id, userId),
  ]);
  return true;
}

/**
 * Keep the composer state for this project. The draft is what the next visit restores;
 * the defaults, when given, are what the last run used. The project's updated_at is left
 * alone so autosaving a draft does not reorder the list.
 */
export async function saveProjectDraft(
  db: D1Database,
  userId: string,
  projectId: string,
  input: { draft: ComposerDraft | null; defaults: ComposerDefaults | null },
): Promise<boolean> {
  const project = await ownedProject(db, userId, projectId);
  if (!project) return false;
  const sets: string[] = [];
  const binds: (string | number)[] = [];
  if (input.draft) {
    sets.push("draft_json = ?");
    binds.push(JSON.stringify(input.draft));
  }
  if (input.defaults) {
    sets.push("defaults_json = ?");
    binds.push(JSON.stringify(input.defaults));
  }
  if (sets.length === 0) return true;
  await db
    .prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`)
    .bind(...binds, projectId, userId)
    .run();
  return true;
}

/** True when the project exists and belongs to this user. */
export async function ownsProject(db: D1Database, userId: string, projectId: string): Promise<boolean> {
  return Boolean(await ownedProject(db, userId, projectId));
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
    budget: project.budget,
    cast: project.cast,
  };
}
