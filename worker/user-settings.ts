import { clampHistoryPageSize, DEFAULT_HISTORY_PAGE_SIZE, HISTORY_PAGE_SIZES } from "./history-page-size";
import type { GenerationMode } from "./types";

export { clampHistoryPageSize, DEFAULT_HISTORY_PAGE_SIZE, HISTORY_PAGE_SIZES };

export type SharedOxenParams = {
  aspect_ratio?: string;
  seed?: number;
  duration?: number | string;
  generate_audio?: boolean;
  num_generations?: number;
  quality?: string;
  resolution?: string;
  output_format?: string;
  omni_reference_task_type?: string;
  background?: string;
  safety_tolerance?: number;
  sample_rate?: number;
  speed?: number;
  volume?: number;
  pitch?: number;
};

export type StudioSettings = {
  defaultModelByMode: Partial<Record<GenerationMode, string>>;
  lastParams: SharedOxenParams;
  historyPageSize: number;
};

const EMPTY: StudioSettings = {
  defaultModelByMode: {},
  lastParams: {},
  historyPageSize: DEFAULT_HISTORY_PAGE_SIZE,
};

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function asModeMap(raw: Record<string, unknown>): Partial<Record<GenerationMode, string>> {
  const out: Partial<Record<GenerationMode, string>> = {};
  for (const [mode, id] of Object.entries(raw)) {
    if (typeof id === "string" && id.trim()) {
      out[mode as GenerationMode] = id.trim();
    }
  }
  return out;
}

function asParams(raw: Record<string, unknown>): SharedOxenParams {
  const params: SharedOxenParams = {};
  if (typeof raw.aspect_ratio === "string") params.aspect_ratio = raw.aspect_ratio;
  if (typeof raw.seed === "number" && Number.isFinite(raw.seed)) params.seed = raw.seed;
  if (typeof raw.duration === "number" || typeof raw.duration === "string") {
    params.duration = raw.duration;
  }
  if (typeof raw.generate_audio === "boolean") params.generate_audio = raw.generate_audio;
  if (typeof raw.num_generations === "number" && Number.isFinite(raw.num_generations)) {
    params.num_generations = Math.min(4, Math.max(1, Math.round(raw.num_generations)));
  }
  if (typeof raw.quality === "string") params.quality = raw.quality;
  if (typeof raw.resolution === "string") params.resolution = raw.resolution;
  if (typeof raw.output_format === "string") params.output_format = raw.output_format;
  if (
    raw.omni_reference_task_type === "auto" ||
    raw.omni_reference_task_type === "edit" ||
    raw.omni_reference_task_type === "extend"
  ) {
    params.omni_reference_task_type = raw.omni_reference_task_type;
  }
  if (typeof raw.background === "string") params.background = raw.background;
  if (typeof raw.safety_tolerance === "number" && Number.isFinite(raw.safety_tolerance)) {
    params.safety_tolerance = raw.safety_tolerance;
  } else if (
    typeof raw.safety_tolerance === "string" &&
    raw.safety_tolerance.trim() &&
    Number.isFinite(Number(raw.safety_tolerance))
  ) {
    params.safety_tolerance = Number(raw.safety_tolerance);
  }
  if (typeof raw.sample_rate === "number" && Number.isFinite(raw.sample_rate)) {
    params.sample_rate = raw.sample_rate;
  }
  if (typeof raw.speed === "number" && Number.isFinite(raw.speed)) params.speed = raw.speed;
  if (typeof raw.volume === "number" && Number.isFinite(raw.volume)) params.volume = raw.volume;
  if (typeof raw.pitch === "number" && Number.isFinite(raw.pitch)) params.pitch = raw.pitch;
  return params;
}

export function parseStudioSettings(
  defaultModelByMode: string | null | undefined,
  lastParams: string | null | undefined,
  historyPageSize?: number | string | null,
): StudioSettings {
  return {
    defaultModelByMode: asModeMap(parseJsonObject(defaultModelByMode)),
    lastParams: asParams(parseJsonObject(lastParams)),
    historyPageSize: clampHistoryPageSize(historyPageSize ?? DEFAULT_HISTORY_PAGE_SIZE),
  };
}

function missingHistoryColumn(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("history_page_size") || message.includes("no such column");
}

type SettingsRow = {
  default_model_by_mode: string;
  last_params: string;
  history_page_size?: number | null;
};

export async function getStudioSettings(
  db: D1Database,
  userId: string,
): Promise<StudioSettings> {
  let row: SettingsRow | null = null;
  try {
    row = await db
      .prepare(
        `SELECT default_model_by_mode, last_params, history_page_size FROM user_settings WHERE user_id = ?`,
      )
      .bind(userId)
      .first<SettingsRow>();
  } catch (err) {
    if (!missingHistoryColumn(err)) throw err;
    row = await db
      .prepare(`SELECT default_model_by_mode, last_params FROM user_settings WHERE user_id = ?`)
      .bind(userId)
      .first<SettingsRow>();
  }
  if (!row) return { ...EMPTY, defaultModelByMode: {}, lastParams: {} };
  return parseStudioSettings(row.default_model_by_mode, row.last_params, row.history_page_size);
}

export async function saveStudioSettings(
  db: D1Database,
  userId: string,
  patch: {
    defaultModelByMode?: Partial<Record<GenerationMode, string>>;
    lastParams?: Record<string, unknown>;
    historyPageSize?: number;
  },
): Promise<StudioSettings> {
  const current = await getStudioSettings(db, userId);
  const next: StudioSettings = {
    defaultModelByMode: asModeMap(
      (patch.defaultModelByMode ?? current.defaultModelByMode) as Record<string, unknown>,
    ),
    lastParams: asParams({
      ...current.lastParams,
      ...(patch.lastParams ?? {}),
    }),
    historyPageSize: clampHistoryPageSize(patch.historyPageSize ?? current.historyPageSize),
  };
  const now = Math.floor(Date.now() / 1000);
  const models = JSON.stringify(next.defaultModelByMode);
  const params = JSON.stringify(next.lastParams);
  try {
    await db
      .prepare(
        `INSERT INTO user_settings (user_id, default_model_by_mode, last_params, history_page_size, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           default_model_by_mode = excluded.default_model_by_mode,
           last_params = excluded.last_params,
           history_page_size = excluded.history_page_size,
           updated_at = excluded.updated_at`,
      )
      .bind(userId, models, params, next.historyPageSize, now)
      .run();
  } catch (err) {
    if (!missingHistoryColumn(err)) throw err;
    await db
      .prepare(
        `INSERT INTO user_settings (user_id, default_model_by_mode, last_params, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           default_model_by_mode = excluded.default_model_by_mode,
           last_params = excluded.last_params,
           updated_at = excluded.updated_at`,
      )
      .bind(userId, models, params, now)
      .run();
  }
  return next;
}
