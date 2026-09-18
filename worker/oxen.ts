import type { GenerationMode } from "./types";

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
  pricing?: Record<string, unknown>;
  request_schema?: Record<string, unknown> | null;
  developer?: { name?: string; logo?: string } | null;
};

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
  duration?: number;
  seed?: number;
  input_image?: string | string[];
  input_video?: string;
  generate_audio?: boolean;
  num_generations?: number;
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

export function extractResultUrl(remote: Record<string, unknown>): string | null {
  if (typeof remote.result_url === "string" && remote.result_url.trim()) {
    return remote.result_url;
  }
  const images = remote.images as { url?: string }[] | undefined;
  if (typeof images?.[0]?.url === "string" && images[0].url.trim()) {
    return images[0].url;
  }
  const videos = remote.videos as { url?: string }[] | undefined;
  if (typeof videos?.[0]?.url === "string" && videos[0].url.trim()) {
    return videos[0].url;
  }
  return null;
}

export function extractOxenErrorMessage(
  remote: Record<string, unknown>,
): string | null {
  const fromBody = oxenErrorText(remote, "");
  if (fromBody) return fromBody;
  if (String(remote.status) === "failed") return "Oxen generation failed";
  return null;
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

/** Image and video jobs share POST /api/ai/queue; duration is video-only. */
export function buildEnqueuePayload(
  mediaType: "image" | "video",
  body: EnqueueBody,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: body.model.trim(),
    prompt: body.prompt.trim(),
    num_generations: Math.min(Math.max(body.num_generations ?? 1, 1), 4),
  };
  if (body.aspect_ratio) payload.aspect_ratio = body.aspect_ratio;
  if (body.seed != null) payload.seed = body.seed;
  if (body.input_image) payload.input_image = body.input_image;

  switch (mediaType) {
    case "image":
      break;
    case "video":
      if (body.input_video) payload.input_video = body.input_video;
      if (body.duration != null) payload.duration = body.duration;
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

    switch (mode) {
      case "text-to-image":
        return (
          caps.imageOut &&
          caps.hasText &&
          !caps.hasVideoIn &&
          !videoGen &&
          !imageEdit &&
          (imageGen || (!caps.noCaps && caps.outputs.includes("image")))
        );
      case "image-to-image":
        return (
          caps.imageOut &&
          !videoGen &&
          (imageEdit || caps.hasImageIn || (caps.noCaps && imageGen))
        );
      case "text-to-video":
        return (
          caps.videoOut &&
          caps.hasText &&
          !caps.hasImageIn &&
          !caps.hasVideoIn &&
          (videoGen || (!caps.noCaps && caps.outputs.includes("video")))
        );
      case "reference-to-video":
        return (
          caps.videoOut &&
          caps.hasImageIn &&
          !caps.hasVideoIn &&
          (videoGen || (!caps.noCaps && caps.outputs.includes("video")))
        );
      case "video-to-video":
        return (
          caps.videoOut &&
          caps.hasVideoIn &&
          (videoGen || (!caps.noCaps && caps.outputs.includes("video")))
        );
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

export async function listModels(apiKey: string): Promise<OxenModel[]> {
  const res = await oxenFetch("/models", apiKey);
  const data = await readOxenJson<{ data?: OxenModel[] } & OxenErrorBody>(res);
  if (!res.ok) {
    throw new Error(oxenErrorText(data, `Oxen models failed (${res.status})`));
  }
  return data.data ?? [];
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
