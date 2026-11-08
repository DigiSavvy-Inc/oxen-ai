/**
 * The composer state a project keeps between visits. Sessions folded into this:
 * one draft per project (scene prompt, mode, model, settings) and the defaults the
 * last run left behind (mode, model, settings). Values are composer-shaped strings
 * and booleans, never media.
 */

export const COMPOSER_SETTING_KEYS = [
  "aspectRatio",
  "duration",
  "seed",
  "quality",
  "resolution",
  "outputFormat",
  "referenceTask",
  "generateAudio",
  "draft",
  "safetyTolerance",
  "safetyCheckerOn",
  "moderation",
  "background",
  "sampleRate",
  "speed",
  "volume",
  "pitch",
  "getLastFrame",
] as const;

export type ComposerSettingKey = (typeof COMPOSER_SETTING_KEYS)[number];

export type ComposerSettings = Partial<Record<ComposerSettingKey, string | boolean>>;

export type ComposerDefaults = {
  mode: string | null;
  model: string;
  settings: ComposerSettings;
};

export type ComposerDraft = ComposerDefaults & {
  /** The scene text the composer showed last. Null when the draft has no prompt yet. */
  prompt: string | null;
};

const SETTING_VALUE_MAX = 64;
const MODEL_ID_MAX = 200;
const DRAFT_PROMPT_MAX = 8000;

export function acceptComposerSettings(raw: unknown): ComposerSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const out: ComposerSettings = {};
  for (const key of COMPOSER_SETTING_KEYS) {
    const value = record[key];
    if (typeof value === "boolean") out[key] = value;
    else if (typeof value === "string" && value.length <= SETTING_VALUE_MAX) out[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = String(value);
  }
  return out;
}

function acceptMode(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() && raw.length <= 64 ? raw.trim() : null;
}

function acceptModel(raw: unknown): string {
  return typeof raw === "string" && raw.length <= MODEL_ID_MAX ? raw.trim() : "";
}

/** Null when the body is not an object. A draft may carry no prompt. */
export function acceptComposerDraft(raw: unknown): ComposerDraft | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const prompt =
    typeof record.prompt === "string" && record.prompt.length <= DRAFT_PROMPT_MAX ? record.prompt : null;
  return {
    prompt,
    mode: acceptMode(record.mode),
    model: acceptModel(record.model),
    settings: acceptComposerSettings(record.settings),
  };
}

export function acceptComposerDefaults(raw: unknown): ComposerDefaults | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  return {
    mode: acceptMode(record.mode),
    model: acceptModel(record.model),
    settings: acceptComposerSettings(record.settings),
  };
}

/** Stored JSON → draft. An empty or broken column reads as no draft. */
export function draftFromJson(raw: string | null | undefined): ComposerDraft | null {
  const draft = acceptComposerDraft(parse(raw));
  if (!draft) return null;
  if (draft.prompt == null && !draft.mode && !draft.model && Object.keys(draft.settings).length === 0) {
    return null;
  }
  return draft;
}

export function defaultsFromJson(raw: string | null | undefined): ComposerDefaults | null {
  const defaults = acceptComposerDefaults(parse(raw));
  if (!defaults) return null;
  if (!defaults.mode && !defaults.model && Object.keys(defaults.settings).length === 0) return null;
  return defaults;
}

function parse(raw: string | null | undefined): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
