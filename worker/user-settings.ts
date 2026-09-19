import type { GenerationMode } from "./types";

export type SharedOxenParams = {
  aspect_ratio?: string;
  seed?: number;
  duration?: number | string;
  generate_audio?: boolean;
  num_generations?: number;
  quality?: string;
  resolution?: string;
  output_format?: string;
  background?: string;
};

export type StudioSettings = {
  defaultModelByMode: Partial<Record<GenerationMode, string>>;
  lastParams: SharedOxenParams;
};

const EMPTY: StudioSettings = {
  defaultModelByMode: {},
  lastParams: {},
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
  if (typeof raw.background === "string") params.background = raw.background;
  return params;
}

export function parseStudioSettings(
  defaultModelByMode: string | null | undefined,
  lastParams: string | null | undefined,
): StudioSettings {
  return {
    defaultModelByMode: asModeMap(parseJsonObject(defaultModelByMode)),
    lastParams: asParams(parseJsonObject(lastParams)),
  };
}

export async function getStudioSettings(
  db: D1Database,
  userId: string,
): Promise<StudioSettings> {
  const row = await db
    .prepare(
      `SELECT default_model_by_mode, last_params FROM user_settings WHERE user_id = ?`,
    )
    .bind(userId)
    .first<{ default_model_by_mode: string; last_params: string }>();
  if (!row) return { ...EMPTY, defaultModelByMode: {}, lastParams: {} };
  return parseStudioSettings(row.default_model_by_mode, row.last_params);
}

export async function saveStudioSettings(
  db: D1Database,
  userId: string,
  patch: {
    defaultModelByMode?: Partial<Record<GenerationMode, string>>;
    lastParams?: Record<string, unknown>;
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
  };
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO user_settings (user_id, default_model_by_mode, last_params, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         default_model_by_mode = excluded.default_model_by_mode,
         last_params = excluded.last_params,
         updated_at = excluded.updated_at`,
    )
    .bind(
      userId,
      JSON.stringify(next.defaultModelByMode),
      JSON.stringify(next.lastParams),
      now,
    )
    .run();
  return next;
}
