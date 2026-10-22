import type { OxenPricing } from "./pricing";

export type { OxenPricing };
export {
  filterModelsForMode,
  firstSupportedMode,
  isMediaGenerationModel,
  isUnifiedImageModel,
  modelSupportsMode,
  modelsForComposer,
} from "./model-modes";

const OXEN_BASE = "https://hub.oxen.ai/api/ai";

/**
 * Oxen's answer about the user's own request (credits, moderation, bad params). Safe and
 * useful to show them, unlike internal errors, which the API hides behind a reference id.
 */
export class OxenApiError extends Error {
  override name = "OxenApiError";
}

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
  { query: "flux 3 video", present: /flux-3-video/i },
] as const;

export const FEATURED_AUDIO_SEARCHES = [
  { query: "seed audio", present: /seed-audio-1/i },
] as const;

const modelDetailCache = new Map<string, { at: number; model: OxenModel }>();

/** Tests share one module. A stub schema must not stick for the next case. */
export function resetModelDetailCache(): void {
  modelDetailCache.clear();
}
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
  input_face_images?: string[];
  input_video?: string;
  input_videos?: string[];
  input_face_videos?: string[];
  input_audios?: string[];
  audio_urls?: string[];
  image_url?: string;
  sample_rate?: number;
  speed?: number;
  volume?: number;
  pitch?: number;
  generate_audio?: boolean;
  draft?: boolean;
  safety_tolerance?: number;
  num_generations?: number;
  quality?: string;
  resolution?: string;
  size?: string;
  image_size?: string;
  output_format?: string;
  background?: string;
  moderation?: string;
  draft_task_id?: string;
  multi_prompt?: { prompt: string; duration: number }[];
};

export type DraftMeta = {
  draftTaskId: string;
  draftExpiresAt: string | null;
};

const MAX_SHOTS = 6;

export function normalizeMultiPrompt(
  raw: unknown,
): { prompt: string; duration: number }[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const shots: { prompt: string; duration: number }[] = [];
  for (const item of raw.slice(0, MAX_SHOTS)) {
    if (!item || typeof item !== "object") continue;
    const record = item as { prompt?: unknown; duration?: unknown };
    const prompt = typeof record.prompt === "string" ? record.prompt.trim() : "";
    const duration = Number(record.duration);
    if (!prompt || !Number.isFinite(duration) || duration <= 0) continue;
    shots.push({ prompt: prompt.slice(0, 4000), duration: Math.min(duration, 30) });
  }
  return shots.length > 0 ? shots : undefined;
}

function expiresAtValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  return null;
}

function draftIdFrom(record: Record<string, unknown> | null): string | null {
  if (!record) return null;
  const videos = Array.isArray(record.videos) ? record.videos : [];
  const first = videos[0];
  const video =
    first && typeof first === "object" && !Array.isArray(first)
      ? (first as Record<string, unknown>)
      : null;
  return firstTrimmedUrl(video?.draft_task_id, record.draft_task_id);
}

export function extractDraftMeta(remote: Record<string, unknown>): DraftMeta | null {
  const inner =
    remote.generation && typeof remote.generation === "object" && !Array.isArray(remote.generation)
      ? (remote.generation as Record<string, unknown>)
      : null;
  const draftTaskId = draftIdFrom(remote) ?? draftIdFrom(inner);
  if (!draftTaskId) return null;
  const videos = Array.isArray(remote.videos) ? remote.videos : [];
  const first = videos[0];
  const video =
    first && typeof first === "object" && !Array.isArray(first)
      ? (first as Record<string, unknown>)
      : null;
  const draftExpiresAt =
    expiresAtValue(video?.draft_expires_at) ??
    expiresAtValue(remote.draft_expires_at) ??
    expiresAtValue(inner?.draft_expires_at);
  return { draftTaskId, draftExpiresAt };
}

export function mergeDraftIntoParams(
  paramsJson: string | null | undefined,
  draft: DraftMeta,
): string {
  let parsed: Record<string, unknown> = {};
  if (paramsJson) {
    try {
      const value = JSON.parse(paramsJson) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) return paramsJson;
      parsed = { ...(value as Record<string, unknown>) };
    } catch {
      return paramsJson;
    }
  }
  parsed.draft_task_id = draft.draftTaskId;
  if (draft.draftExpiresAt) parsed.draft_expires_at = draft.draftExpiresAt;
  return JSON.stringify(parsed);
}

export function draftMetaFromParams(paramsJson: string | null | undefined): DraftMeta | null {
  if (!paramsJson) return null;
  try {
    const value = JSON.parse(paramsJson) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const draftTaskId = typeof record.draft_task_id === "string" ? record.draft_task_id.trim() : "";
    if (!draftTaskId) return null;
    const draftExpiresAt =
      typeof record.draft_expires_at === "string" && record.draft_expires_at.trim()
        ? record.draft_expires_at.trim()
        : null;
    return { draftTaskId, draftExpiresAt };
  } catch {
    return null;
  }
}

const pollFailures = new Map<string, number>();

const D1_MAX_TEXT_BYTES = 1_800_000;

export function redactStoredMediaRef(value: string): string {
  if (!value.startsWith("data:")) return value;
  const comma = value.indexOf(",");
  const header = comma >= 0 ? value.slice(0, Math.min(comma, 80)) : "data:";
  const omitted = Math.max(0, value.length - (comma >= 0 ? comma + 1 : 5));
  return `${header},<omitted ${omitted} chars>`;
}

function redactStoredMediaValue(value: unknown): unknown {
  if (typeof value === "string") return redactStoredMediaRef(value);
  if (Array.isArray(value)) return value.map(redactStoredMediaValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = redactStoredMediaValue(entry);
    }
    return out;
  }
  return value;
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function isD1TooBig(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /TOOBIG|too big/i.test(message);
}

export function paramsJsonForStorage(payload: Record<string, unknown>): string {
  const stored = redactStoredMediaValue(payload) as Record<string, unknown>;
  let json = JSON.stringify(stored);
  if (utf8Bytes(json) <= D1_MAX_TEXT_BYTES) return json;
  const slim: Record<string, unknown> = { ...stored, media_omitted: true };
  delete slim.input_image;
  delete slim.input_images;
  delete slim.input_face_images;
  delete slim.input_video;
  delete slim.input_videos;
  delete slim.input_face_videos;
  delete slim.input_audios;
  delete slim.audio_urls;
  delete slim.image_url;
  json = JSON.stringify(slim);
  if (utf8Bytes(json) <= D1_MAX_TEXT_BYTES) return json;
  const prompt = typeof payload.prompt === "string" ? payload.prompt.slice(0, 20_000) : "";
  const slimmed: Record<string, unknown> = {
    model: payload.model,
    prompt,
    media_omitted: true,
  };
  if (payload.capture_last_frame === true) slimmed.capture_last_frame = true;
  return JSON.stringify(slimmed);
}

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
  const audios = remote.audios as { url?: string }[] | undefined;
  const video = remote.video as { url?: string } | undefined;
  const image = remote.image as { url?: string } | undefined;
  const audio = remote.audio as { url?: string } | string | undefined;
  const result = remote.result as { url?: string } | undefined;
  const audioUrl = typeof audio === "string" ? audio : audio?.url;
  return firstTrimmedUrl(
    remote.result_url,
    images?.[0]?.url,
    videos?.[0]?.url,
    video?.url,
    image?.url,
    audios?.[0]?.url,
    audioUrl,
    remote.audio_url,
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

/**
 * Wan's Green Net check reports `text (input)` when it refuses the prompt itself.
 * Say that plainly. Leave image and output refusals unchanged.
 */
export function presentGenerationError(message: string | null | undefined): string | null {
  if (message == null) return null;
  const trimmed = message.trim();
  if (!trimmed) return null;
  const inspection = /data\s*inspection\s*failed/i.test(trimmed) || /green\s*net/i.test(trimmed);
  const textInput = /text\s*\(\s*input\s*\)/i.test(trimmed);
  if (inspection && textInput) {
    return "This model rejected the prompt text. Its content check blocked the text, so edit the prompt and try again.";
  }
  return trimmed;
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

/** Image, video, and audio jobs share POST /api/ai/queue. There is no sync generate path. */
export function buildEnqueuePayload(
  mediaType: "image" | "video" | "audio",
  body: EnqueueBody,
): Record<string, unknown> {
  const draftTaskId = body.draft_task_id?.trim();
  if (draftTaskId) {
    return { model: body.model.trim(), draft_task_id: draftTaskId };
  }
  const shots = normalizeMultiPrompt(body.multi_prompt);
  const payload: Record<string, unknown> = {
    model: body.model.trim(),
    num_generations: Math.min(Math.max(body.num_generations ?? 1, 1), 4),
  };
  if (shots) payload.multi_prompt = shots;
  else payload.prompt = body.prompt.trim();

  switch (mediaType) {
    case "image":
    case "video":
      assignIfPresent(payload, "aspect_ratio", body.aspect_ratio);
      if (body.seed != null) payload.seed = body.seed;
      assignIfPresent(payload, "input_image", body.input_image);
      assignIfPresent(payload, "input_images", body.input_images);
      assignIfPresent(payload, "input_face_images", body.input_face_images);
      assignIfPresent(payload, "quality", body.quality);
      assignIfPresent(payload, "resolution", body.resolution);
      assignIfPresent(payload, "size", body.size);
      assignIfPresent(payload, "image_size", body.image_size);
      assignIfPresent(payload, "output_format", body.output_format);
      assignIfPresent(payload, "background", body.background);
      assignIfPresent(payload, "moderation", body.moderation);
      assignIfPresent(payload, "safety_tolerance", body.safety_tolerance);
      if (mediaType === "video") {
        assignIfPresent(payload, "input_video", body.input_video);
        assignIfPresent(payload, "input_videos", body.input_videos);
        assignIfPresent(payload, "input_face_videos", body.input_face_videos);
        assignIfPresent(payload, "input_audios", body.input_audios);
        assignIfPresent(payload, "duration", body.duration);
        if (body.generate_audio != null) payload.generate_audio = body.generate_audio;
        if (body.draft != null) payload.draft = body.draft;
      }
      break;
    case "audio":
      assignIfPresent(payload, "audio_urls", body.audio_urls);
      assignIfPresent(payload, "image_url", body.image_url);
      assignIfPresent(payload, "output_format", body.output_format);
      assignIfPresent(payload, "safety_tolerance", body.safety_tolerance);
      if (body.sample_rate != null) payload.sample_rate = body.sample_rate;
      if (body.speed != null) payload.speed = body.speed;
      if (body.volume != null) payload.volume = body.volume;
      if (body.pitch != null) payload.pitch = body.pitch;
      break;
    default: {
      const _exhaustive: never = mediaType;
      return _exhaustive;
    }
  }

  return payload;
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
  const missing = [...FEATURED_VIDEO_SEARCHES, ...FEATURED_AUDIO_SEARCHES].filter(
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

async function readOxenJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new OxenApiError(text || `Oxen request failed (${res.status})`);
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
    throw new OxenApiError(oxenErrorText(data, `Oxen models failed (${res.status})`));
  }
  return modelsFromListPayload(data);
}

const CATALOG_TTL_MS = 120_000;
const liveCatalogCache = new Map<string, { at: number; models: OxenModel[] }>();

async function catalogCacheKey(apiKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(apiKey));
  return [...new Uint8Array(digest).slice(0, 8)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** One Oxen catalog fetch per key, reused while the composer switches modes. */
export async function cachedLiveCatalog(apiKey: string): Promise<OxenModel[]> {
  const key = await catalogCacheKey(apiKey);
  const hit = liveCatalogCache.get(key);
  if (hit && Date.now() - hit.at < CATALOG_TTL_MS) return hit.models;
  const models = await mergeMissingFeaturedModels(apiKey, await listModels(apiKey));
  liveCatalogCache.set(key, { at: Date.now(), models });
  return models;
}

export async function searchModels(apiKey: string, query: string): Promise<OxenModel[]> {
  const params = new URLSearchParams({ search: query });
  const res = await oxenFetch(`/models/search?${params.toString()}`, apiKey);
  const data = await readOxenJson<{ data?: OxenModel[] } & OxenErrorBody>(res);
  if (!res.ok) {
    throw new OxenApiError(oxenErrorText(data, `Oxen model search failed (${res.status})`));
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
    throw new OxenApiError(oxenErrorText(data, `Oxen model detail failed (${res.status})`));
  }
  const model = data.data ?? data;
  if (!model.id) {
    throw new OxenApiError(oxenErrorText(data, "Oxen model detail returned no id"));
  }
  modelDetailCache.set(id, { at: Date.now(), model });
  return model;
}

export async function listFavoriteModels(apiKey: string): Promise<OxenModel[]> {
  const res = await oxenFetch("/models/favorites", apiKey);
  const data = await readOxenJson<{ data?: OxenModel[] } & OxenErrorBody>(res);
  if (!res.ok) {
    throw new OxenApiError(oxenErrorText(data, `Oxen favorites failed (${res.status})`));
  }
  return modelsFromListPayload(data);
}

export async function favoriteModel(apiKey: string, id: string): Promise<void> {
  const res = await oxenFetch(`/models/${encodeURIComponent(id)}/favorite`, apiKey, {
    method: "POST",
  });
  if (!res.ok) {
    const data = await readOxenJson<OxenErrorBody>(res);
    throw new OxenApiError(oxenErrorText(data, `Oxen favorite failed (${res.status})`));
  }
}

export async function unfavoriteModel(apiKey: string, id: string): Promise<void> {
  const res = await oxenFetch(`/models/${encodeURIComponent(id)}/favorite`, apiKey, {
    method: "DELETE",
  });
  if (!res.ok) {
    const data = await readOxenJson<OxenErrorBody>(res);
    throw new OxenApiError(oxenErrorText(data, `Oxen unfavorite failed (${res.status})`));
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
    throw new OxenApiError(oxenErrorText(data, `Oxen enqueue failed (${res.status})`));
  }
  const generations = data.generations ?? [];
  if (generations.length === 0) {
    throw new OxenApiError(
      oxenErrorText(data, "Oxen enqueue returned no generations"),
    );
  }
  return generations;
}

export async function completeChat(apiKey: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await oxenFetch("/chat/completions", apiKey, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const data = await readOxenJson<Record<string, unknown> & OxenErrorBody>(res);
  if (!res.ok) {
    throw new OxenApiError(oxenErrorText(data, `Oxen chat failed (${res.status})`));
  }
  return data;
}

export async function getGeneration(
  apiKey: string,
  generationId: string,
): Promise<Record<string, unknown>> {
  const res = await oxenFetch(`/queue/${encodeURIComponent(generationId)}`, apiKey);
  const data = await readOxenJson<Record<string, unknown> & OxenErrorBody>(res);
  if (!res.ok) {
    throw new OxenApiError(oxenErrorText(data, `Oxen status failed (${res.status})`));
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
    throw new OxenApiError(oxenErrorText(data, `Oxen queue list failed (${res.status})`));
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
    throw new OxenApiError(oxenErrorText(data, `Oxen cancel failed (${res.status})`));
  }
}

/** Bound so a stuck provider URL cannot pin a Worker invocation. */
export const OXEN_RESULT_DOWNLOAD_MS = 20_000;

export const OXEN_RESULT_MAX_REDIRECTS = 5;

// Local check, not oxen-refs: src/ imports this module and cannot pull in Worker-only types.
function isOxenHost(url: URL): boolean {
  return url.protocol === "https:" && url.hostname === "hub.oxen.ai";
}

/**
 * Follow redirects by hand so the user's Oxen key only ever goes to hub.oxen.ai,
 * never to a provider CDN or wherever a redirect points.
 */
export async function downloadOxenResult(
  apiKey: string,
  resultUrl: string,
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const signal = AbortSignal.timeout(OXEN_RESULT_DOWNLOAD_MS);
  let url = new URL(resultUrl);
  for (let hop = 0; hop <= OXEN_RESULT_MAX_REDIRECTS; hop++) {
    const res = await fetch(url.toString(), {
      headers: isOxenHost(url) ? { Authorization: `Bearer ${apiKey}` } : {},
      redirect: "manual",
      signal,
    });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (location) {
      url = new URL(location, url);
      continue;
    }
    if (!res.ok) {
      throw new OxenApiError(`Oxen result download failed (${res.status})`);
    }
    return {
      bytes: await res.arrayBuffer(),
      contentType: res.headers.get("content-type") || "application/octet-stream",
    };
  }
  throw new OxenApiError("Oxen result download redirected too many times");
}
