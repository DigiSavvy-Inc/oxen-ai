import type { GenerationMode } from "./types";

export type ModeFilterModel = {
  id: string;
  display_name?: string;
  endpoint?: string;
  capabilities?: { input?: string[]; output?: string[] };
};

export const GENERATION_MODES: GenerationMode[] = [
  "text-to-image",
  "image-to-image",
  "text-to-video",
  "reference-to-video",
  "video-to-video",
];

function normalizeEndpoint(endpoint: string): string {
  return endpoint
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/^\/api\/ai(?=\/|$)/, "")
    .replace(/\/+$/, "");
}

function endpointMatches(endpoint: string, pattern: RegExp): boolean {
  const normalized = normalizeEndpoint(endpoint);
  const raw = endpoint.trim().toLowerCase();
  return pattern.test(normalized) || pattern.test(raw);
}

function isImageGeneratePath(endpoint: string): boolean {
  return endpointMatches(endpoint, /images?\/generat/);
}

function isImageEditPath(endpoint: string): boolean {
  return endpointMatches(endpoint, /images?\/edits?/);
}

function isVideoGeneratePath(endpoint: string): boolean {
  return endpointMatches(endpoint, /videos?\/(generat|edits?)/);
}

function modalities(model: ModeFilterModel): {
  outputs: string[];
  noCaps: boolean;
  hasText: boolean;
  hasImageIn: boolean;
  hasVideoIn: boolean;
  imageOut: boolean;
  videoOut: boolean;
} {
  const inputs = (model.capabilities?.input ?? []).map((s) => s.toLowerCase());
  const outputs = (model.capabilities?.output ?? []).map((s) => s.toLowerCase());
  const noCaps = inputs.length === 0 && outputs.length === 0;
  return {
    outputs,
    noCaps,
    hasText: noCaps || inputs.includes("text"),
    hasImageIn: inputs.includes("image"),
    hasVideoIn: inputs.includes("video"),
    imageOut: noCaps || outputs.includes("image"),
    videoOut: noCaps || outputs.includes("video"),
  };
}

/** GPT Image 2.x uses /images/edit with optional refs — still valid T2I. */
export function isUnifiedImageModel(model: ModeFilterModel): boolean {
  const id = model.id.toLowerCase();
  return id.startsWith("gpt-image") && !id.includes("edit");
}

function modelIdName(model: ModeFilterModel): string {
  return `${model.id} ${model.display_name ?? ""}`;
}

function isSeedance25TextToVideo(model: ModeFilterModel): boolean {
  return /seedance-2-5-text-to-video/i.test(modelIdName(model));
}

function isWan30TextToVideo(model: ModeFilterModel): boolean {
  const text = modelIdName(model);
  return /wan-3-0/i.test(text) && /text-to-video/i.test(text);
}

function isReferenceToVideoId(model: ModeFilterModel): boolean {
  const text = modelIdName(model);
  return (
    /seedance-2-5-image-to-video/i.test(text) ||
    /seedance-2-5-reference-to-video/i.test(text) ||
    /wan-3-0/i.test(text) ||
    /kling-video-v3-pro-motion-control/i.test(text)
  );
}

function isVideoToVideoId(model: ModeFilterModel): boolean {
  const text = modelIdName(model);
  return (
    /video-to-video/i.test(text) ||
    /motion-control/i.test(text) ||
    /wan-3-0-prime.*edit/i.test(text) ||
    /seedance-2-5-reference-to-video/i.test(text)
  );
}

function isVideoCapable(
  caps: ReturnType<typeof modalities>,
  videoGen: boolean,
): boolean {
  return videoGen || (!caps.noCaps && caps.outputs.includes("video"));
}

export function filterModelsForMode<T extends ModeFilterModel>(
  models: T[],
  mode: GenerationMode,
): T[] {
  return models.filter((model) => modelSupportsMode(model, mode));
}

export function modelSupportsMode(model: ModeFilterModel, mode: GenerationMode): boolean {
  const endpoint = model.endpoint || "";
  const caps = modalities(model);
  const imageGen = isImageGeneratePath(endpoint);
  const imageEdit = isImageEditPath(endpoint);
  const videoGen = isVideoGeneratePath(endpoint);
  const videoCapable = isVideoCapable(caps, videoGen);

  switch (mode) {
    case "text-to-image":
      return (
        caps.imageOut &&
        caps.hasText &&
        !caps.hasVideoIn &&
        !videoGen &&
        (isUnifiedImageModel(model) ||
          (!imageEdit && (imageGen || (!caps.noCaps && caps.outputs.includes("image")))))
      );
    case "image-to-image":
      return (
        caps.imageOut &&
        !videoGen &&
        (imageEdit || caps.hasImageIn || (caps.noCaps && imageGen))
      );
    case "text-to-video":
      if (isSeedance25TextToVideo(model) || isWan30TextToVideo(model)) return true;
      return (
        caps.videoOut &&
        caps.hasText &&
        !caps.hasImageIn &&
        !caps.hasVideoIn &&
        videoCapable
      );
    case "reference-to-video":
      if (isReferenceToVideoId(model) && caps.videoOut) return true;
      return caps.videoOut && caps.hasImageIn && videoCapable;
    case "video-to-video":
      if (isVideoToVideoId(model) && caps.videoOut) return true;
      return caps.videoOut && caps.hasVideoIn && videoCapable;
    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unhandled generation mode: ${_exhaustive}`);
    }
  }
}

export function isMediaGenerationModel(model: ModeFilterModel): boolean {
  const endpoint = (model.endpoint || "").toLowerCase();
  if (endpoint.includes("image") || endpoint.includes("video")) return true;
  return GENERATION_MODES.some((mode) => modelSupportsMode(model, mode));
}

export function firstSupportedMode(
  model: ModeFilterModel,
  preferred: GenerationMode,
): GenerationMode | null {
  if (modelSupportsMode(model, preferred)) return preferred;
  return GENERATION_MODES.find((mode) => modelSupportsMode(model, mode)) ?? null;
}
