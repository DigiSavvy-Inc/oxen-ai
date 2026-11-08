import type { AppliedLook } from "./looks";
import type { MediaRole } from "./schema";

/**
 * A job is one generation batch (`batch_id`) run from a project. The record of what was
 * sent lives on the generation rows: the prompt as sent, the redacted Oxen payload, and
 * Studio bookkeeping in params_json (`studio_looks`, `studio_refs`, `studio_cost`,
 * `studio_prompt`). Nothing here stores a data URI.
 *
 * This module has no bindings so the client can share the types and the pure helpers.
 */

export type JobKind = "image" | "video" | "audio";

/** One reference as it was attached: its project number, role, and the Studio key behind it. */
export type JobRef = {
  kind: JobKind;
  number: number;
  role: MediaRole | null;
  name: string;
  key: string;
};

export type JobRefJson = JobRef & { url: string | null; thumbUrl: string | null };

export type JobOutputJson = {
  id: string;
  status: string;
  mediaType: string | null;
  resultUrl: string | null;
  resultKey: string | null;
  thumbUrl: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
  tags: string[];
};

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "partial";

export type JobSettingValue = string | number | boolean;

export type JobShot = { prompt: string; duration?: number | string };

export type ProjectJobJson = {
  batchId: string;
  projectId: string;
  createdAt: number;
  mode: string;
  model: string;
  /** The prompt as sent: looks ahead of the scene text, mentions resolved by the model. */
  prompt: string;
  /** The composer prompt before the looks were placed ahead of it. Null when they match. */
  basePrompt: string | null;
  looks: AppliedLook[];
  refs: JobRefJson[];
  settings: Record<string, JobSettingValue>;
  multiPrompt: JobShot[] | null;
  cost: number | null;
  status: JobStatus;
  outputs: JobOutputJson[];
};

export const JOB_REFS_MAX = 96;
export const JOB_NAME_MAX = 180;
const JOB_PROMPT_MAX = 8000;
export const PROJECT_JOBS_MAX = 60;

/** Oxen payload fields that are settings, as opposed to the prompt, the model, or media. */
export const JOB_SETTING_FIELDS = [
  "aspect_ratio",
  "duration",
  "seed",
  "generate_audio",
  "draft",
  "num_generations",
  "quality",
  "resolution",
  "output_format",
  "background",
  "moderation",
  "disable_safety_checker",
  "enable_safety_checker",
  "safety_tolerance",
  "omni_reference_task_type",
  "sample_rate",
  "speed",
  "volume",
  "pitch",
  "capture_last_frame",
] as const;

export function acceptJobKind(raw: unknown): JobKind | null {
  switch (raw) {
    case "image":
    case "video":
    case "audio":
      return raw;
    default:
      return null;
  }
}

/** An estimated cost in USD, as the composer showed it. Anything else reads as unknown. */
export function acceptJobCost(raw: unknown): number | null {
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 10_000) / 10_000;
}

export function acceptBasePrompt(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > JOB_PROMPT_MAX) return null;
  return text;
}

export function parseJobParams(paramsJson: string | null | undefined): Record<string, unknown> | null {
  if (!paramsJson) return null;
  try {
    const parsed = JSON.parse(paramsJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The settings that went to Oxen, by field name. Media, prompt, and model are left out. */
export function jobSettingsFromParams(paramsJson: string | null | undefined): Record<string, JobSettingValue> {
  const params = parseJobParams(paramsJson);
  const out: Record<string, JobSettingValue> = {};
  if (!params) return out;
  for (const field of JOB_SETTING_FIELDS) {
    const value = params[field];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[field] = value;
    }
  }
  return out;
}

export function multiPromptFromParams(paramsJson: string | null | undefined): JobShot[] | null {
  const params = parseJobParams(paramsJson);
  if (!params || !Array.isArray(params.multi_prompt)) return null;
  const shots: JobShot[] = [];
  for (const entry of params.multi_prompt) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { prompt?: unknown; duration?: unknown };
    if (typeof record.prompt !== "string") continue;
    shots.push({
      prompt: record.prompt,
      duration:
        typeof record.duration === "number" || typeof record.duration === "string"
          ? record.duration
          : undefined,
    });
  }
  return shots.length > 0 ? shots : null;
}

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

/** One status for the batch. A mix of finished and failed outputs reads as partial. */
export function jobStatus(statuses: readonly string[]): JobStatus {
  if (statuses.length === 0) return "queued";
  if (statuses.every((status) => status === "succeeded")) return "succeeded";
  if (statuses.every((status) => status === "failed")) return "failed";
  if (statuses.every((status) => status === "cancelled")) return "cancelled";
  if (statuses.some((status) => !TERMINAL.has(status))) {
    return statuses.every((status) => status === "queued") ? "queued" : "running";
  }
  return "partial";
}

export type JobRow = {
  id: string;
  oxen_generation_id?: string;
  mode: string;
  model: string;
  prompt: string | null;
  status: string;
  media_type: string | null;
  result_url: string | null;
  result_key?: string | null;
  thumb_key?: string | null;
  params_json?: string | null;
  error_message: string | null;
  batch_id?: string | null;
  project_id?: string | null;
  created_at: number;
  updated_at: number;
};

/** Rows grouped into batches, newest batch first, outputs in the order they were made. */
export function groupJobRows<T extends { id: string; batch_id?: string | null; created_at: number }>(
  rows: readonly T[],
): T[][] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = row.batch_id || row.id;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.values()]
    .map((group) => [...group].sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id)))
    .sort((a, b) => (b[0]?.created_at ?? 0) - (a[0]?.created_at ?? 0));
}
