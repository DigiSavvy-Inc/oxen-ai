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
    const path = parts.slice(6).map(decodeURIComponent).join("/");
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
    case "workspace": {
      const res = await hubFetch(
        encodeRepoPath(ref.namespace, ref.repo, "workspaces", ref.workspaceId, "files"),
        apiKey,
        { method: "DELETE", body: JSON.stringify([ref.path]) },
      );
      return res.ok || res.status === 404 || res.status === 410;
    }
    case "file": {
      const form = new FormData();
      form.append("message", "Delete DS Studio generation");
      form.append("name", "DS Studio");
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
  if (!ref) return;
  const deleted = await deleteOxenRepoMedia(apiKey, ref);
  if (!deleted) {
    throw new Error("Oxen media delete failed");
  }
}
