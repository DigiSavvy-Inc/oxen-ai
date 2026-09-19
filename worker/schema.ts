import type { OxenModel } from "./oxen";

export type JsonSchema = {
  type?: string | string[];
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
  | "input_audios";

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

export type ModelControls = {
  modelId: string;
  aspectRatios: string[] | null;
  duration: DurationControl | null;
  seed: boolean;
  generateAudio: boolean;
  quality: string[] | null;
  resolution: string[] | null;
  outputFormat: string[] | null;
  background: string[] | null;
  slots: MediaSlot[];
};

const FIELD_KIND: Record<MediaField, MediaKind> = {
  input_image: "image",
  input_images: "image",
  input_video: "video",
  input_videos: "video",
  input_audios: "audio",
};

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

export function parseModelControls(model: OxenModel): ModelControls {
  const root = asObjectSchema(model.request_schema) ?? {};
  const slots: MediaSlot[] = [];
  const fields: MediaField[] = [
    "input_image",
    "input_images",
    "input_video",
    "input_videos",
    "input_audios",
  ];
  for (const field of fields) {
    const prop = property(root, field);
    if (!prop) continue;
    slots.push(slotFromProperty(field, root, prop));
  }

  const aspect = enumStrings(property(root, "aspect_ratio"));
  const quality = enumStrings(property(root, "quality"));
  const resolution = enumStrings(property(root, "resolution"));
  const outputFormat = enumStrings(property(root, "output_format"));
  const background = enumStrings(property(root, "background"));

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

  return {
    modelId: model.id,
    aspectRatios: aspect.length > 0 ? aspect : null,
    duration,
    seed: Boolean(property(root, "seed")),
    generateAudio: Boolean(property(root, "generate_audio")),
    quality: quality.length > 0 ? quality : null,
    resolution: resolution.length > 0 ? resolution : null,
    outputFormat: outputFormat.length > 0 ? outputFormat : null,
    background: background.length > 0 ? background : null,
    slots,
  };
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
