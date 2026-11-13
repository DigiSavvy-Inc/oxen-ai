import type { AppliedLook, Look, LookGroup } from "../../worker/looks";
import { firstSupportedMode, modelSupportsMode } from "../../worker/model-modes";
import { estimateGenerationCost, type OxenPricing } from "../../worker/pricing";
import type { ComposerDefaults, ComposerDraft, ComposerSettings } from "../../worker/project-draft";
import type { JobOutputJson, JobRefJson, JobStatus, ProjectJobJson } from "../../worker/job-record";
import type { ReferenceCaps, ReferenceModel } from "../../worker/reference-models";
import type { MediaRole } from "../../worker/schema";
import { withLiveMediaRefs } from "./media-links";

export { firstSupportedMode, modelSupportsMode };
export { estimateGenerationCost, type OxenPricing };
export type { AppliedLook, LookGroup };
export type { ComposerDefaults, ComposerDraft, ComposerSettings };
export type { ReferenceCaps, ReferenceModel };
export type ProjectJob = ProjectJobJson;
export type ProjectJobOutput = JobOutputJson;
export type ProjectJobRef = JobRefJson;
export type ProjectJobStatus = JobStatus;

export type GenerationMode =
  | "text-to-image"
  | "image-to-image"
  | "text-to-video"
  | "reference-to-video"
  | "video-to-video"
  | "text-to-audio"
  | "chat";

export type SessionUser = {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  hasOxenKey: boolean;
  /** A key is saved but can't be decrypted; the user must re-enter it. */
  oxenKeyUnreadable?: boolean;
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

export type SafetyCheckerControl = {
  field: "disable_safety_checker" | "enable_safety_checker";
  offValue: boolean;
};

export type ModerationControl = {
  values: string[];
  defaultValue: string;
};

export type DurationControl =
  | { kind: "int"; min: number; max: number; step?: number; defaultValue?: number }
  | { kind: "enum"; values: string[]; defaultValue?: string };

export type ModelControls = {
  modelId: string;
  aspectRatios: string[] | null;
  duration: DurationControl | null;
  seed: boolean;
  generateAudio: boolean;
  generateAudioDefault?: boolean | null;
  draft?: boolean;
  draftDefault?: boolean;
  imageVideoExclusive?: boolean;
  quality: string[] | null;
  resolution: string[] | null;
  resolutionField?: "resolution" | "size" | "image_size";
  outputFormat: string[] | null;
  background: string[] | null;
  safetyTolerance?: DurationControl | null;
  safetyChecker?: SafetyCheckerControl | null;
  moderation?: ModerationControl | null;
  sampleRate?: DurationControl | null;
  speed?: DurationControl | null;
  volume?: DurationControl | null;
  pitch?: DurationControl | null;
  imageAudioExclusive?: boolean;
  mentionKinds?: Array<"image" | "video" | "audio">;
  slots: MediaSlot[];
  mentions: boolean;
  pricing: OxenPricing | null;
  /** Kling-style multi-shot. Sent as multi_prompt, never together with prompt. */
  multiPrompt?: boolean;
  /** Seedance omni_reference_task_type. Default value is first. */
  referenceTask?: string[] | null;
  aspectLock?: { value: string; tasks: string[] } | null;
  durationLock?: { value: string; tasks: string[] } | null;
  /** Resolution sent while draft is on. Seedance locks this to 480p. */
  resolutionDraftLock?: string | null;
};

export type SharedOxenParams = {
  aspect_ratio?: string;
  seed?: number;
  duration?: number | string;
  generate_audio?: boolean;
  draft?: boolean;
  num_generations?: number;
  quality?: string;
  resolution?: string;
  output_format?: string;
  omni_reference_task_type?: string;
  background?: string;
  moderation?: string;
  disable_safety_checker?: boolean;
  enable_safety_checker?: boolean;
  safety_tolerance?: number;
  sample_rate?: number;
  speed?: number;
  volume?: number;
  pitch?: number;
};

export type StudioSettings = {
  defaultModelByMode: Partial<Record<GenerationMode, string>>;
  lastParams: SharedOxenParams;
  historyPageSize: number;
  videoThumbSeconds: number;
};

/** Instance-wide name and logo. `savedName` is null when the default is in use. */
export type InstanceBranding = {
  name: string;
  savedName: string | null;
  logoUrl: string;
  logoType: string;
  customLogo: boolean;
};

export type LibraryMediaFilter = "" | "image" | "video" | "audio";

export type Generation = {
  id: string;
  oxenGenerationId: string;
  mode: GenerationMode | string;
  model: string;
  prompt: string | null;
  status: string;
  mediaType: string | null;
  resultUrl: string | null;
  resultKey?: string | null;
  thumbUrl?: string | null;
  captureLastFrame?: boolean;
  lastFrameUrl?: string | null;
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
  draftTaskId?: string | null;
  draftExpiresAt?: string | null;
  profileId?: string | null;
  /** The project this run was made from, when it was a job. */
  projectId?: string | null;
  /** Looks applied when this run was sent, ids and names. */
  looks?: AppliedLook[];
  /** The prompt as written, when it differs from the prompt that was sent. */
  writtenPrompt?: string | null;
};

export type SavedPrompt = {
  id: string;
  name: string;
  body: string;
  createdAt: number;
};

export type GalleryPreview = {
  kind: "image" | "video" | "audio";
  name: string;
  thumbUrl: string | null;
  mediaUrl?: string | null;
};

export type GalleryMentionItem = {
  key: string;
  kind: "image" | "video" | "audio";
  name: string;
  role: string | null;
  label: string | null;
  thumbUrl: string | null;
};

export type GallerySummary = {
  id: string;
  name: string;
  updatedAt: number;
  count?: number;
  previews?: GalleryPreview[];
  handle?: string;
  takeCount?: number;
  items?: GalleryMentionItem[];
};

export type GalleryItem = {
  id: string;
  kind: "image" | "video" | "audio";
  name: string;
  key: string;
  url: string;
  thumbUrl?: string | null;
  role?: string | null;
  label?: string | null;
};

export type Gallery = {
  id: string;
  name: string;
  handle: string;
  takeCount: number;
  updatedAt: number;
  items: GalleryItem[];
};

export type StudioProfile = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type ProfileState = {
  profiles: StudioProfile[];
  activeId: string | null;
};

export type StudioLook = Look;

export type ProjectSummary = {
  id: string;
  name: string;
  updatedAt: number;
  castCount: number;
  galleryCount: number;
  jobCount: number;
  lastRunAt: number | null;
};

export type ProjectCastGalleryItem = {
  id: string;
  kind: "image" | "video" | "audio";
  name: string;
  key: string;
  url: string | null;
  thumbUrl: string | null;
  galleryRole: MediaRole | null;
  roleOverride: MediaRole | null;
  active: boolean;
  excluded: boolean;
};

export type ProjectCastEntry =
  | {
      type: "gallery";
      id: string;
      name: string;
      active: boolean;
      items: ProjectCastGalleryItem[];
    }
  | {
      type: "file";
      id: string;
      kind: "image" | "video" | "audio";
      name: string;
      key: string;
      url: string | null;
      thumbUrl: string | null;
      role: MediaRole | null;
      active: boolean;
    };

export type ProjectCastRequest = Array<
  | {
      type: "gallery";
      id: string;
      active: boolean;
      items: { key: string; active: boolean; excluded: boolean; role: MediaRole | null }[];
    }
  | {
      type: "file";
      kind: "image" | "video" | "audio";
      name: string;
      key: string;
      role: MediaRole | null;
      active: boolean;
    }
>;

export type ProjectShare = {
  id: string;
  token: string;
  expiresAt: number | null;
  revokedAt: number | null;
  createdAt: number;
};

export type StudioProject = {
  id: string;
  name: string;
  prompt: string;
  /** Applied looks in chip order, up to five. */
  lookIds: string[];
  updatedAt: number;
  budget: number;
  cast: ProjectCastEntry[];
  galleryIds: string[];
  /** Composer state from the last visit; null when the project has not been opened yet. */
  draft: ComposerDraft | null;
  /**
   * Mode, model, and settings for a new job: the model the Brief pinned, or what the
   * last run used. Null before either.
   */
  defaults: ComposerDefaults | null;
  jobCount: number;
  lastRunAt: number | null;
  shares: ProjectShare[];
};

export type SharedProject = {
  name: string;
  prompt: string;
  looks: StudioLook[];
  budget: number;
  cast: ProjectCastEntry[];
};

export type CreditBalance = {
  remaining: number | null;
  currency: string;
  billingUrl: string;
};

export const MODE_LABELS: Record<GenerationMode, string> = {
  chat: "Chat",
  "text-to-image": "Text \u2192 Image",
  "image-to-image": "Image \u2192 Image",
  "text-to-video": "Text \u2192 Video",
  "reference-to-video": "Image \u2192 Video",
  "video-to-video": "Video \u2192 Video",
  "text-to-audio": "Text \u2192 Audio",
};

export const ALL_MODES: GenerationMode[] = [
  "text-to-image",
  "image-to-image",
  "text-to-video",
  "reference-to-video",
  "video-to-video",
  "text-to-audio",
  "chat",
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

/** Saved reference galleries for image edit, every video mode, and text-to-audio. */
export function modeHasReferenceGallery(mode: GenerationMode | null | undefined): boolean {
  if (!mode) return false;
  return mode === "image-to-image" || mode === "text-to-audio" || modeIsVideo(mode);
}

export function slotMax(controls: Pick<ModelControls, "slots"> | null, kind: MediaSlot["kind"]): number {
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

/** Chip label for a mention token: `@Image1` becomes `Image 1`. */
export function mentionChipLabel(token: string): string {
  const match = /^@(Image|Video|Audio)(\d+)$/.exec(token);
  if (!match?.[1] || !match[2]) return token;
  return `${match[1]} ${match[2]}`;
}

export function slotRequired(
  controls: Pick<ModelControls, "slots"> | null,
  kind: MediaSlot["kind"],
  mode: GenerationMode | null,
): boolean {
  if (controls) {
    return controls.slots.some((slot) => slot.kind === kind && slot.required);
  }
  if (!mode) return false;
  if (kind === "image") return mode === "image-to-image" || mode === "reference-to-video";
  if (kind === "video") return mode === "video-to-video";
  return false;
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

function renewMediaLinks(urls: string[]): Promise<(string | null)[]> {
  return fetch("/api/media/renew", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  })
    .then((r) => parseJson<{ urls: (string | null)[] }>(r))
    .then((data) => data.urls);
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
  branding: () => fetch("/api/branding").then((r) => parseJson<InstanceBranding>(r)),
  saveBranding: (body: { name: string; clearLogo?: boolean }) =>
    fetch("/api/branding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => parseJson<InstanceBranding>(r)),
  saveBrandingLogo: (file: Blob) =>
    fetch("/api/branding/logo", { method: "PUT", body: file }).then((r) =>
      parseJson<InstanceBranding>(r),
    ),
  studioSettings: () =>
    fetch("/api/settings/studio").then((r) => parseJson<StudioSettings>(r)),
  saveStudioSettings: (body: Partial<StudioSettings>) =>
    fetch("/api/settings/studio", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => parseJson<StudioSettings>(r)),
  models: (mode?: GenerationMode | null) => {
    const params = mode ? `?mode=${encodeURIComponent(mode)}` : "";
    return fetch(`/api/models${params}`).then((r) =>
      parseJson<{ mode: string | null; models: OxenModel[] }>(r),
    );
  },
  searchModels: (mode: GenerationMode | "" | null, q: string) => {
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
  referenceModels: () =>
    fetch("/api/models/references").then((r) => parseJson<{ models: ReferenceModel[] }>(r)),
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
  upload: async (file: File, options?: { folder?: "galleries" }) => {
    const form = new FormData();
    form.append("file", file);
    if (options?.folder === "galleries") form.append("folder", "galleries");
    return fetch("/api/upload", { method: "POST", body: form }).then((r) =>
      parseJson<{ key: string; url: string; contentType: string; name: string }>(r),
    );
  },
  renewMediaLinks,
  // A reference attached hours ago carries a link that has expired since. Exchange it first.
  generate: async (body: Record<string, unknown>) =>
    fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(await withLiveMediaRefs(body, renewMediaLinks)),
    }).then((r) => parseJson<{ generations: Generation[] }>(r)),
  chat: (body: { model: string; messages: unknown[] }) =>
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => parseJson<{ reply: string }>(r)),
  listGenerations: (
    scope: "active" | "library" = "library",
    options?: {
      signal?: AbortSignal;
      page?: number;
      pageSize?: number;
      tag?: string;
      media?: LibraryMediaFilter;
    },
  ) => {
    const params = new URLSearchParams({ scope });
    if (scope === "library") {
      if (options?.page) params.set("page", String(options.page));
      if (options?.pageSize) params.set("pageSize", String(options.pageSize));
      if (options?.tag) params.set("tag", options.tag);
      if (options?.media) params.set("media", options.media);
    }
    return fetch(`/api/generations?${params}`, { signal: options?.signal }).then((r) =>
      parseJson<{
        generations: Generation[];
        page?: number;
        pageSize?: number;
        total?: number;
        tags?: string[];
      }>(r),
    );
  },
  getGeneration: (id: string) =>
    fetch(`/api/generations/${id}`).then((r) =>
      parseJson<{ generation: Generation }>(r),
    ),
  saveLastFrame: (id: string, file: Blob) => {
    const form = new FormData();
    form.append("file", file, "last-frame.jpg");
    return fetch(`/api/generations/${id}/last-frame`, { method: "POST", body: form }).then((r) =>
      parseJson<{ lastFrameUrl: string | null; updatedAt: number }>(r),
    );
  },
  updateGenerationTags: (id: string, tags: string[]) =>
    fetch(`/api/generations/${id}/tags`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags }),
    }).then((r) => parseJson<{ generation: Generation }>(r)),
  deleteGeneration: (id: string, options?: { fromOxen?: boolean }) => {
    const params = new URLSearchParams();
    if (options?.fromOxen) params.set("fromOxen", "1");
    const query = params.toString();
    return fetch(`/api/generations/${id}${query ? `?${query}` : ""}`, { method: "DELETE" }).then(
      (r) => parseJson<{ ok: boolean; oxenDeleted?: number; oxenAlreadyGone?: number; oxenFailed?: number }>(r),
    );
  },
  /** One request for a whole selection, so Oxen removes the copies together. Up to 200 ids. */
  deleteGenerations: (ids: string[], options?: { fromOxen?: boolean }) =>
    fetch("/api/generations/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, fromOxen: options?.fromOxen === true }),
    }).then((r) =>
      parseJson<{
        ok: boolean;
        deleted?: number;
        missing?: number;
        oxenDeleted?: number;
        oxenAlreadyGone?: number;
        oxenFailed?: number;
      }>(r),
    ),
  cancelGeneration: (id: string, options?: { fromOxen?: boolean }) => {
    const params = new URLSearchParams();
    if (options?.fromOxen) params.set("fromOxen", "1");
    const query = params.toString();
    return fetch(`/api/generations/${id}${query ? `?${query}` : ""}`, { method: "DELETE" }).then(
      (r) => parseJson<{ ok: boolean; oxenDeleted?: number; oxenAlreadyGone?: number; oxenFailed?: number }>(r),
    );
  },
  cleanupLibrary: (action: "failed" | "thumbs" | "all", options?: { fromOxen?: boolean }) =>    fetch("/api/library/cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, fromOxen: options?.fromOxen === true }),
    }).then((r) =>
      parseJson<{
        action: string;
        deleted: number;
        built: number;
        remaining: boolean;
        r2Deleted?: number;
        oxenDeleted?: number;
        oxenAlreadyGone?: number;
        oxenFailed?: number;
      }>(r),
    ),
  savedPrompts: () =>
    fetch("/api/prompts").then((r) => parseJson<{ prompts: SavedPrompt[] }>(r)),
  savePrompt: (name: string, body: string) =>
    fetch("/api/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, body }),
    }).then((r) => parseJson<{ prompt: SavedPrompt }>(r)),
  updateSavedPrompt: (id: string, name: string, body: string) =>
    fetch(`/api/prompts/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, body }),
    }).then((r) => parseJson<{ prompt: SavedPrompt }>(r)),
  deleteSavedPrompt: (id: string) =>
    fetch(`/api/prompts/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) =>
      parseJson<{ ok: boolean }>(r),
    ),
  galleries: (query = "") => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    const suffix = params.toString();
    return fetch(`/api/galleries${suffix ? `?${suffix}` : ""}`).then((r) =>
      parseJson<{ galleries: GallerySummary[] }>(r),
    );
  },
  gallery: (id: string) =>
    fetch(`/api/galleries/${encodeURIComponent(id)}`).then((r) =>
      parseJson<{ gallery: Gallery }>(r),
    ),
  saveGallery: (body: {
    id?: string | null;
    name: string;
    handle?: string;
    takeCount?: number;
    items: { kind: GalleryItem["kind"]; name: string; key: string; role?: string | null; label?: string | null }[];
  }) =>
    fetch("/api/galleries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => parseJson<{ gallery: Gallery }>(r)),
  deleteGallery: (id: string) =>
    fetch(`/api/galleries/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) =>
      parseJson<{ ok: boolean }>(r),
    ),
  projects: () =>
    fetch("/api/projects").then((r) =>
      parseJson<{ projects: ProjectSummary[]; looks: StudioLook[] }>(r),
    ),
  project: (id: string) =>
    fetch(`/api/projects/${encodeURIComponent(id)}`).then((r) =>
      parseJson<{ project: StudioProject }>(r),
    ),
  createProject: (name: string) =>
    fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((r) => parseJson<{ project: StudioProject }>(r)),
  saveProject: (
    id: string,
    body: {
      name: string;
      prompt: string;
      lookIds: string[];
      budget: number;
      cast: ProjectCastRequest;
    },
  ) =>
    fetch(`/api/projects/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => parseJson<{ project: StudioProject }>(r)),
  deleteProject: (id: string) =>
    fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) =>
      parseJson<{ ok: boolean }>(r),
    ),
  createLook: (name: string, body: string, group: LookGroup | null) =>
    fetch("/api/styles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, body, group }),
    }).then((r) => parseJson<{ look: StudioLook }>(r)),
  updateLook: (
    id: string,
    patch: { name?: string; body?: string; group?: LookGroup | null; starred?: boolean },
  ) =>
    fetch(`/api/styles/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).then((r) => parseJson<{ look: StudioLook }>(r)),
  deleteLook: (id: string) =>
    fetch(`/api/styles/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) =>
      parseJson<{ ok: boolean }>(r),
    ),
  projectJobs: (projectId: string) =>
    fetch(`/api/projects/${encodeURIComponent(projectId)}/jobs`).then((r) =>
      parseJson<{ jobs: ProjectJob[] }>(r),
    ),
  saveProjectDraft: (
    projectId: string,
    body: { draft?: ComposerDraft; defaults?: ComposerDefaults },
  ) =>
    fetch(`/api/projects/${encodeURIComponent(projectId)}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => parseJson<{ ok: boolean }>(r)),
  createProjectShare: (projectId: string, days: number | null) =>
    fetch(`/api/projects/${encodeURIComponent(projectId)}/shares`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
    }).then((r) => parseJson<{ share: ProjectShare }>(r)),
  revokeProjectShare: (projectId: string, shareId: string) =>
    fetch(`/api/projects/${encodeURIComponent(projectId)}/shares/${encodeURIComponent(shareId)}`, {
      method: "DELETE",
    }).then((r) => parseJson<{ ok: boolean }>(r)),
  sharedProject: (token: string) =>
    fetch(`/api/shares/${encodeURIComponent(token)}`).then((r) =>
      parseJson<{ share: SharedProject }>(r),
    ),
  profiles: () => fetch("/api/profiles").then((r) => parseJson<ProfileState>(r)),
  createProfile: (name: string) =>
    fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((r) => parseJson<ProfileState>(r)),
  renameProfile: (id: string, name: string) =>
    fetch(`/api/profiles/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then((r) => parseJson<ProfileState>(r)),
  activateProfile: (id: string) =>
    fetch(`/api/profiles/${encodeURIComponent(id)}/activate`, { method: "POST" }).then((r) =>
      parseJson<ProfileState>(r),
    ),
  deleteProfile: (id: string) =>
    fetch(`/api/profiles/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) =>
      parseJson<ProfileState>(r),
    ),
  credits: () =>
    fetch("/api/billing/credits").then((r) => parseJson<CreditBalance>(r)),
  pushConfig: () =>
    fetch("/api/push/config").then((r) =>
      parseJson<{ enabled: boolean; vapidPublicKey: string | null; subscribed: boolean }>(r),
    ),
  subscribePush: (subscription: PushSubscriptionJSON) =>
    fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription),
    }).then((r) => parseJson<{ ok: boolean }>(r)),
  unsubscribePush: (endpoint: string) =>
    fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    }).then((r) => parseJson<{ ok: boolean }>(r)),
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
