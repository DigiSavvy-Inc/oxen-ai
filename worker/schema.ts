import type { GenerationMode } from "./model-modes";
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
  exclusiveMinimum?: number | boolean;
  exclusiveMaximum?: number | boolean;
  multipleOf?: number;
  allOf?: JsonSchema[];
};

export type MediaKind = "image" | "video" | "audio";

export type MediaField =
  | "input_image"
  | "input_images"
  | "input_face_images"
  | "input_video"
  | "input_videos"
  | "input_face_videos"
  | "input_audio"
  | "input_audios"
  | "audio_urls"
  | "image_url";

export const DEFAULT_AUDIO_ARRAY_MAX = 16;

export type MediaSlot = {
  field: MediaField;
  kind: MediaKind;
  required: boolean;
  maxItems: number;
  asArray: boolean;
};

export type DurationControl =
  | { kind: "int"; min: number; max: number; step?: number; defaultValue?: number }
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
  sampleRate: DurationControl | null;
  speed: DurationControl | null;
  volume: DurationControl | null;
  pitch: DurationControl | null;
  /** Seed Audio accepts a reference image or reference audio, not both. */
  imageAudioExclusive: boolean;
  /** Kinds the prompt may cite with @Image / @Video / @Audio. */
  mentionKinds: MediaKind[];
  slots: MediaSlot[];
  mentions: boolean;
  pricing: OxenPricing | null;
};

const FIELD_KIND: Record<MediaField, MediaKind> = {
  input_image: "image",
  input_images: "image",
  input_face_images: "image",
  input_video: "video",
  input_videos: "video",
  input_face_videos: "video",
  input_audio: "audio",
  input_audios: "audio",
  audio_urls: "audio",
  image_url: "image",
};

function modelListsAudioInput(model: OxenModel): boolean {
  return (model.capabilities?.input ?? []).some((item) => item.toLowerCase() === "audio");
}

function mentionName(kind: MediaKind): "Image" | "Video" | "Audio" {
  switch (kind) {
    case "image":
      return "Image";
    case "video":
      return "Video";
    case "audio":
      return "Audio";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function inferMentionMax(kind: MediaKind, texts: string[]): number | null {
  const token = mentionName(kind);
  const pattern = new RegExp(`@${token}(\\d+)`, "gi");
  let max = 0;
  for (const text of texts) {
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1]);
      if (Number.isInteger(value) && value >= 1 && value <= 32) max = Math.max(max, value);
    }
  }
  return max > 0 ? max : null;
}

function inferCountFromProse(kind: MediaKind, texts: string[]): number | null {
  const word = kind === "image" ? "image" : kind === "video" ? "video" : "audio";
  const joined = texts.join("\n");
  const upTo = new RegExp(
    `(?:up to|max(?:imum)?(?: of)?|at most|1\\s*[\u2013-]\\s*)\\s*(\\d+)\\s+(?:reference\\s+)?${word}`,
    "i",
  );
  const upToMatch = joined.match(upTo);
  const upToValue = Number(upToMatch?.[1]);
  if (Number.isInteger(upToValue) && upToValue >= 1 && upToValue <= 32) return upToValue;
  if (kind === "image" && /first[- ]?(?:frame|image)|last[- ]?(?:frame|image)|end[- ]?frame/i.test(joined)) {
    return 2;
  }
  if (kind === "image") return null;
  const loose = new RegExp(`(\\d+)\\s+(?:reference\\s+)?${word}(?:s| clips?| files?)?`, "i");
  const looseMatch = joined.match(loose);
  const looseValue = Number(looseMatch?.[1]);
  if (Number.isInteger(looseValue) && looseValue >= 1 && looseValue <= 32) return looseValue;
  return null;
}

function inferKindMax(kind: MediaKind, texts: string[]): number | null {
  const mention = inferMentionMax(kind, texts);
  const prose = inferCountFromProse(kind, texts);
  if (mention == null && prose == null) return null;
  return Math.max(mention ?? 0, prose ?? 0);
}

function inferAudioMaxFromText(texts: string[]): number | null {
  return inferKindMax("audio", texts);
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
    if (slot.asArray && (slot.field === "input_audio" || slot.field === "input_audios")) {
      slot.field = "input_audios";
    }
  }
  return next;
}

function modelListsImageInput(model: OxenModel): boolean {
  return (model.capabilities?.input ?? []).some((item) => item.toLowerCase() === "image");
}

function enrichImageSlots(model: OxenModel, schema: JsonSchema, slots: MediaSlot[]): MediaSlot[] {
  const next = slots.map((slot) => ({ ...slot }));
  const imageSlots = next.filter((slot) => slot.kind === "image");
  const texts: string[] = [];
  collectSchemaText(schema, texts);
  if (model.description) texts.push(model.description);
  if (model.display_name) texts.push(model.display_name);
  const acceptsImage =
    imageSlots.length > 0 || modelListsImageInput(model) || texts.some((text) => /@Image\d*/i.test(text));
  if (!acceptsImage) return next;

  const inferredMax = inferKindMax("image", texts);
  if (imageSlots.length === 0) {
    if (!inferredMax || inferredMax <= 1) return next;
    next.push({
      field: "input_images",
      kind: "image",
      required: false,
      maxItems: inferredMax,
      asArray: true,
    });
    return next;
  }
  if (inferredMax && inferredMax > 1) {
    for (const slot of imageSlots) {
      if (slot.maxItems < inferredMax) {
        slot.maxItems = inferredMax;
        slot.asArray = true;
      }
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
  else if (typeof schema.const === "number") values.push(String(schema.const));
  for (const option of [...(schema.anyOf ?? []), ...(schema.oneOf ?? []), ...(schema.allOf ?? [])]) {
    values.push(...enumStrings(option));
  }
  return [...new Set(values)];
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function isNumericDurationBranch(schema: JsonSchema): boolean {
  const types = typeList(schema);
  if (types.includes("integer") || types.includes("number")) return true;
  return (
    schema.minimum != null ||
    schema.maximum != null ||
    schema.exclusiveMinimum != null ||
    schema.exclusiveMaximum != null
  );
}

function boundsFromNode(schema: JsonSchema): { min?: number; max?: number } {
  let min = finiteNumber(schema.minimum);
  let max = finiteNumber(schema.maximum);
  const exclusiveMin = finiteNumber(schema.exclusiveMinimum);
  const exclusiveMax = finiteNumber(schema.exclusiveMaximum);
  if (exclusiveMin != null) {
    const next = Number.isInteger(exclusiveMin) ? exclusiveMin + 1 : exclusiveMin;
    min = min == null ? next : Math.max(min, next);
  }
  if (exclusiveMax != null) {
    const next = Number.isInteger(exclusiveMax) ? exclusiveMax - 1 : exclusiveMax;
    max = max == null ? next : Math.min(max, next);
  }
  if (schema.exclusiveMinimum === true && min != null) min += 1;
  if (schema.exclusiveMaximum === true && max != null) max -= 1;
  return { min, max };
}

/** Union bounds across anyOf/oneOf; intersect bounds across allOf. */
function collectNumericBounds(schema: JsonSchema | undefined): { min?: number; max?: number } {
  const into: { min?: number; max?: number } = {};
  const visit = (node: JsonSchema | undefined, widen: boolean) => {
    if (!node) return;
    const alternatives = [...(node.anyOf ?? []), ...(node.oneOf ?? [])];
    for (const branch of alternatives) visit(branch, true);
    for (const part of node.allOf ?? []) visit(part, false);
    if (
      alternatives.length > 0 &&
      node.minimum == null &&
      node.maximum == null &&
      node.exclusiveMinimum == null &&
      node.exclusiveMaximum == null
    ) {
      return;
    }
    if (!isNumericDurationBranch(node)) return;
    const bounds = boundsFromNode(node);
    if (bounds.min == null && bounds.max == null) return;
    if (widen) {
      if (bounds.min != null) into.min = into.min == null ? bounds.min : Math.min(into.min, bounds.min);
      if (bounds.max != null) into.max = into.max == null ? bounds.max : Math.max(into.max, bounds.max);
    } else {
      if (bounds.min != null) into.min = into.min == null ? bounds.min : Math.max(into.min, bounds.min);
      if (bounds.max != null) into.max = into.max == null ? bounds.max : Math.min(into.max, bounds.max);
    }
  };
  visit(schema, false);
  return into;
}

function schemaDefault(schema: JsonSchema | undefined): string | number | undefined {
  if (!schema) return undefined;
  if (typeof schema.default === "number" || typeof schema.default === "string") return schema.default;
  for (const option of [...(schema.anyOf ?? []), ...(schema.oneOf ?? []), ...(schema.allOf ?? [])]) {
    const found = schemaDefault(option);
    if (found != null) return found;
  }
  return undefined;
}

function isNumericDurationToken(value: string): boolean {
  return value.trim() !== "" && value !== "auto" && Number.isFinite(Number(value));
}

function enumWithDefault(schema: JsonSchema | undefined): string[] {
  const values = enumStrings(schema);
  const fallback = schemaDefault(schema);
  if (fallback == null) return values;
  const token = String(fallback);
  if (!values.includes(token)) return values;
  return [token, ...values.filter((value) => value !== token)];
}

function numberControl(schema: JsonSchema | undefined): DurationControl | null {
  if (!schema) return null;
  const control = durationFromSchema(schema);
  if (!control || control.kind !== "int") return control;
  const types = typeList(schema);
  if (types.includes("number") && !types.includes("integer") && control.step == null) {
    return { ...control, step: 0.1 };
  }
  return control;
}

function promptReferenceKinds(schema: JsonSchema): MediaKind[] | null {
  const prompt = schema.properties?.prompt as
    | (JsonSchema & { "x-media-references"?: { groups?: { field?: string }[] } })
    | undefined;
  const groups = prompt?.["x-media-references"]?.groups;
  if (!groups?.length) return null;
  const kinds: MediaKind[] = [];
  for (const group of groups) {
    const field = (group.field ?? "").toLowerCase();
    const kind: MediaKind | null = field.includes("audio")
      ? "audio"
      : field.includes("video")
        ? "video"
        : field.includes("image")
          ? "image"
          : null;
    if (kind && !kinds.includes(kind)) kinds.push(kind);
  }
  return kinds.length > 0 ? kinds : null;
}

function uniqueKinds(kinds: MediaKind[]): MediaKind[] {
  return kinds.filter((kind, index) => kinds.indexOf(kind) === index);
}

function durationFromSchema(schema: JsonSchema): DurationControl | null {
  const listed = enumStrings(schema);
  const numericListed = listed.filter(isNumericDurationToken);
  const otherListed = listed.filter((value) => !isNumericDurationToken(value));
  const bounds = collectNumericBounds(schema);
  const fallback = schemaDefault(schema);

  if (numericListed.length > 0) {
    const values = [...otherListed, ...numericListed];
    const defaultValue = typeof fallback === "string" && values.includes(fallback)
      ? fallback
      : typeof fallback === "number" && values.includes(String(fallback))
        ? String(fallback)
        : undefined;
    return { kind: "enum", values, defaultValue };
  }

  if (bounds.min != null && bounds.max != null && bounds.max >= bounds.min) {
    if (otherListed.length > 0 && bounds.max - bounds.min <= 200) {
      const values = [...otherListed];
      for (let n = Math.ceil(bounds.min); n <= Math.floor(bounds.max); n += 1) {
        const token = String(n);
        if (!values.includes(token)) values.push(token);
      }
      const defaultValue = typeof fallback === "string" && values.includes(fallback)
        ? fallback
        : typeof fallback === "number" && values.includes(String(fallback))
          ? String(fallback)
          : undefined;
      return { kind: "enum", values, defaultValue };
    }
    const numericDefault = finiteNumber(fallback);
    const step = durationStep(schema);
    const alignedDefault =
      numericDefault == null ? undefined : alignDuration(numericDefault, { min: bounds.min, max: bounds.max, step });
    return {
      kind: "int",
      min: bounds.min,
      max: bounds.max,
      ...(step != null && step !== 1 ? { step } : {}),
      defaultValue:
        alignedDefault != null && alignedDefault >= bounds.min && alignedDefault <= bounds.max
          ? alignedDefault
          : undefined,
    };
  }

  if (otherListed.length > 0) {
    const defaultValue = typeof fallback === "string" && otherListed.includes(fallback) ? fallback : undefined;
    return { kind: "enum", values: otherListed, defaultValue };
  }

  return null;
}

function numericDurationToken(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "auto") return null;
  if (Number.isFinite(Number(trimmed))) return Number(trimmed);
  const match = trimmed.match(/^(\d+(?:\.\d+)?)[a-z]*$/i);
  if (!match) return null;
  const numeric = Number(match[1]);
  return Number.isFinite(numeric) ? numeric : null;
}

function durationStep(schema: JsonSchema | undefined): number | undefined {
  if (!schema) return undefined;
  const direct = finiteNumber(schema.multipleOf);
  if (direct != null && direct > 0) return direct;
  for (const option of [...(schema.anyOf ?? []), ...(schema.oneOf ?? []), ...(schema.allOf ?? [])]) {
    const found = durationStep(option);
    if (found != null) return found;
  }
  return undefined;
}

function alignDuration(
  numeric: number,
  bounds: { min: number; max: number; step?: number },
): number {
  const clamped = Math.min(bounds.max, Math.max(bounds.min, numeric));
  const step = bounds.step;
  if (step == null || step <= 0) return clamped;
  const stepsFromMin = Math.round((clamped - bounds.min) / step);
  let aligned = bounds.min + stepsFromMin * step;
  const places = (String(step).split(".")[1] ?? "").length;
  aligned = Number(aligned.toFixed(places));
  if (aligned < bounds.min) aligned += step;
  if (aligned > bounds.max) aligned -= step;
  if (aligned < bounds.min || aligned > bounds.max) return clamped;
  return aligned;
}

/** Snap a duration to the closest value this model's schema allows. */
export function nearestDurationValue(value: string, duration: DurationControl): string {
  if (duration.kind === "enum") {
    if (duration.values.includes(value)) return value;
    const current = numericDurationToken(value);
    if (current == null) {
      if (duration.defaultValue && duration.values.includes(duration.defaultValue)) {
        return duration.defaultValue;
      }
      return duration.values[0] ?? value;
    }
    let best: { value: string; distance: number; numeric: number } | null = null;
    for (const option of duration.values) {
      const numeric = numericDurationToken(option);
      if (numeric == null) continue;
      const distance = Math.abs(numeric - current);
      if (
        !best ||
        distance < best.distance ||
        (distance === best.distance && numeric < best.numeric)
      ) {
        best = { value: option, distance, numeric };
      }
    }
    if (best) return best.value;
    if (duration.defaultValue && duration.values.includes(duration.defaultValue)) {
      return duration.defaultValue;
    }
    return duration.values[0] ?? value;
  }

  if (value.trim() === "") return String(duration.defaultValue ?? duration.min);
  const numeric = numericDurationToken(value);
  if (numeric == null) return String(duration.defaultValue ?? duration.min);
  const snapped = duration.step != null && duration.step < 1 ? numeric : Math.round(numeric);
  return String(alignDuration(snapped, duration));
}

function prefixCanReach(prefix: string, min: number, max: number): boolean {
  const floor = Math.ceil(min);
  const ceil = Math.floor(max);
  if (floor > ceil) return false;
  const width = String(ceil).length;
  for (let length = prefix.length; length <= width; length += 1) {
    const pad = length - prefix.length;
    const start = Number(prefix) * 10 ** pad;
    const end = start + 10 ** pad - 1;
    const low = Math.max(start, floor);
    const high = Math.min(end, ceil);
    if (low <= high) return true;
  }
  return false;
}

/**
 * Value to keep in the duration field. Numbers above the schema max are
 * replaced immediately. A shorter prefix is kept only when more digits can
 * still land inside the range.
 */
export function durationFieldValue(raw: string, duration: DurationControl): string {
  if (duration.kind === "enum") {
    return duration.values.includes(raw) ? raw : nearestDurationValue(raw, duration);
  }
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (!/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return "";
    return durationFieldValue(String(Math.round(numeric)), duration);
  }
  const numeric = Number(trimmed);
  if (numeric > duration.max) return String(alignDuration(duration.max, duration));
  if (numeric < duration.min) {
    if (prefixCanReach(trimmed, duration.min, duration.max)) return trimmed;
    return String(alignDuration(duration.min, duration));
  }
  const aligned = alignDuration(numeric, duration);
  if (aligned !== numeric) return String(aligned);
  return trimmed;
}

/** Duration that generate will enqueue for this control. */
export function durationToSend(
  value: string,
  duration: DurationControl | null,
): number | string | undefined {
  if (!duration) return undefined;
  const direct = clampDuration(value, duration);
  if (direct != null && direct !== "") return direct;
  return clampDuration(nearestDurationValue(value, duration), duration);
}

function property(schema: JsonSchema, name: string): JsonSchema | undefined {
  if (schema.properties?.[name]) return schema.properties[name];
  for (const part of schema.allOf ?? []) {
    const found = property(part, name);
    if (found) return found;
  }
  return undefined;
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

export function isSeedanceModel(modelId: string, displayName?: string | null): boolean {
  return /seedance/i.test(`${modelId} ${displayName ?? ""}`);
}

/** Image → Video is the `reference-to-video` mode. Seedance shows the control in any mode. */
export function showGetLastFrame(input: {
  modelId: string;
  displayName?: string | null;
  mode: GenerationMode | null;
}): boolean {
  if (isSeedanceModel(input.modelId, input.displayName)) return true;
  return input.mode === "reference-to-video" || input.mode === "video-to-video";
}

export function parseModelControls(model: OxenModel): ModelControls {
  const root = asObjectSchema(model.request_schema) ?? {};
  const slots: MediaSlot[] = [];
  const fields: MediaField[] = [
    "input_image",
    "input_face_images",
    "input_images",
    "input_video",
    "input_face_videos",
    "input_videos",
    "input_audio",
    "input_audios",
    "audio_urls",
    "image_url",
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
  const outputFormat = enumWithDefault(property(root, "output_format"));
  const background = enumStrings(property(root, "background"));
  const sampleRate = numberControl(property(root, "sample_rate"));
  const speed = numberControl(property(root, "speed"));
  const volume = numberControl(property(root, "volume"));
  const pitch = numberControl(property(root, "pitch"));
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
  const duration = durationProp ? durationFromSchema(durationProp) : null;

  const nextSlots = enrichImageSlots(model, root, enrichAudioSlots(model, root, slots));
  const schemaTexts: string[] = [];
  collectSchemaText(root, schemaTexts);
  const imageAudioExclusive = /incompatible with audio/i.test(schemaTexts.join("\n"));
  const referenced = promptReferenceKinds(root);
  const mentionKinds =
    referenced ??
    uniqueKinds(nextSlots.map((slot) => slot.kind));
  const mentions =
    schemaMentionsMedia(root) ||
    mentionKinds.length > 0 ||
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
    sampleRate,
    speed,
    volume,
    pitch,
    imageAudioExclusive,
    mentionKinds,
    slots: nextSlots,
    mentions,
    pricing,
  };
}

export function unsupportedReferenceMessage(
  slots: MediaSlot[],
  counts: { image: number; video: number; audio: number },
  imageAudioExclusive: boolean,
): string | null {
  if (slots.length === 0) return null;
  const allowed = new Set(slots.map((slot) => slot.kind));
  if (counts.image > 0 && !allowed.has("image")) return "This model does not accept images";
  if (counts.video > 0 && !allowed.has("video")) return "This model does not accept video";
  if (counts.audio > 0 && !allowed.has("audio")) return "This model does not accept audio";
  if (imageAudioExclusive && counts.image > 0 && counts.audio > 0) {
    return "This model accepts a reference image or reference audio, not both";
  }
  return null;
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

function firstExplicitAspect(catalog: string[]): string | undefined {
  return catalog.find((value) => value === "16:9") ?? catalog.find((value) => value !== "auto");
}

/** Keep an explicit composer ratio. Do not fall back to `auto` (match the reference). */
export function preferredAspectRatio(catalog: string[], current?: string | null): string {
  if (current && current !== "auto" && (catalog.length === 0 || catalog.includes(current))) {
    return current;
  }
  return firstExplicitAspect(catalog) ?? catalog[0] ?? current ?? "1:1";
}

/** Always enqueue the composer aspect so Oxen cannot inherit the reference image. */
export function resolveEnqueueAspectRatio(
  value: string | undefined,
  catalog: string[] | null,
): string | undefined {
  const trimmed = value?.trim();
  if (trimmed) {
    if (!catalog || catalog.length === 0 || catalog.includes(trimmed) || trimmed !== "auto") {
      return trimmed;
    }
  }
  if (catalog && catalog.length > 0) {
    return firstExplicitAspect(catalog) ?? catalog[0];
  }
  return trimmed || undefined;
}

export type MediaRole = "character" | "scene";

export type MediaRoleLists = {
  image?: MediaRole[];
  video?: MediaRole[];
};

function preferredSlot(slots: MediaSlot[], kind: MediaKind): MediaSlot | undefined {
  const matches = slots.filter((slot) => slot.kind === kind);
  return [...matches].sort((a, b) => {
    const faceDelta = Number(b.field.includes("face")) - Number(a.field.includes("face"));
    if (faceDelta !== 0) return faceDelta;
    return b.maxItems - a.maxItems;
  })[0];
}

function slotForRole(slots: MediaSlot[], kind: MediaKind, role: MediaRole): MediaSlot | undefined {
  const matches = slots.filter((slot) => slot.kind === kind);
  const face = matches.find((slot) => slot.field.includes("face"));
  const generic = matches.find((slot) => !slot.field.includes("face"));
  switch (role) {
    case "character":
      return face ?? generic;
    case "scene":
      return generic ?? face;
    default: {
      const _exhaustive: never = role;
      return _exhaustive;
    }
  }
}

function assignMapped(
  mapped: Partial<Record<MediaField, string | string[]>>,
  slot: MediaSlot,
  values: string[],
) {
  const clipped = values.slice(0, slot.maxItems);
  if (clipped.length === 0) return;
  mapped[slot.field] = slot.asArray || clipped.length > 1 ? clipped : clipped[0];
}

export function mapMediaUrls(
  slots: MediaSlot[],
  urls: { image: string[]; video: string[]; audio: string[] },
  roles?: MediaRoleLists,
): Partial<Record<MediaField, string | string[]>> {
  const mapped: Partial<Record<MediaField, string | string[]>> = {};
  const kinds: MediaKind[] = ["image", "video", "audio"];
  for (const kind of kinds) {
    const list = urls[kind];
    if (list.length === 0) continue;
    const roleList = kind === "image" ? roles?.image : kind === "video" ? roles?.video : undefined;
    if (!roleList) {
      const slot = preferredSlot(slots, kind);
      if (!slot) continue;
      assignMapped(mapped, slot, list);
      continue;
    }
    const buckets = new Map<MediaField, string[]>();
    list.forEach((url, index) => {
      const role = roleList[index] === "scene" ? "scene" : "character";
      const slot = slotForRole(slots, kind, role);
      if (!slot) return;
      const current = buckets.get(slot.field) ?? [];
      current.push(url);
      buckets.set(slot.field, current);
    });
    for (const [field, values] of buckets) {
      const slot = slots.find((item) => item.field === field);
      if (!slot) continue;
      assignMapped(mapped, slot, values);
    }
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
  if (duration.kind === "enum") return nearestDurationValue(String(value), duration);
  const numeric = typeof value === "number" ? value : numericDurationToken(String(value));
  if (numeric == null) return duration.defaultValue ?? duration.min;
  const snapped = duration.step != null && duration.step < 1 ? numeric : Math.round(numeric);
  return alignDuration(snapped, duration);
}

/** Keep a fractional control editable while the user is still typing. */
export function numericControlValue(raw: string, control: DurationControl): string {
  if (control.kind === "enum") return nearestDurationValue(raw, control);
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "-" || trimmed === "." || trimmed === "-.") return trimmed;
  if (!/^-?\d*\.?\d*$/.test(trimmed)) {
    return String(control.defaultValue ?? control.min);
  }
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return String(control.defaultValue ?? control.min);
  if (numeric > control.max) return String(alignDuration(control.max, control));
  if (numeric < control.min) return trimmed;
  return trimmed;
}

export function snapNumericControl(raw: string, control: DurationControl): string {
  if (control.kind === "enum") return nearestDurationValue(raw, control);
  if (raw.trim() === "" || raw === "-" || raw === "." || raw === "-.") {
    return String(control.defaultValue ?? control.min);
  }
  const numeric = numericDurationToken(raw);
  if (numeric == null) return String(control.defaultValue ?? control.min);
  return String(alignDuration(numeric, control));
}

/** Value generate will enqueue for a numeric or enum control. */
export function clampNumericControl(
  value: number | string | undefined,
  control: DurationControl | null,
): number | undefined {
  if (!control || value == null || value === "") return undefined;
  const token = snapNumericControl(String(value), control);
  const numeric = numericDurationToken(token);
  if (numeric == null) return undefined;
  return numeric;
}
