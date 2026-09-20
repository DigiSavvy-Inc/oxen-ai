import type { OxenModel, OxenPricing } from "./oxen";
import { controlOptionsFromPricing, parseOxenPricing } from "./pricing";

export type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  items?: JsonSchema;
  maxItems?: number;
  minItems?: number;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
};

export type MediaKind = "image" | "video" | "audio";

export type MediaField =
  | "input_image"
  | "input_images"
  | "input_video"
  | "input_videos"
  | "input_audio"
  | "input_audios";

export const DEFAULT_AUDIO_ARRAY_MAX = 16;

export type MediaSlot = {
  field: MediaField;
  kind: MediaKind;
  required: boolean;
  maxItems: number;
  asArray: boolean;
};

export type DurationControl =
  | { kind: "int"; min: number; max: number; defaultValue?: number }
  | { kind: "enum"; values: string[]; defaultValue?: string };

export type ResolutionField = "resolution" | "size" | "image_size";

export type ModelControls = {
  modelId: string;
  aspectRatios: string[] | null;
  duration: DurationControl | null;
  seed: boolean;
  generateAudio: boolean;
  quality: string[] | null;
  resolution: string[] | null;
  resolutionField: ResolutionField;
  outputFormat: string[] | null;
  background: string[] | null;
  slots: MediaSlot[];
  mentions: boolean;
  pricing: OxenPricing | null;
};

const FIELD_KIND: Record<MediaField, MediaKind> = {
  input_image: "image",
  input_images: "image",
  input_video: "video",
  input_videos: "video",
  input_audio: "audio",
  input_audios: "audio",
};

function modelListsAudioInput(model: OxenModel): boolean {
  return (model.capabilities?.input ?? []).some((item) => item.toLowerCase() === "audio");
}

function inferAudioMaxFromText(texts: string[]): number | null {
  const joined = texts.join("\n");
  const patterns = [
    /(?:up to|max(?:imum)?(?: of)?|at most|1\s*[–-]\s*)\s*(\d+)\s+(?:reference\s+)?audio/i,
    /(\d+)\s+(?:reference\s+)?audio(?:s| clips?| files?)?/i,
  ];
  for (const pattern of patterns) {
    const match = joined.match(pattern);
    const value = Number(match?.[1]);
    if (Number.isInteger(value) && value >= 1 && value <= 32) return value;
  }
  return null;
}

function enrichAudioSlots(model: OxenModel, schema: JsonSchema, slots: MediaSlot[]): MediaSlot[] {
  const next = slots.map((slot) => ({ ...slot }));
  const audioSlots = next.filter((slot) => slot.kind === "audio");
  const texts: string[] = [];
  collectSchemaText(schema, texts);
  if (model.description) texts.push(model.description);
  if (model.display_name) texts.push(model.display_name);
  const acceptsAudio =
    audioSlots.length > 0 || modelListsAudioInput(model) || texts.some((text) => /@Audio\d*/i.test(text));
  if (!acceptsAudio) return next;

  const inferredMax = inferAudioMaxFromText(texts) ?? DEFAULT_AUDIO_ARRAY_MAX;
  if (audioSlots.length === 0) {
    next.push({
      field: inferredMax > 1 ? "input_audios" : "input_audio",
      kind: "audio",
      required: false,
      maxItems: inferredMax,
      asArray: inferredMax > 1,
    });
    return next;
  }
  for (const slot of audioSlots) {
    if (slot.asArray) {
      slot.field = "input_audios";
    }
  }
  return next;
}

function asObjectSchema(schema: unknown): JsonSchema | null {
  if (!schema || typeof schema !== "object") return null;
  return schema as JsonSchema;
}

function typeList(schema: JsonSchema): string[] {
  if (Array.isArray(schema.type)) return schema.type;
  if (typeof schema.type === "string") return [schema.type];
  return [];
}

function isArraySchema(schema: JsonSchema): boolean {
  if (typeList(schema).includes("array")) return true;
  if (schema.items) return true;
  return false;
}

function enumStrings(schema: JsonSchema | undefined): string[] {
  if (!schema) return [];
  const values: string[] = [];
  if (Array.isArray(schema.enum)) {
    for (const item of schema.enum) {
      if (typeof item === "string") values.push(item);
      else if (typeof item === "number") values.push(String(item));
    }
  }
  if (typeof schema.const === "string") values.push(schema.const);
  for (const option of [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) {
    values.push(...enumStrings(option));
  }
  return [...new Set(values)];
}

function property(schema: JsonSchema, name: string): JsonSchema | undefined {
  return schema.properties?.[name];
}

function isRequired(schema: JsonSchema, name: string): boolean {
  return (schema.required ?? []).includes(name);
}

function slotFromProperty(
  field: MediaField,
  schema: JsonSchema,
  prop: JsonSchema,
): MediaSlot {
  const asArray = isArraySchema(prop) || field.endsWith("s");
  const maxItems = prop.maxItems ?? (asArray ? 16 : 1);
  return {
    field,
    kind: FIELD_KIND[field],
    required: isRequired(schema, field),
    maxItems: Math.max(1, maxItems),
    asArray,
  };
}

const MENTION_TOKEN = /@(Image|Video|Audio)\d*/i;

function collectSchemaText(schema: JsonSchema, out: string[]): void {
  if (typeof schema.description === "string") out.push(schema.description);
  if (schema.properties) {
    for (const [name, prop] of Object.entries(schema.properties)) {
      out.push(name);
      collectSchemaText(prop, out);
    }
  }
  if (schema.items) collectSchemaText(schema.items, out);
  for (const option of [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])]) {
    collectSchemaText(option, out);
  }
}

function schemaMentionsMedia(schema: JsonSchema): boolean {
  const texts: string[] = [];
  const prompt = property(schema, "prompt");
  if (prompt) {
    collectSchemaText(prompt, texts);
  }
  collectSchemaText(schema, texts);
  return texts.some((text) => MENTION_TOKEN.test(text));
}

function presetSizeTokens(schema: JsonSchema | undefined): string[] {
  if (!schema) return [];
  const texts: string[] = [];
  collectSchemaText(schema, texts);
  const found: string[] = [];
  const token = /\b(1\.5K|1K|2K|3K|4K|480p|720p|768p|1080p)\b/gi;
  for (const text of texts) {
    for (const match of text.matchAll(token)) {
      const value = match[1];
      if (value && !found.some((item) => item.toLowerCase() === value.toLowerCase())) {
        found.push(value);
      }
    }
  }
  return found;
}

export function parseModelControls(model: OxenModel): ModelControls {
  const root = asObjectSchema(model.request_schema) ?? {};
  const slots: MediaSlot[] = [];
  const fields: MediaField[] = [
    "input_image",
    "input_images",
    "input_video",
    "input_videos",
    "input_audio",
    "input_audios",
  ];
  for (const field of fields) {
    const prop = property(root, field);
    if (!prop) continue;
    slots.push(slotFromProperty(field, root, prop));
  }

  const aspect = enumStrings(property(root, "aspect_ratio"));
  const qualityFromSchema = enumStrings(property(root, "quality"));
  const resolutionFromSchema = enumStrings(property(root, "resolution"));
  const sizeFromSchema = enumStrings(property(root, "size"));
  const imageSizeFromSchema = enumStrings(property(root, "image_size"));
  const outputFormat = enumStrings(property(root, "output_format"));
  const background = enumStrings(property(root, "background"));
  const pricing = parseOxenPricing(model.pricing);
  const priced = controlOptionsFromPricing(pricing);

  let resolutionField: ResolutionField = "resolution";
  let resolution = resolutionFromSchema;
  if (resolution.length === 0 && sizeFromSchema.length > 0) {
    resolution = sizeFromSchema;
    resolutionField = "size";
  } else if (resolution.length === 0 && imageSizeFromSchema.length > 0) {
    resolution = imageSizeFromSchema;
    resolutionField = "image_size";
  } else if (resolution.length === 0 && property(root, "size")) {
    resolution = presetSizeTokens(property(root, "size"));
    if (resolution.length === 0) resolution = ["2K"];
    resolutionField = "size";
  } else if (resolution.length === 0 && property(root, "image_size")) {
    resolution = presetSizeTokens(property(root, "image_size"));
    if (resolution.length === 0) resolution = ["2K"];
    resolutionField = "image_size";
  }
  if (resolution.length === 0 && priced.resolution.length > 0) {
    resolution = priced.resolution;
    if (property(root, "size")) resolutionField = "size";
    else if (property(root, "image_size")) resolutionField = "image_size";
  }

  const quality =
    qualityFromSchema.length > 0
      ? qualityFromSchema
      : priced.quality.length > 0
        ? priced.quality
        : [];

  const durationProp = property(root, "duration");
  let duration: DurationControl | null = null;
  if (durationProp) {
    const durationEnums = enumStrings(durationProp);
    if (durationEnums.length > 0) {
      duration = {
        kind: "enum",
        values: durationEnums,
        defaultValue:
          typeof durationProp.default === "string" ? durationProp.default : undefined,
      };
    } else {
      duration = {
        kind: "int",
        min: typeof durationProp.minimum === "number" ? durationProp.minimum : 1,
        max: typeof durationProp.maximum === "number" ? durationProp.maximum : 15,
        defaultValue:
          typeof durationProp.default === "number" ? durationProp.default : undefined,
      };
    }
  }

  const nextSlots = enrichAudioSlots(model, root, slots);
  const mentions =
    schemaMentionsMedia(root) ||
    nextSlots.some((slot) => slot.kind === "image" || slot.kind === "video" || slot.kind === "audio");

  return {
    modelId: model.id,
    aspectRatios: aspect.length > 0 ? aspect : null,
    duration,
    seed: Boolean(property(root, "seed")),
    generateAudio: Boolean(property(root, "generate_audio")),
    quality: quality.length > 0 ? quality : null,
    resolution: resolution.length > 0 ? resolution : null,
    resolutionField,
    outputFormat: outputFormat.length > 0 ? outputFormat : null,
    background: background.length > 0 ? background : null,
    slots: nextSlots,
    mentions,
    pricing,
  };
}

export function resolutionPayloadFields(
  field: ResolutionField,
  value: string | undefined,
): { resolution?: string; size?: string; image_size?: string } {
  if (!value) return {};
  switch (field) {
    case "size":
      return { size: value };
    case "image_size":
      return { image_size: value };
    case "resolution":
      return { resolution: value };
    default: {
      const _never: never = field;
      return _never;
    }
  }
}

export function imageSlotRequired(controls: ModelControls): boolean {
  return controls.slots.some((slot) => slot.kind === "image" && slot.required);
}

export function videoSlotRequired(controls: ModelControls): boolean {
  return controls.slots.some((slot) => slot.kind === "video" && slot.required);
}

export function pickCompatible<T extends string>(
  value: string | undefined,
  allowed: T[] | null,
): T | undefined {
  if (!allowed || allowed.length === 0) return undefined;
  if (value && allowed.includes(value as T)) return value as T;
  return undefined;
}

export function mapMediaUrls(
  slots: MediaSlot[],
  urls: { image: string[]; video: string[]; audio: string[] },
): Partial<Record<MediaField, string | string[]>> {
  const mapped: Partial<Record<MediaField, string | string[]>> = {};
  const kinds: MediaKind[] = ["image", "video", "audio"];
  for (const kind of kinds) {
    const matches = slots.filter((slot) => slot.kind === kind);
    const list = urls[kind];
    if (matches.length === 0 || list.length === 0) continue;
    const slot = [...matches].sort((a, b) => b.maxItems - a.maxItems)[0];
    const clipped = list.slice(0, slot.maxItems);
    mapped[slot.field] = slot.asArray || clipped.length > 1 ? clipped : clipped[0];
  }
  return mapped;
}

export function asStringList(value: string | string[] | undefined): string[] | undefined {
  if (value == null) return undefined;
  return Array.isArray(value) ? value : [value];
}

export function asSingleString(value: string | string[] | undefined): string | undefined {
  if (value == null) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

export type GenerationListScope = "active" | "library";

export function parseGenerationListScope(
  raw: string | undefined | null,
): GenerationListScope | null {
  if (raw == null || raw === "" || raw === "library") return "library";
  if (raw === "active") return "active";
  return null;
}

export function clampDuration(
  value: number | string | undefined,
  duration: DurationControl | null,
): number | string | undefined {
  if (value == null || value === "") return undefined;
  if (!duration) return value;
  if (duration.kind === "enum") {
    const raw = String(value);
    if (duration.values.includes(raw)) return raw;
    return duration.defaultValue ?? duration.values[0];
  }
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return duration.defaultValue ?? duration.min;
  return Math.min(duration.max, Math.max(duration.min, Math.round(numeric)));
}
