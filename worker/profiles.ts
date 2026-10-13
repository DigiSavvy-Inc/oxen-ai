import { DEFAULT_HISTORY_PAGE_SIZE } from "./history-page-size";

export const PROFILE_NAME_MAX = 40;
export const PROFILE_MAX_ROWS = 20;
export const DEFAULT_PROFILE_NAME = "Personal";

export type StudioProfile = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type ProfileState = {
  profiles: StudioProfile[];
  activeId: string | null;
};

export type ProfileFailure = "name" | "missing" | "last" | "limit" | "unavailable";

export type ProfileResult = ProfileState | { error: ProfileFailure };

type ProfileRow = {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
};

function missingProfileStorage(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("no such table") || message.includes("no such column");
}

export function acceptProfileName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name || name.length > PROFILE_NAME_MAX) return null;
  return name;
}

function toProfile(row: ProfileRow): StudioProfile {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listProfiles(db: D1Database, userId: string): Promise<StudioProfile[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, created_at, updated_at FROM profiles
       WHERE user_id = ?
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .bind(userId, PROFILE_MAX_ROWS)
    .all<ProfileRow>();
  return (results ?? []).map(toProfile);
}

async function readActiveProfile(db: D1Database, userId: string): Promise<string | null> {
  try {
    const row = await db
      .prepare(`SELECT active_profile_id FROM user_settings WHERE user_id = ?`)
      .bind(userId)
      .first<{ active_profile_id: string | null }>();
    const id = row?.active_profile_id?.trim() ?? "";
    return id || null;
  } catch (err) {
    if (!missingProfileStorage(err)) throw err;
    return null;
  }
}

async function setActiveProfile(db: D1Database, userId: string, profileId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  try {
    const updated = await db
      .prepare(`UPDATE user_settings SET active_profile_id = ?, updated_at = ? WHERE user_id = ?`)
      .bind(profileId, now, userId)
      .run();
    if ((updated.meta?.changes ?? 1) !== 0) return;
  } catch (err) {
    if (!missingProfileStorage(err)) throw err;
    return;
  }
  try {
    await db
      .prepare(
        `INSERT INTO user_settings
          (user_id, default_model_by_mode, last_params, history_page_size, active_profile_id, updated_at)
         VALUES (?, '{}', '{}', ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           active_profile_id = excluded.active_profile_id,
           updated_at = excluded.updated_at`,
      )
      .bind(userId, DEFAULT_HISTORY_PAGE_SIZE, profileId, now)
      .run();
  } catch (err) {
    if (!missingProfileStorage(err)) throw err;
  }
}

async function backfillProfile(db: D1Database, userId: string, profileId: string): Promise<void> {
  await db
    .prepare(`UPDATE generations SET profile_id = ? WHERE user_id = ? AND profile_id IS NULL`)
    .bind(profileId, userId)
    .run();
  await db
    .prepare(`UPDATE galleries SET profile_id = ? WHERE user_id = ? AND profile_id IS NULL`)
    .bind(profileId, userId)
    .run();
}

/**
 * Two requests can each insert Personal before either sees the other.
 * Fold those copies, created in the same moment, back into one profile.
 */
async function mergeRacedDefaultProfiles(
  db: D1Database,
  userId: string,
  profiles: StudioProfile[],
  activeId: string | null,
): Promise<void> {
  const defaults = profiles.filter((profile) => profile.name === DEFAULT_PROFILE_NAME);
  if (defaults.length < 2) return;
  const newest = Math.max(...defaults.map((profile) => profile.createdAt));
  const cluster = defaults.filter((profile) => newest - profile.createdAt <= 5);
  if (cluster.length < 2) return;
  const keeper = cluster.find((profile) => profile.id === activeId) ?? cluster[0];
  if (!keeper) return;
  for (const extra of cluster) {
    if (extra.id === keeper.id) continue;
    await db
      .prepare(`UPDATE generations SET profile_id = ? WHERE user_id = ? AND profile_id = ?`)
      .bind(keeper.id, userId, extra.id)
      .run();
    await db
      .prepare(`UPDATE galleries SET profile_id = ? WHERE user_id = ? AND profile_id = ?`)
      .bind(keeper.id, userId, extra.id)
      .run();
    await db.prepare(`DELETE FROM profiles WHERE id = ? AND user_id = ?`).bind(extra.id, userId).run();
  }
}

/** The account's active profile. Null when the profiles table is not there yet. */
export async function ensureDefaultProfile(db: D1Database, userId: string): Promise<string | null> {
  let profiles: StudioProfile[];
  try {
    profiles = await listProfiles(db, userId);
  } catch (err) {
    if (!missingProfileStorage(err)) throw err;
    return null;
  }
  if (profiles.length === 0) {
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    try {
      await db
        .prepare(
          `INSERT INTO profiles (id, user_id, name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(id, userId, DEFAULT_PROFILE_NAME, now, now)
        .run();
      await backfillProfile(db, userId, id);
      await setActiveProfile(db, userId, id);
    } catch (err) {
      if (!missingProfileStorage(err)) throw err;
      return null;
    }
    try {
      profiles = await listProfiles(db, userId);
    } catch (err) {
      if (!missingProfileStorage(err)) throw err;
      return null;
    }
    if (profiles.length === 0) return null;
  }
  const activeBeforeMerge = await readActiveProfile(db, userId);
  await mergeRacedDefaultProfiles(db, userId, profiles, activeBeforeMerge);
  try {
    profiles = await listProfiles(db, userId);
  } catch (err) {
    if (!missingProfileStorage(err)) throw err;
    return null;
  }
  if (profiles.length === 0) return null;
  const active = await readActiveProfile(db, userId);
  const chosen = profiles.some((profile) => profile.id === active) ? active! : profiles[0]!.id;
  if (chosen !== active) await setActiveProfile(db, userId, chosen);
  return chosen;
}

export async function profileState(db: D1Database, userId: string): Promise<ProfileState> {
  const activeId = await ensureDefaultProfile(db, userId);
  if (!activeId) return { profiles: [], activeId: null };
  try {
    return { profiles: await listProfiles(db, userId), activeId };
  } catch (err) {
    if (!missingProfileStorage(err)) throw err;
    return { profiles: [], activeId: null };
  }
}

async function stateFor(db: D1Database, userId: string, activeId: string): Promise<ProfileState> {
  return { profiles: await listProfiles(db, userId), activeId };
}

export async function createProfile(db: D1Database, userId: string, nameRaw: unknown): Promise<ProfileResult> {
  const name = acceptProfileName(nameRaw);
  if (!name) return { error: "name" };
  const ready = await ensureDefaultProfile(db, userId);
  if (!ready) return { error: "unavailable" };
  const existing = await listProfiles(db, userId);
  if (existing.length >= PROFILE_MAX_ROWS) return { error: "limit" };
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO profiles (id, user_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, name, now, now)
    .run();
  await setActiveProfile(db, userId, id);
  return stateFor(db, userId, id);
}

export async function renameProfile(
  db: D1Database,
  userId: string,
  id: string,
  nameRaw: unknown,
): Promise<ProfileResult> {
  const name = acceptProfileName(nameRaw);
  if (!name) return { error: "name" };
  const activeId = await ensureDefaultProfile(db, userId);
  if (!activeId) return { error: "unavailable" };
  const updated = await db
    .prepare(`UPDATE profiles SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .bind(name, Math.floor(Date.now() / 1000), id, userId)
    .run();
  if (updated.meta?.changes === 0) return { error: "missing" };
  return stateFor(db, userId, activeId);
}

export async function activateProfile(db: D1Database, userId: string, id: string): Promise<ProfileResult> {
  const activeId = await ensureDefaultProfile(db, userId);
  if (!activeId) return { error: "unavailable" };
  const profiles = await listProfiles(db, userId);
  if (!profiles.some((profile) => profile.id === id)) return { error: "missing" };
  await setActiveProfile(db, userId, id);
  return stateFor(db, userId, id);
}

export async function deleteProfile(db: D1Database, userId: string, id: string): Promise<ProfileResult> {
  const activeId = await ensureDefaultProfile(db, userId);
  if (!activeId) return { error: "unavailable" };
  const profiles = await listProfiles(db, userId);
  if (profiles.length <= 1) return { error: "last" };
  if (!profiles.some((profile) => profile.id === id)) return { error: "missing" };
  const fallback = profiles.find((profile) => profile.id !== id);
  if (!fallback) return { error: "last" };
  await db
    .prepare(`UPDATE generations SET profile_id = ? WHERE user_id = ? AND profile_id = ?`)
    .bind(fallback.id, userId, id)
    .run();
  await db
    .prepare(`UPDATE galleries SET profile_id = ? WHERE user_id = ? AND profile_id = ?`)
    .bind(fallback.id, userId, id)
    .run();
  await db.prepare(`DELETE FROM profiles WHERE id = ? AND user_id = ?`).bind(id, userId).run();
  const nextActive = activeId === id ? fallback.id : activeId;
  await setActiveProfile(db, userId, nextActive);
  return stateFor(db, userId, nextActive);
}

export async function stampGenerationProfile(
  db: D1Database,
  userId: string,
  generationId: string,
  profileId: string | null,
): Promise<void> {
  if (!profileId) return;
  try {
    await db
      .prepare(`UPDATE generations SET profile_id = ? WHERE id = ? AND user_id = ? AND profile_id IS NULL`)
      .bind(profileId, generationId, userId)
      .run();
  } catch (err) {
    if (!missingProfileStorage(err)) throw err;
  }
}
