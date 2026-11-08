import { galleryKeyForUser } from "./galleries";
import {
  acceptBasePrompt,
  acceptJobCost,
  acceptJobKind,
  groupJobRows,
  JOB_NAME_MAX,
  JOB_REFS_MAX,
  jobSettingsFromParams,
  jobStatus,
  multiPromptFromParams,
  parseJobParams,
  PROJECT_JOBS_MAX,
  type JobRef,
  type JobRefJson,
  type JobOutputJson,
  type JobRow,
  type ProjectJobJson,
} from "./job-record";
import { looksFromParams } from "./looks";
import { displayStoredMediaUrl } from "./media";
import { normalizeMediaRole } from "./schema";
import type { Env } from "./types";

export {
  acceptBasePrompt,
  acceptJobCost,
  groupJobRows,
  JOB_REFS_MAX,
  JOB_SETTING_FIELDS,
  jobSettingsFromParams,
  jobStatus,
  PROJECT_JOBS_MAX,
} from "./job-record";
export type {
  JobKind,
  JobOutputJson,
  JobRef,
  JobRefJson,
  JobRow,
  JobSettingValue,
  JobStatus,
  ProjectJobJson,
} from "./job-record";

export type JobRecord = {
  refs: JobRef[];
  cost: number | null;
  basePrompt: string | null;
};

/** The references the client says it attached. Entries that are not this user's media are dropped. */
export function acceptJobRefs(userId: string, raw: unknown): JobRef[] {
  if (!Array.isArray(raw)) return [];
  const out: JobRef[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const kind = acceptJobKind(record.kind);
    const key = galleryKeyForUser(userId, record.key);
    const number = typeof record.number === "number" ? Math.round(record.number) : NaN;
    if (!kind || !key || !Number.isFinite(number) || number < 1) continue;
    const name = typeof record.name === "string" ? record.name.trim().slice(0, JOB_NAME_MAX) : "";
    out.push({
      kind,
      number,
      role:
        kind === "audio" || typeof record.role !== "string" || !record.role.trim()
          ? null
          : normalizeMediaRole(record.role),
      name: name || key.split("/").pop() || "file",
      key,
    });
    if (out.length >= JOB_REFS_MAX) break;
  }
  return out;
}

/** The Studio bookkeeping recorded with a generation. */
export function jobRecordFromParams(userId: string, paramsJson: string | null | undefined): JobRecord {
  const params = parseJobParams(paramsJson);
  if (!params) return { refs: [], cost: null, basePrompt: null };
  return {
    refs: acceptJobRefs(userId, params.studio_refs),
    cost: acceptJobCost(params.studio_cost),
    basePrompt: acceptBasePrompt(params.studio_prompt),
  };
}

async function tagsFor(env: Env, userId: string, ids: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  try {
    const { results } = await env.DB.prepare(
      `SELECT generation_id AS generationId, tag FROM generation_tags
       WHERE user_id = ? AND generation_id IN (${ids.map(() => "?").join(",")})
       ORDER BY created_at ASC`,
    )
      .bind(userId, ...ids)
      .all<{ generationId: string; tag: string }>();
    for (const row of results ?? []) {
      const list = map.get(row.generationId) ?? [];
      list.push(row.tag);
      map.set(row.generationId, list);
    }
  } catch {
    /* tags are optional on a job */
  }
  return map;
}

/** Present one batch. URLs for refs and outputs are freshly signed. */
export async function presentJob(
  env: Env,
  userId: string,
  projectId: string,
  rows: readonly JobRow[],
  tags: Map<string, string[]>,
): Promise<ProjectJobJson | null> {
  const first = rows[0];
  if (!first) return null;
  const record = jobRecordFromParams(userId, first.params_json);
  const urlFor = new Map<string, Promise<string | null>>();
  const signed = (key: string | null | undefined, fallback: string | null) => {
    if (!key) return Promise.resolve(fallback);
    let pending = urlFor.get(key);
    if (!pending) {
      pending = displayStoredMediaUrl(env, key, null);
      urlFor.set(key, pending);
    }
    return pending;
  };
  const refs: JobRefJson[] = await Promise.all(
    record.refs.map(async (ref) => {
      const url = await signed(ref.key, null);
      return { ...ref, url, thumbUrl: ref.kind === "image" ? url : null };
    }),
  );
  const outputs: JobOutputJson[] = await Promise.all(
    rows.map(async (row) => {
      const [resultUrl, thumbUrl] = await Promise.all([
        signed(row.result_key, row.result_url),
        signed(row.thumb_key, null),
      ]);
      return {
        id: row.id,
        status: row.status,
        mediaType: row.media_type,
        resultUrl,
        resultKey: row.result_key ?? null,
        thumbUrl,
        errorMessage: row.error_message,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        tags: tags.get(row.id) ?? [],
      };
    }),
  );
  return {
    batchId: first.batch_id || first.id,
    projectId,
    createdAt: first.created_at,
    mode: first.mode,
    model: first.model,
    prompt: first.prompt ?? "",
    basePrompt: record.basePrompt,
    looks: looksFromParams(first.params_json),
    refs,
    settings: jobSettingsFromParams(first.params_json),
    multiPrompt: multiPromptFromParams(first.params_json),
    cost: record.cost,
    status: jobStatus(rows.map((row) => row.status)),
    outputs,
  };
}

/** The project's runs, newest first. The same generation rows the library shows. */
export async function listProjectJobs(
  env: Env,
  userId: string,
  projectId: string,
  limit = PROJECT_JOBS_MAX,
): Promise<ProjectJobJson[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, mode, model, prompt, status, media_type, result_url, result_key, thumb_key,
            params_json, error_message, batch_id, project_id, created_at, updated_at
     FROM generations
     WHERE user_id = ? AND project_id = ?
     ORDER BY created_at DESC, id ASC
     LIMIT ?`,
  )
    .bind(userId, projectId, Math.max(1, limit) * 4)
    .all<JobRow>();
  const rows = results ?? [];
  const tags = await tagsFor(
    env,
    userId,
    rows.map((row) => row.id),
  );
  const groups = groupJobRows(rows).slice(0, limit);
  const jobs = await Promise.all(groups.map((group) => presentJob(env, userId, projectId, group, tags)));
  return jobs.filter((job): job is ProjectJobJson => job !== null);
}

/** Job count and last run time per project, for the list and the header. */
export async function projectJobStats(
  db: D1Database,
  userId: string,
  projectIds: readonly string[],
): Promise<Map<string, { jobs: number; lastRunAt: number }>> {
  const stats = new Map<string, { jobs: number; lastRunAt: number }>();
  if (projectIds.length === 0) return stats;
  const placeholders = projectIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT project_id, COUNT(DISTINCT COALESCE(batch_id, id)) AS jobs, MAX(created_at) AS last_run
       FROM generations
       WHERE user_id = ? AND project_id IN (${placeholders})
       GROUP BY project_id`,
    )
    .bind(userId, ...projectIds)
    .all<{ project_id: string; jobs: number; last_run: number }>();
  for (const row of results ?? []) {
    stats.set(row.project_id, { jobs: Number(row.jobs) || 0, lastRunAt: Number(row.last_run) || 0 });
  }
  return stats;
}
