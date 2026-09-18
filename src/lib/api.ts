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
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
};

export const MODE_LABELS: Record<GenerationMode, string> = {
  "text-to-image": "Text → Image",
  "image-to-image": "Image → Image",
  "text-to-video": "Text → Video",
  "reference-to-video": "Ref → Video",
  "video-to-video": "Video → Video",
};

export const ALL_MODES: GenerationMode[] = [
  "text-to-image",
  "image-to-image",
  "text-to-video",
  "reference-to-video",
  "video-to-video",
];

export function modeNeedsImage(mode: GenerationMode): boolean {
  return mode === "image-to-image" || mode === "reference-to-video";
}

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
  models: (mode: GenerationMode) =>
    fetch(`/api/models?mode=${encodeURIComponent(mode)}`).then((r) =>
      parseJson<{ mode: string; models: OxenModel[] }>(r),
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
  listGenerations: () =>
    fetch("/api/generations").then((r) =>
      parseJson<{ generations: Generation[] }>(r),
    ),
  getGeneration: (id: string) =>
    fetch(`/api/generations/${id}`).then((r) =>
      parseJson<{ generation: Generation }>(r),
    ),
  cancelGeneration: (id: string) =>
    fetch(`/api/generations/${id}`, { method: "DELETE" }).then((r) => parseJson(r)),
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
