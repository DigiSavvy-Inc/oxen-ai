import { cancelGeneration } from "./oxen";

const OXEN_HUB = "https://hub.oxen.ai";

export type OxenRepoMediaRef =
  | {
      kind: "workspace";
      namespace: string;
      repo: string;
      workspaceId: string;
      path: string;
    }
  | {
      kind: "file";
      namespace: string;
      repo: string;
      resource: string;
    };

export function parseOxenRepoMediaUrl(value: string | null | undefined): OxenRepoMediaRef | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "hub.oxen.ai") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "repos" || parts.length < 6) return null;
  const namespace = decodeURIComponent(parts[2] ?? "");
  const repo = decodeURIComponent(parts[3] ?? "");
  if (!namespace || !repo) return null;
  if (parts[4] === "workspaces" && parts.length >= 7) {
    const rest = parts.slice(6).map((part) => decodeURIComponent(part));
    // Download URLs are .../workspaces/{id}/files/{path}. `files` is the API segment.
    const pathParts = rest[0] === "files" ? rest.slice(1) : rest;
    const path = pathParts.join("/");
    if (!path) return null;
    return {
      kind: "workspace",
      namespace,
      repo,
      workspaceId: decodeURIComponent(parts[5] ?? ""),
      path,
    };
  }
  if (parts[4] === "file" && parts.length >= 6) {
    const resource = parts.slice(5).map(decodeURIComponent).join("/");
    if (!resource) return null;
    return { kind: "file", namespace, repo, resource };
  }
  return null;
}

async function hubFetch(path: string, apiKey: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${OXEN_HUB}${path}`, { ...init, headers });
}

function encodeRepoPath(namespace: string, repo: string, ...rest: string[]): string {
  const segments = [namespace, repo, ...rest].map((part) =>
    part.split("/").map(encodeURIComponent).join("/"),
  );
  return `/api/repos/${segments.join("/")}`;
}

export async function deleteOxenRepoMedia(
  apiKey: string,
  ref: OxenRepoMediaRef,
): Promise<boolean> {
  switch (ref.kind) {
    case "workspace":
      return deleteWorkspacePaths(apiKey, ref, [ref.path]);
    case "file": {
      const form = new FormData();
      form.append("message", "Delete Oxen Studio generation");
      form.append("name", "Oxen Studio");
      form.append("email", "studio@digisavvy.dev");
      const res = await hubFetch(encodeRepoPath(ref.namespace, ref.repo, "file", ref.resource), apiKey, {
        method: "DELETE",
        body: form,
      });
      return res.ok || res.status === 404 || res.status === 410;
    }
    default: {
      const _never: never = ref;
      throw new Error(`Unhandled Oxen media ref: ${JSON.stringify(_never)}`);
    }
  }
}

function workspaceDeleteOk(status: number): boolean {
  return status === 200 || status === 204 || status === 206 || status === 404 || status === 410;
}

async function deleteWorkspacePaths(
  apiKey: string,
  ref: Extract<OxenRepoMediaRef, { kind: "workspace" }>,
  paths: string[],
): Promise<boolean> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return true;
  const body = JSON.stringify(unique);
  // Staged outputs leave the workspace when unstaged. Committed files are only
  // staged for removal here; Oxen keeps them on the branch until that workspace is merged.
  const unstaged = await hubFetch(
    encodeRepoPath(ref.namespace, ref.repo, "workspaces", ref.workspaceId, "changes"),
    apiKey,
    { method: "DELETE", body },
  );
  const removed = await hubFetch(
    encodeRepoPath(ref.namespace, ref.repo, "workspaces", ref.workspaceId, "files"),
    apiKey,
    { method: "DELETE", body },
  );
  return workspaceDeleteOk(unstaged.status) && workspaceDeleteOk(removed.status);
}

export async function deleteOxenResultUrls(
  apiKey: string,
  resultUrls: Array<string | null | undefined>,
): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  const workspaceGroups = new Map<
    string,
    { ref: Extract<OxenRepoMediaRef, { kind: "workspace" }>; paths: string[] }
  >();
  const files: Extract<OxenRepoMediaRef, { kind: "file" }>[] = [];
  for (const url of resultUrls) {
    if (!url?.trim()) continue;
    const ref = parseOxenRepoMediaUrl(url);
    if (!ref) {
      failed += 1;
      continue;
    }
    if (ref.kind === "workspace") {
      const key = `${ref.namespace}/${ref.repo}/${ref.workspaceId}`;
      const group = workspaceGroups.get(key);
      if (group) group.paths.push(ref.path);
      else workspaceGroups.set(key, { ref, paths: [ref.path] });
    } else {
      files.push(ref);
    }
  }
  for (const group of workspaceGroups.values()) {
    const paths = [...new Set(group.paths)];
    const ok = await deleteWorkspacePaths(apiKey, group.ref, paths);
    if (ok) deleted += paths.length;
    else failed += paths.length;
  }
  for (const ref of files) {
    const ok = await deleteOxenRepoMedia(apiKey, ref);
    if (ok) deleted += 1;
    else failed += 1;
  }
  return { deleted, failed };
}

export async function deleteOxenGeneration(
  apiKey: string,
  generationId: string,
  resultUrl?: string | null,
): Promise<void> {
  try {
    await cancelGeneration(apiKey, generationId);
  } catch {
    /* Cancel only applies to queued/processing jobs. */
  }
  const ref = parseOxenRepoMediaUrl(resultUrl);
  if (!ref) {
    if (resultUrl?.trim()) throw new Error("Oxen media delete failed");
    return;
  }
  const deleted = await deleteOxenRepoMedia(apiKey, ref);
  if (!deleted) {
    throw new Error("Oxen media delete failed");
  }
}
