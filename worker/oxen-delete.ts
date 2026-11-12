const OXEN_HUB = "https://hub.oxen.ai";

/** Paths per Oxen call, so one request body and one server pass stay small. */
const PATH_CHUNK = 500;
const CALL_TIMEOUT_MS = 45_000;
const COMMIT_ATTEMPTS = 3;
const MAX_RETRY_WAIT_MS = 2_000;
const MAX_LOGGED_STEPS = 40;

const COMMIT_AUTHOR = "Oxen Studio";
const COMMIT_EMAIL = "studio@digisavvy.dev";

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

/** One Oxen call: which step it was and the HTTP status. Status 0 means no response. */
export type OxenDeleteStep = { step: string; status: number };

export type OxenDeleteReport = {
  /** Files Oxen confirmed it removed: `committedRemoved + stagedRemoved`. */
  removed: number;
  /** Files Oxen confirmed it does not hold. */
  alreadyGone: number;
  /** Files that may still be on Oxen. */
  failed: number;
  /** Removed from the branch by a commit. */
  committedRemoved: number;
  /** Removed from a workspace's uncommitted files. */
  stagedRemoved: number;
  steps: OxenDeleteStep[];
};

export type OxenDeleteOptions = {
  /** Injected in tests so a retry does not wait. */
  sleep?: (ms: number) => Promise<void>;
};

type FileRef = Extract<OxenRepoMediaRef, { kind: "file" }>;
type FileOutcome = "committed" | "staged" | "gone" | "failed";

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
  let decoded: string[];
  try {
    decoded = parts.map((part) => decodeURIComponent(part));
  } catch {
    return null;
  }
  const namespace = decoded[2] ?? "";
  const repo = decoded[3] ?? "";
  if (!namespace || !repo) return null;
  if (decoded[4] === "workspaces" && decoded.length >= 7) {
    const rest = decoded.slice(6);
    // Download URLs are .../workspaces/{id}/files/{path}. `files` is the API segment.
    const pathParts = rest[0] === "files" ? rest.slice(1) : rest;
    const path = pathParts.join("/");
    if (!path) return null;
    return { kind: "workspace", namespace, repo, workspaceId: decoded[5] ?? "", path };
  }
  if (decoded[4] === "file" && decoded.length >= 6) {
    const resource = decoded.slice(5).join("/");
    if (!resource) return null;
    return { kind: "file", namespace, repo, resource };
  }
  return null;
}

/**
 * Oxen's remove calls take a directory as readily as a file and then remove everything under it.
 * Only a path that names one file with an extension is ever sent.
 */
export function isSingleFilePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.endsWith("/") || path.includes("\\")) return false;
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return false;
  return /[^.]\.[A-Za-z0-9]{1,8}$/.test(segments[segments.length - 1] ?? "");
}

function encodeRepoPath(namespace: string, repo: string, ...rest: string[]): string {
  const segments = [namespace, repo, ...rest].map((part) =>
    part.split("/").map(encodeURIComponent).join("/"),
  );
  return `/api/repos/${segments.join("/")}`;
}

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function normalizeReturnedPath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  return path.replace(/\\/g, "/").replace(/^(\.\/|\/)+/, "");
}

type HubResult = { status: number; retryAfter: string | null; json: () => Promise<unknown> };

class HubSession {
  readonly steps: OxenDeleteStep[] = [];

  constructor(private readonly apiKey: string) {}

  async call(step: string, path: string, init: RequestInit = {}): Promise<HubResult> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.apiKey}`);
    if (typeof init.body === "string") headers.set("Content-Type", "application/json");
    let res: Response | null = null;
    try {
      res = await fetch(`${OXEN_HUB}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch {
      res = null;
    }
    this.steps.push({ step, status: res?.status ?? 0 });
    const response = res;
    return {
      status: response?.status ?? 0,
      retryAfter: response?.headers.get("Retry-After") ?? null,
      json: async () => {
        if (!response) return null;
        try {
          return await response.json();
        } catch {
          return null;
        }
      },
    };
  }
}

type BranchLookup =
  | { kind: "branch"; name: string }
  /** The repository has no commits, so nothing is committed. */
  | { kind: "empty" }
  | { kind: "repo_missing" }
  | { kind: "unknown" };

async function findOutputBranch(hub: HubSession, namespace: string, repo: string): Promise<BranchLookup> {
  const res = await hub.call("branches", encodeRepoPath(namespace, repo, "branches"));
  if (res.status === 404) return { kind: "repo_missing" };
  if (res.status !== 200) return { kind: "unknown" };
  const body = (await res.json()) as { branches?: Array<{ name?: unknown }> } | null;
  if (!body || !Array.isArray(body.branches)) return { kind: "unknown" };
  const names = body.branches
    .map((branch) => branch?.name)
    .filter((name): name is string => typeof name === "string" && name.length > 0);
  if (names.length === 0) return { kind: "empty" };
  if (names.includes("main")) return { kind: "branch", name: "main" };
  if (names.length === 1) return { kind: "branch", name: names[0]! };
  return { kind: "unknown" };
}

/**
 * Splits `paths` by what a "stage for removal" call said about them. Oxen answers 200 when it
 * found every path and 206 with the paths it did not find.
 */
async function stageRemoval(
  hub: HubSession,
  step: string,
  ref: { namespace: string; repo: string },
  workspaceId: string,
  paths: string[],
): Promise<{ status: number; found: string[]; notFound: string[]; unknown: string[] }> {
  const res = await hub.call(
    step,
    encodeRepoPath(ref.namespace, ref.repo, "workspaces", workspaceId, "files"),
    { method: "DELETE", body: JSON.stringify(paths) },
  );
  if (res.status === 200 || res.status === 204) {
    return { status: res.status, found: paths, notFound: [], unknown: [] };
  }
  if (res.status === 206) {
    const body = (await res.json()) as { paths?: unknown } | null;
    const returned = Array.isArray(body?.paths) ? body.paths.map(normalizeReturnedPath) : null;
    const requested = new Set(paths);
    if (!returned || returned.some((path) => path === null || !requested.has(path))) {
      return { status: res.status, found: [], notFound: [], unknown: paths };
    }
    const missing = new Set(returned as string[]);
    return {
      status: res.status,
      found: paths.filter((path) => !missing.has(path)),
      notFound: paths.filter((path) => missing.has(path)),
      unknown: [],
    };
  }
  return { status: res.status, found: [], notFound: [], unknown: paths };
}

function retryWaitMs(retryAfter: string | null): number {
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) return 500;
  return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);
}

type RepoGroup = {
  namespace: string;
  repo: string;
  /** path → the workspace ids its URLs named. */
  paths: Map<string, Set<string>>;
};

/**
 * Removes generated files from one repository, whichever way Oxen is holding them.
 *
 * A file committed to the branch is removed by a commit: a throwaway workspace Studio creates on
 * the branch head stages the removals and is committed once, so many files cost one commit. The
 * workspace a result URL names is never committed, because it can hold the account's other
 * uncommitted work.
 *
 * A file that is only staged in the URL's workspace is removed from that workspace. The staged
 * removal call is the one that says whether the file was there; the unstage after it clears
 * anything that call left staged, so the account's next commit of that workspace is not affected.
 */
async function deleteRepoFiles(
  hub: HubSession,
  group: RepoGroup,
  outcomes: Map<string, FileOutcome>,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const allPaths = [...group.paths.keys()];
  const mark = (paths: string[], outcome: FileOutcome) => {
    for (const path of paths) outcomes.set(path, outcome);
  };

  const branch = await findOutputBranch(hub, group.namespace, group.repo);
  if (branch.kind === "repo_missing") {
    mark(allPaths, "gone");
    return;
  }

  /** Paths the branch does not hold, still to be looked for in a workspace. */
  let offBranch: string[] = [];
  /** Paths whose place on the branch could not be read, so "not in the workspace" proves nothing. */
  const unchecked = new Set<string>();

  switch (branch.kind) {
    case "empty":
      offBranch = allPaths;
      break;
    case "unknown":
      offBranch = allPaths;
      for (const path of allPaths) unchecked.add(path);
      break;
    case "branch": {
      const tempId = crypto.randomUUID();
      const created = await hub.call(
        "temp_workspace",
        encodeRepoPath(group.namespace, group.repo, "workspaces", "get_or_create"),
        {
          method: "PUT",
          body: JSON.stringify({ branch_name: branch.name, workspace_id: tempId }),
        },
      );
      if (created.status !== 200 && created.status !== 201) {
        offBranch = allPaths;
        for (const path of allPaths) unchecked.add(path);
        break;
      }
      const staged: string[] = [];
      for (const chunk of chunked(allPaths, PATH_CHUNK)) {
        const result = await stageRemoval(hub, "branch_remove", group, tempId, chunk);
        staged.push(...result.found);
        offBranch.push(...result.notFound, ...result.unknown);
        for (const path of result.unknown) unchecked.add(path);
      }
      let committed = false;
      if (staged.length > 0) {
        const message = `Oxen Studio: remove ${staged.length} generated file${staged.length === 1 ? "" : "s"}`;
        for (let attempt = 1; attempt <= COMMIT_ATTEMPTS && !committed; attempt++) {
          const res = await hub.call(
            "commit",
            encodeRepoPath(group.namespace, group.repo, "workspaces", tempId, "merge", branch.name),
            {
              method: "POST",
              body: JSON.stringify({ message, author: COMMIT_AUTHOR, email: COMMIT_EMAIL }),
            },
          );
          if (res.status === 200 || res.status === 201) {
            committed = true;
          } else if (res.status === 429 && attempt < COMMIT_ATTEMPTS) {
            await sleep(retryWaitMs(res.retryAfter));
          } else {
            break;
          }
        }
        mark(staged, committed ? "committed" : "failed");
      }
      if (!committed) {
        // Oxen deletes an unnamed workspace when it commits. One that never committed is dropped
        // here so it does not pile up in the account.
        await hub.call(
          "temp_workspace_delete",
          encodeRepoPath(group.namespace, group.repo, "workspaces", tempId),
          { method: "DELETE" },
        );
      }
      break;
    }
    default: {
      const _never: never = branch;
      throw new Error(`Unhandled branch lookup: ${JSON.stringify(_never)}`);
    }
  }

  const byWorkspace = new Map<string, string[]>();
  for (const path of offBranch) {
    for (const workspaceId of group.paths.get(path) ?? []) {
      const list = byWorkspace.get(workspaceId);
      if (list) list.push(path);
      else byWorkspace.set(workspaceId, [path]);
    }
  }
  const settle = (path: string, outcome: FileOutcome) => {
    // A path named by two workspaces keeps the strongest answer: removed, then failed, then gone.
    const current = outcomes.get(path);
    if (current === "staged" || current === "committed") return;
    if (current === "failed" && outcome === "gone") return;
    outcomes.set(path, outcome);
  };
  const unstage = (workspaceId: string, paths: string[]) =>
    hub.call(
      "workspace_unstage",
      encodeRepoPath(group.namespace, group.repo, "workspaces", workspaceId, "changes"),
      { method: "DELETE", body: JSON.stringify(paths) },
    );
  for (const [workspaceId, paths] of byWorkspace) {
    // Without a branch reading, "found in the workspace" could be a committed file that would
    // stay on the branch. Those paths are only unstaged, and reported as not confirmed.
    const blind = paths.filter((path) => unchecked.has(path));
    for (const chunk of chunked(blind, PATH_CHUNK)) {
      await unstage(workspaceId, chunk);
      for (const path of chunk) settle(path, "failed");
    }
    const checked = paths.filter((path) => !unchecked.has(path));
    for (const chunk of chunked(checked, PATH_CHUNK)) {
      const result = await stageRemoval(hub, "workspace_remove", group, workspaceId, chunk);
      if (result.status === 404) {
        for (const path of chunk) settle(path, "gone");
        continue;
      }
      for (const path of result.found) settle(path, "staged");
      for (const path of result.notFound) settle(path, "gone");
      for (const path of result.unknown) settle(path, "failed");
      await unstage(workspaceId, chunk);
    }
  }
}

async function deleteCommittedFileUrl(hub: HubSession, ref: FileRef): Promise<FileOutcome> {
  const form = new FormData();
  form.append("message", "Oxen Studio: remove 1 generated file");
  form.append("name", COMMIT_AUTHOR);
  form.append("email", COMMIT_EMAIL);
  const res = await hub.call(
    "file_delete",
    encodeRepoPath(ref.namespace, ref.repo, "file", ref.resource),
    { method: "DELETE", body: form },
  );
  if (res.status === 200 || res.status === 204) return "committed";
  if (res.status === 404 || res.status === 410) return "gone";
  return "failed";
}

/**
 * Removes the Oxen copies behind a set of stored result URLs and says what happened to each.
 * A file or repository Oxen no longer has counts as already gone, not as a failure. Never throws.
 */
export async function deleteOxenResultUrls(
  apiKey: string,
  resultUrls: Array<string | null | undefined>,
  options: OxenDeleteOptions = {},
): Promise<OxenDeleteReport> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const hub = new HubSession(apiKey);
  let unusable = 0;
  const groups = new Map<string, RepoGroup>();
  const fileRefs = new Map<string, FileRef>();
  for (const url of new Set(resultUrls.map((value) => value?.trim() ?? ""))) {
    if (!url) continue;
    const ref = parseOxenRepoMediaUrl(url);
    if (!ref) {
      unusable += 1;
      continue;
    }
    switch (ref.kind) {
      case "workspace": {
        if (!ref.workspaceId || !isSingleFilePath(ref.path)) {
          unusable += 1;
          break;
        }
        const key = `${ref.namespace}/${ref.repo}`;
        let group = groups.get(key);
        if (!group) {
          group = { namespace: ref.namespace, repo: ref.repo, paths: new Map() };
          groups.set(key, group);
        }
        const workspaces = group.paths.get(ref.path);
        if (workspaces) workspaces.add(ref.workspaceId);
        else group.paths.set(ref.path, new Set([ref.workspaceId]));
        break;
      }
      case "file": {
        const [, ...filePath] = ref.resource.split("/");
        if (!isSingleFilePath(filePath.join("/"))) {
          unusable += 1;
          break;
        }
        fileRefs.set(`${ref.namespace}/${ref.repo}/${ref.resource}`, ref);
        break;
      }
      default: {
        const _never: never = ref;
        throw new Error(`Unhandled Oxen media ref: ${JSON.stringify(_never)}`);
      }
    }
  }

  const tally = { committed: 0, staged: 0, gone: 0, failed: unusable };
  for (const group of groups.values()) {
    const outcomes = new Map<string, FileOutcome>();
    try {
      await deleteRepoFiles(hub, group, outcomes, sleep);
    } catch {
      /* counted below: every path without an outcome failed */
    }
    for (const path of group.paths.keys()) tally[outcomes.get(path) ?? "failed"] += 1;
  }
  for (const ref of fileRefs.values()) {
    let outcome: FileOutcome = "failed";
    try {
      outcome = await deleteCommittedFileUrl(hub, ref);
    } catch {
      outcome = "failed";
    }
    tally[outcome] += 1;
  }

  const report: OxenDeleteReport = {
    removed: tally.committed + tally.staged,
    alreadyGone: tally.gone,
    failed: tally.failed,
    committedRemoved: tally.committed,
    stagedRemoved: tally.staged,
    steps: hub.steps,
  };
  if (report.removed + report.alreadyGone + report.failed > 0) {
    // Statuses and counts only: no key, account, workspace, or file name.
    console.log("oxen_delete", {
      files: report.removed + report.alreadyGone + report.failed,
      removed: report.removed,
      committedRemoved: report.committedRemoved,
      stagedRemoved: report.stagedRemoved,
      alreadyGone: report.alreadyGone,
      failed: report.failed,
      calls: hub.steps.length,
      steps: hub.steps
        .slice(0, MAX_LOGGED_STEPS)
        .map((entry) => `${entry.step}:${entry.status}`)
        .join(" "),
    });
  }
  return report;
}
