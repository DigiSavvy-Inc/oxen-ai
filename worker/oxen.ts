import type { GenerationMode } from "./types";
import type { OxenPricing } from "./pricing";

export type { OxenPricing };

const OXEN_BASE = "https://hub.oxen.ai/api/ai";

export const POLL_FAILURE_THRESHOLD = 3;

export type OxenModel = {
  id: string;
  display_name?: string;
  description?: string | null;
  endpoint?: string;
  capabilities?: {
    input?: string[];
    output?: string[];
  };
  pricing?: OxenPricing | Record<string, unknown> | null;
  request_schema?: Record<string, unknown> | null;
  developer?: { name?: string; logo?: string } | null;
};

export const FEATURED_VIDEO_SEARCHES = [
  { query: "seedance 2.5", present: /seedance-2-5/i },
  { query: "kling 3", present: /kling-video-v3|kling-3/i },
  { query: "wan 3", present: /wan-3-0/i },
] as const;

const modelDetailCache = new Map<string, { at: number; model: OxenModel }>();
const MODEL_DETAIL_TTL_MS = 5 * 60 * 1000;

export type OxenQueuedGeneration = {
  generation_id: string;
  status: string;
};

type OxenErrorBody = {
  error?: { message?: string; detail?: string; title?: string } | string;
  error_message?: string;
  status_message?: string;
};

export type EnqueueBody = {
  model: string;
  prompt: string;
  aspect_ratio?: string;
  duration?: number | string;
  seed?: number;
  input_image?: string | string[];
  input_images?: string[];
  input_video?: string;
  input_videos?: string[];
  input_audios?: string[];
  generate_audio?: boolean;
  num_generations?: number;
  quality?: string;
  resolution?: string;
  output_format?: string;
  background?: string;
  moderation?: string;
};

const pollFailures = new Map<string, number>();

export function oxenErrorText(data: OxenErrorBody, fallback: string): string {
  if (typeof data.error === "string" && data.error.trim()) return data.error.trim();
  if (data.error && typeof data.error === "object") {
    const nested =
      data.error.detail || data.error.message || data.error.title;
    if (nested?.trim()) return nested.trim();
  }
  if (data.error_message?.trim()) return data.error_message.trim();
  if (data.status_message?.trim()) return data.status_message.trim();
  return fallback;
}

function firstTrimmedUrl(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

export function extractResultUrl(remote: Record<string, unknown>): string | null {
  const images = remote.images as { url?: string }[] | undefined;
  const videos = remote.videos as { url?: string }[] | undefined;
  const video = remote.video as { url?: string } | undefined;
  const image = remote.image as { url?: string } | undefined;
  const result = remote.result as { url?: string } | undefined;
  return firstTrimmedUrl(
    remote.result_url,
    images?.[0]?.url,
    videos?.[0]?.url,
    video?.url,
    image?.url,
    result?.url,
  );
}

export function extractOxenErrorMessage(
  remote: Record<string, unknown>,
): string | null {
  const fromBody = oxenErrorText(remote, "");
  if (fromBody) return fromBody;
  if (String(remote.status) === "failed") return "Oxen generation failed";
  return null;
}

function asUnixSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return asUnixSeconds(Number(value));
  }
  return null;
}

function asProgress(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0) return 0;
  if (value <= 1) return value;
  if (value <= 100) return value / 100;
  return null;
}

export type OxenTiming = {
  enqueuedAt: number | null;
  startedAt: number | null;
  etaSeconds: number | null;
  progress: number | null;
};

export function extractOxenTiming(remote: Record<string, unknown>): OxenTiming {
  const inner =
    remote.generation && typeof remote.generation === "object" && !Array.isArray(remote.generation)
      ? (remote.generation as Record<string, unknown>)
      : remote;
  return {
    enqueuedAt: asUnixSeconds(inner.enqueued_at),
    startedAt: asUnixSeconds(inner.started_at),
    etaSeconds:
      asUnixSeconds(inner.eta_seconds) ??
      asUnixSeconds(inner.estimated_seconds) ??
      asUnixSeconds(inner.eta),
    progress: asProgress(inner.progress) ?? asProgress(inner.percent),
  };
}

export function notePollFailure(generationId: string): number {
  const count = (pollFailures.get(generationId) ?? 0) + 1;
  pollFailures.set(generationId, count);
  return count;
}

export function resetPollFailures(generationId: string): void {
  pollFailures.delete(generationId);
}

export function pollErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Failed to poll Oxen generation";
}

export function shouldPersistPollFailure(count: number): boolean {
  return count >= POLL_FAILURE_THRESHOLD;
}

function assignIfPresent(
  payload: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  if (value === undefined || value === null || value === "") return;
  if (Array.isArray(value) && value.length === 0) return;
  payload[key] = value;
}

/** Image and video jobs share POST /api/ai/queue; extra fields are Oxen passthrough. */
export function buildEnqueuePayload(
  mediaType: "image" | "video",
  body: EnqueueBody,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: body.model.trim(),
    prompt: body.prompt.trim(),
    num_generations: Math.min(Math.max(body.num_generations ?? 1, 1), 4),
  };
  assignIfPresent(payload, "aspect_ratio", body.aspect_ratio);
  if (body.seed != null) payload.seed = body.seed;
  assignIfPresent(payload, "input_image", body.input_image);
  assignIfPresent(payload, "input_images", body.input_images);
  assignIfPresent(payload, "quality", body.quality);
  assignIfPresent(payload, "resolution", body.resolution);
  assignIfPresent(payload, "output_format", body.output_format);
  assignIfPresent(payload, "background", body.background);
  assignIfPresent(payload, "moderation", body.moderation);

  switch (mediaType) {
    case "image":
      break;
    case "video":
      assignIfPresent(payload, "input_video", body.input_video);
      assignIfPresent(payload, "input_videos", body.input_videos);
      assignIfPresent(payload, "input_audios", body.input_audios);
      assignIfPresent(payload, "duration", body.duration);
      if (body.generate_audio != null) payload.generate_audio = body.generate_audio;
      break;
    default: {
      const _exhaustive: never = mediaType;
      return _exhaustive;
    }
  }

  return payload;
}

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

function modalities(model: OxenModel): {
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
export function isUnifiedImageModel(model: OxenModel): boolean {
  const id = model.id.toLowerCase();
  return id.startsWith("gpt-image") && !id.includes("edit");
}

function modelIdName(model: OxenModel): string {
  return `${model.id} ${model.display_name ?? ""}`;
}

function isSeedance25TextToVideo(model: OxenModel): boolean {
  return /seedance-2-5-text-to-video/i.test(modelIdName(model));
}

function isWan30TextToVideo(model: OxenModel): boolean {
  const text = modelIdName(model);
  return /wan-3-0/i.test(text) && /text-to-video/i.test(text);
}

function isReferenceToVideoId(model: OxenModel): boolean {
  const text = modelIdName(model);
  return (
    /seedance-2-5-image-to-video/i.test(text) ||
    /seedance-2-5-reference-to-video/i.test(text) ||
    /wan-3-0/i.test(text) ||
    /kling-video-v3-pro-motion-control/i.test(text)
  );
}

function isVideoToVideoId(model: OxenModel): boolean {
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

export function unionModelsById(base: OxenModel[], extra: OxenModel[]): OxenModel[] {
  const ids = new Set(base.map((model) => model.id.toLowerCase()));
  const merged = [...base];
  for (const model of extra) {
    const id = model.id.toLowerCase();
    if (ids.has(id)) continue;
    ids.add(id);
    merged.push(model);
  }
  return merged;
}

export async function mergeMissingFeaturedModels(
  apiKey: string,
  models: OxenModel[],
): Promise<OxenModel[]> {
  const missing = FEATURED_VIDEO_SEARCHES.filter(
    ({ present }) =>
      !models.some((model) => present.test(model.id) || present.test(model.display_name ?? "")),
  );
  if (missing.length === 0) return models;
  const found = await Promise.all(
    missing.map(async ({ query }) => {
      try {
        return await searchModels(apiKey, query);
      } catch {
        return [] as OxenModel[];
      }
    }),
  );
  return unionModelsById(models, found.flat());
}

export function filterModelsForMode(
  models: OxenModel[],
  mode: GenerationMode,
): OxenModel[] {
  return models.filter((model) => {
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
            (!imageEdit &&
              (imageGen || (!caps.noCaps && caps.outputs.includes("image")))))
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
  });
}

async function readOxenJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(text || `Oxen request failed (${res.status})`);
  }
}

async function oxenFetch(
  path: string,
  apiKey: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${OXEN_BASE}${path}`, { ...init, headers });
}

function modelsFromListPayload(data: { data?: OxenModel[] }): OxenModel[] {
  return data.data ?? [];
}

export async function listModels(apiKey: string): Promise<OxenModel[]> {
  const res = await oxenFetch("/models", apiKey);
  const data = await readOxenJson<{ data?: OxenModel[] } & OxenErrorBody>(res);
  if (!res.ok) {
    throw new Error(oxenErrorText(data, `Oxen models failed (${res.status})`));
  }
  return modelsFromListPayload(data);
}

export async function searchModels(apiKey: string, query: string): Promise<OxenModel[]> {
  const params = new URLSearchParams({ search: query });
  const res = await oxenFetch(`/models/search?${params.toString()}`, apiKey);
  const data = await readOxenJson<{ data?: OxenModel[] } & OxenErrorBody>(res);
  if (!res.ok) {
    throw new Error(oxenErrorText(data, `Oxen model search failed (${res.status})`));
  }
  return modelsFromListPayload(data);
}

export async function getModel(apiKey: string, id: string): Promise<OxenModel> {
  const cached = modelDetailCache.get(id);
  if (cached && Date.now() - cached.at < MODEL_DETAIL_TTL_MS) {
    return cached.model;
  }
  const res = await oxenFetch(`/models/${encodeURIComponent(id)}`, apiKey);
  const data = await readOxenJson<OxenModel & OxenErrorBody & { data?: OxenModel }>(res);
  if (!res.ok) {
    throw new Error(oxenErrorText(data, `Oxen model detail failed (${res.status})`));
  }
  const model = data.data ?? data;
  if (!model.id) {
    throw new Error(oxenErrorText(data, "Oxen model detail returned no id"));
  }
  modelDetailCache.set(id, { at: Date.now(), model });
  return model;
}

export async function listFavoriteModels(apiKey: string): Promise<OxenModel[]> {
  const res = await oxenFetch("/models/favorites", apiKey);
  const data = await readOxenJson<{ data?: OxenModel[] } & OxenErrorBody>(res);
  if (!res.ok) {
    throw new Error(oxenErrorText(data, `Oxen favorites failed (${res.status})`));
  }
  return modelsFromListPayload(data);
}

export async function favoriteModel(apiKey: string, id: string): Promise<void> {
  const res = await oxenFetch(`/models/${encodeURIComponent(id)}/favorite`, apiKey, {
    method: "POST",
  });
  if (!res.ok) {
    const data = await readOxenJson<OxenErrorBody>(res);
    throw new Error(oxenErrorText(data, `Oxen favorite failed (${res.status})`));
  }
}

export async function unfavoriteModel(apiKey: string, id: string): Promise<void> {
  const res = await oxenFetch(`/models/${encodeURIComponent(id)}/favorite`, apiKey, {
    method: "DELETE",
  });
  if (!res.ok) {
    const data = await readOxenJson<OxenErrorBody>(res);
    throw new Error(oxenErrorText(data, `Oxen unfavorite failed (${res.status})`));
  }
}

export async function enqueueGeneration(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<OxenQueuedGeneration[]> {
  const res = await oxenFetch("/queue", apiKey, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await readOxenJson<
    { generations?: OxenQueuedGeneration[] } & OxenErrorBody
  >(res);
  if (!res.ok) {
    throw new Error(oxenErrorText(data, `Oxen enqueue failed (${res.status})`));
  }
  const generations = data.generations ?? [];
  if (generations.length === 0) {
    throw new Error(
      oxenErrorText(data, "Oxen enqueue returned no generations"),
    );
  }
  return generations;
}

export async function getGeneration(
  apiKey: string,
  generationId: string,
): Promise<Record<string, unknown>> {
  const res = await oxenFetch(`/queue/${encodeURIComponent(generationId)}`, apiKey);
  const data = await readOxenJson<Record<string, unknown> & OxenErrorBody>(res);
  if (!res.ok) {
    throw new Error(oxenErrorText(data, `Oxen status failed (${res.status})`));
  }
  return data;
}

export async function listQueue(
  apiKey: string,
  query: URLSearchParams,
): Promise<Record<string, unknown>> {
  const qs = query.toString();
  const res = await oxenFetch(`/queue${qs ? `?${qs}` : ""}`, apiKey);
  const data = await readOxenJson<Record<string, unknown> & OxenErrorBody>(res);
  if (!res.ok) {
    throw new Error(oxenErrorText(data, `Oxen queue list failed (${res.status})`));
  }
  return data;
}

export async function cancelGeneration(
  apiKey: string,
  generationId: string,
): Promise<void> {
  const res = await oxenFetch(`/queue/${encodeURIComponent(generationId)}`, apiKey, {
    method: "DELETE",
  });
  if (!res.ok) {
    const data = await readOxenJson<OxenErrorBody>(res);
    throw new Error(oxenErrorText(data, `Oxen cancel failed (${res.status})`));
  }
}

export async function downloadOxenResult(
  apiKey: string,
  resultUrl: string,
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const res = await fetch(resultUrl, {
    headers: { Authorization: `Bearer ${apiKey}` },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Oxen result download failed (${res.status})`);
  }
  return {
    bytes: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") || "application/octet-stream",
  };
}
