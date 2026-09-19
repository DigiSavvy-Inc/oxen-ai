import { estimateGenerationCost, type OxenPricing } from "../../worker/pricing";

export { estimateGenerationCost, type OxenPricing };

export type GenerationMode =
  | "text-to-image"
  | "image-to-image"
  | "text-to-video"
  | "reference-to-video"
  | "video-to-video";

export type SessionUser = {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  hasOxenKey: boolean;
};

export type OxenModel = {
  id: string;
  display_name?: string;
  description?: string | null;
  endpoint?: string;
  capabilities?: { input?: string[]; output?: string[] };
  pricing?: OxenPricing | null;
};

export const OXEN_BILLING_URL = "https://www.oxen.ai/digisavvy/settings/billing";

export type MediaSlot = {
  field: string;
  kind: "image" | "video" | "audio";
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
  resolutionField?: "resolution" | "size" | "image_size";
  outputFormat: string[] | null;
  background: string[] | null;
  slots: MediaSlot[];
  mentions: boolean;
  pricing: OxenPricing | null;
};

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

export type Generation = {
  id: string;
  oxenGenerationId: string;
  mode: GenerationMode | string;
  model: string;
  prompt: string | null;
  status: string;
  mediaType: string | null;
  resultUrl: string | null;
  thumbUrl?: string | null;
  errorMessage: string | null;
  batchId: string | null;
  createdAt: number;
  updatedAt: number;
  enqueuedAt?: number | null;
  startedAt?: number | null;
  etaSeconds?: number | null;
  progress?: number | null;
  typicalSeconds?: number | null;
  tags?: string[];
};

export type CreditBalance = {
  remaining: number | null;
  currency: string;
  billingUrl: string;
};

export const MODE_LABELS: Record<GenerationMode, string> = {
  "text-to-image": "Text → Image",
  "image-to-image": "Image → Image",
  "text-to-video": "Text → Video",
  "reference-to-video": "Image → Video",
  "video-to-video": "Video → Video",
};

export const ALL_MODES: GenerationMode[] = [
  "text-to-image",
  "image-to-image",
  "text-to-video",
  "reference-to-video",
  "video-to-video",
];

export function modeNeedsVideo(mode: GenerationMode): boolean {
  return mode === "video-to-video";
}

export function modeIsVideo(mode: GenerationMode): boolean {
  return (
    mode === "text-to-video" ||
    mode === "reference-to-video" ||
    mode === "video-to-video"
  );
}

export function slotMax(controls: ModelControls | null, kind: MediaSlot["kind"]): number {
  if (!controls) return 0;
  const slots = controls.slots.filter((slot) => slot.kind === kind);
  if (slots.length === 0) return 0;
  return Math.max(...slots.map((slot) => slot.maxItems));
}

export function mentionToken(kind: MediaSlot["kind"], index: number): string {
  const n = index + 1;
  switch (kind) {
    case "image":
      return `@Image${n}`;
    case "video":
      return `@Video${n}`;
    case "audio":
      return `@Audio${n}`;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function slotRequired(
  controls: ModelControls | null,
  kind: MediaSlot["kind"],
  mode: GenerationMode,
): boolean {
  if (kind === "image" && mode === "image-to-image") return true;
  if (kind === "video" && mode === "video-to-video") return true;
  if (!controls) {
    return (
      (kind === "image" && mode === "reference-to-video") ||
      (kind === "video" && mode === "video-to-video")
    );
  }
  return controls.slots.some((slot) => slot.kind === kind && slot.required);
}

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error || `Request failed (${res.status})`,
    );
  }
  return data;
}

export const api = {
  me: () => fetch("/api/auth/me").then((r) => parseJson<{ user: SessionUser | null }>(r)),
  logout: () => fetch("/api/auth/logout", { method: "POST" }).then((r) => parseJson(r)),
  saveOxenKey: (apiKey: string) =>
    fetch("/api/settings/oxen-key", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    }).then((r) => parseJson(r)),
  clearOxenKey: () =>
    fetch("/api/settings/oxen-key", { method: "DELETE" }).then((r) => parseJson(r)),
  studioSettings: () =>
    fetch("/api/settings/studio").then((r) => parseJson<StudioSettings>(r)),
  saveStudioSettings: (body: Partial<StudioSettings>) =>
    fetch("/api/settings/studio", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => parseJson<StudioSettings>(r)),
  models: (mode: GenerationMode) =>
    fetch(`/api/models?mode=${encodeURIComponent(mode)}`).then((r) =>
      parseJson<{ mode: string; models: OxenModel[] }>(r),
    ),
  searchModels: (mode: GenerationMode | "", q: string) => {
    const params = new URLSearchParams({ q });
    if (mode) params.set("mode", mode);
    return fetch(`/api/models/search?${params.toString()}`).then((r) =>
      parseJson<{ mode: string | null; models: OxenModel[] }>(r),
    );
  },
  modelDetail: (id: string) =>
    fetch(`/api/models/${encodeURIComponent(id)}`).then((r) =>
      parseJson<{ model: OxenModel; controls: ModelControls }>(r),
    ),
  favorites: () =>
    fetch("/api/models/favorites").then((r) => parseJson<{ models: OxenModel[] }>(r)),
  favorite: (id: string) =>
    fetch(`/api/models/${encodeURIComponent(id)}/favorite`, { method: "POST" }).then((r) =>
      parseJson<{ ok: boolean }>(r),
    ),
  unfavorite: (id: string) =>
    fetch(`/api/models/${encodeURIComponent(id)}/favorite`, { method: "DELETE" }).then(
      (r) => parseJson<{ ok: boolean }>(r),
    ),
  upload: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return fetch("/api/upload", { method: "POST", body: form }).then((r) =>
      parseJson<{ key: string; url: string; contentType: string; name: string }>(r),
    );
  },
  generate: (body: Record<string, unknown>) =>
    fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => parseJson<{ generations: Generation[] }>(r)),
  listGenerations: (scope: "active" | "library" = "library") => {
    const params = new URLSearchParams({ scope });
    return fetch(`/api/generations?${params}`).then((r) =>
      parseJson<{ generations: Generation[] }>(r),
    );
  },
  getGeneration: (id: string) =>
    fetch(`/api/generations/${id}`).then((r) =>
      parseJson<{ generation: Generation }>(r),
    ),
  updateGenerationTags: (id: string, tags: string[]) =>
    fetch(`/api/generations/${id}/tags`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    }).then((r) => parseJson<{ generation: Generation }>(r)),
  cancelGeneration: (id: string) =>
    fetch(`/api/generations/${id}`, { method: "DELETE" }).then((r) => parseJson(r)),
  cleanupLibrary: (action: "failed" | "thumbs") =>
    fetch("/api/library/cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).then((r) =>
      parseJson<{ action: string; deleted: number; built: number; remaining: boolean }>(r),
    ),
  credits: () =>
    fetch("/api/billing/credits").then((r) => parseJson<CreditBalance>(r)),
  allowlist: () =>
    fetch("/api/admin/allowlist").then((r) =>
      parseJson<{
        org: string;
        admins: string[];
        allowlist: { github_login: string; added_by: string | null; created_at: number }[];
      }>(r),
    ),
  addAllowlist: (login: string) =>
    fetch("/api/admin/allowlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login }),
    }).then((r) => parseJson(r)),
  removeAllowlist: (login: string) =>
    fetch(`/api/admin/allowlist/${encodeURIComponent(login)}`, {
      method: "DELETE",
    }).then((r) => parseJson(r)),
};
