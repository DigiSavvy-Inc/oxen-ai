import { clampHistoryPageSize, DEFAULT_HISTORY_PAGE_SIZE } from "./user-settings";

export type LibraryPage = {
  page: number;
  pageSize: number;
  tag: string;
};

const BATCH_KEY = `CASE WHEN batch_id IS NOT NULL AND TRIM(batch_id) != '' THEN batch_id ELSE 'legacy' || char(0) || created_at || char(0) || mode || char(0) || IFNULL(media_type, '') || char(0) || model || char(0) || IFNULL(prompt, '') END`;

function keyedAndMatched(profileId?: string | null): string {
  const profile = profileId ? " AND profile_id = ?" : "";
  return `keyed AS (
    SELECT id, created_at, ${BATCH_KEY} AS batch_key
    FROM generations
    WHERE user_id = ?${profile}
  ),
  matched AS (
    SELECT k.batch_key AS batch_key, MAX(k.created_at) AS newest
    FROM keyed k
    WHERE ? = '' OR EXISTS (
      SELECT 1 FROM generation_tags t
      WHERE t.generation_id = k.id
        AND t.user_id = ?
        AND LOWER(t.tag) LIKE ? ESCAPE '\\'
    )
    GROUP BY k.batch_key
  )`;
}

export function parseLibraryPage(
  pageRaw: string | undefined,
  pageSizeRaw: string | undefined,
  tagRaw: string | undefined,
): LibraryPage {
  const pageSize = clampHistoryPageSize(pageSizeRaw ?? DEFAULT_HISTORY_PAGE_SIZE);
  const parsedPage = Number(pageRaw);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1;
  const tag = (tagRaw ?? "").trim().replace(/^#+/, "").slice(0, 32);
  return { page, pageSize, tag };
}

export function tagLikePattern(tag: string): string {
  const needle = tag.trim().replace(/^#+/, "").toLowerCase();
  return `%${needle.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function matchBinds(userId: string, tag: string, profileId?: string | null): unknown[] {
  const profile = profileId ? [profileId] : [];
  return [userId, ...profile, tag ? "1" : "", userId, tagLikePattern(tag)];
}

export function libraryCountSql(
  userId: string,
  query: LibraryPage,
  profileId?: string | null,
): { sql: string; binds: unknown[] } {
  return {
    sql: `WITH ${keyedAndMatched(profileId)}
      SELECT COUNT(*) AS total FROM matched`,
    binds: matchBinds(userId, query.tag, profileId),
  };
}

export function libraryListSql(
  userId: string,
  query: LibraryPage,
  profileId?: string | null,
): { sql: string; binds: unknown[] } {
  const offset = (query.page - 1) * query.pageSize;
  const profile = profileId ? " AND g.profile_id = ?" : "";
  const profileBind = profileId ? [profileId] : [];
  return {
    sql: `WITH ${keyedAndMatched(profileId)},
      paged AS (
        SELECT batch_key FROM matched
        ORDER BY newest DESC, batch_key DESC
        LIMIT ? OFFSET ?
      )
      SELECT g.*
      FROM generations g
      JOIN keyed k ON k.id = g.id
      JOIN paged p ON p.batch_key = k.batch_key
      WHERE g.user_id = ?${profile}
      ORDER BY g.created_at DESC, g.id DESC`,
    binds: [...matchBinds(userId, query.tag, profileId), query.pageSize, offset, userId, ...profileBind],
  };
}

export function userTagsSql(): string {
  return `SELECT DISTINCT tag FROM generation_tags WHERE user_id = ? ORDER BY tag COLLATE NOCASE`;
}
