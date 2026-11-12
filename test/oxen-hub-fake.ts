/**
 * An in-memory stand-in for the Oxen repository API, following oxen-server 0.67:
 * - "stage for removal" stages a removal for a file the workspace's base commit holds, unstages a
 *   file that is only staged, and answers 206 with the paths it found neither way;
 * - committing a workspace applies its staged changes to the branch head, then deletes an unnamed
 *   workspace and fast-forwards a named one.
 */

export type FakeWorkspace = {
  named: boolean;
  /** Files of the commit the workspace is pinned to. */
  base: Set<string>;
  /** Files staged as added and not committed. */
  added: Set<string>;
  /** Committed files staged for removal. */
  removed: Set<string>;
};

export type FakeRepo = {
  branches: Map<string, Set<string>>;
  workspaces: Map<string, FakeWorkspace>;
};

export type FakeHubCall = { method: string; path: string; body: unknown };

export type FakeHub = {
  repos: Map<string, FakeRepo>;
  calls: FakeHubCall[];
  commits: Array<{ repo: string; branch: string; workspaceId: string; removed: string[] }>;
  initialCommits: number;
  cancelled: string[];
  fetch: typeof fetch;
};

export function fakeRepo(init: {
  branches?: Record<string, string[]>;
  workspaces?: Record<string, { named?: boolean; base?: string[]; added?: string[] }>;
}): FakeRepo {
  return {
    branches: new Map(
      Object.entries(init.branches ?? {}).map(([name, files]) => [name, new Set(files)]),
    ),
    workspaces: new Map(
      Object.entries(init.workspaces ?? {}).map(([id, workspace]) => [
        id,
        {
          named: workspace.named ?? true,
          base: new Set(workspace.base ?? []),
          added: new Set(workspace.added ?? []),
          removed: new Set<string>(),
        },
      ]),
    ),
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/**
 * `intercept` runs first and may answer a call itself, to simulate an Oxen failure.
 */
export function createFakeHub(
  repos: Record<string, FakeRepo>,
  intercept?: (call: FakeHubCall, hub: FakeHub) => Response | undefined,
): FakeHub {
  const hub: FakeHub = {
    repos: new Map(Object.entries(repos)),
    calls: [],
    commits: [],
    initialCommits: 0,
    cancelled: [],
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.origin !== "https://hub.oxen.ai") throw new Error(`Unexpected host ${url.origin}`);
      const headers = new Headers(init?.headers);
      if (headers.get("Authorization") !== "Bearer test-key") return json(401, { status: "error" });
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      const call: FakeHubCall = { method, path: url.pathname, body };
      hub.calls.push(call);
      const intercepted = intercept?.(call, hub);
      if (intercepted) return intercepted;
      return route(hub, call);
    }) as typeof fetch,
  };
  return hub;
}

function route(hub: FakeHub, call: FakeHubCall): Response {
  const parts = call.path.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "api" && parts[1] === "ai" && parts[2] === "queue" && call.method === "DELETE") {
    hub.cancelled.push(parts[3] ?? "");
    return json(200, { status: "success" });
  }
  if (parts[0] !== "api" || parts[1] !== "repos") return json(404, {});
  const repoKey = `${parts[2]}/${parts[3]}`;
  const repo = hub.repos.get(repoKey);
  if (!repo) return json(404, { status: "error", status_message: "resource_not_found" });
  const rest = parts.slice(4);

  if (rest[0] === "branches" && rest.length === 1 && call.method === "GET") {
    return json(200, {
      status: "success",
      branches: [...repo.branches.keys()].map((name) => ({ name, commit_id: `commit-${name}` })),
    });
  }

  if (rest[0] === "file" && call.method === "DELETE") {
    const branch = repo.branches.get(rest[1] ?? "");
    const path = rest.slice(2).join("/");
    if (!branch || !branch.has(path)) return json(404, { status: "error" });
    branch.delete(path);
    hub.commits.push({ repo: repoKey, branch: rest[1]!, workspaceId: "", removed: [path] });
    return json(200, { status: "success", commit: { id: "c" } });
  }

  if (rest[0] !== "workspaces") return json(404, {});

  if (rest[1] === "get_or_create" && call.method === "PUT") {
    const request = call.body as { branch_name: string; workspace_id: string; name?: string };
    let branch = repo.branches.get(request.branch_name);
    if (!branch) {
      if (repo.branches.size > 0) return json(400, { status: "error" });
      // oxen-server creates the first commit of an empty repository here.
      hub.initialCommits += 1;
      branch = new Set();
      repo.branches.set(request.branch_name, branch);
    }
    if (!repo.workspaces.has(request.workspace_id)) {
      repo.workspaces.set(request.workspace_id, {
        named: Boolean(request.name),
        base: new Set(branch),
        added: new Set(),
        removed: new Set(),
      });
    }
    return json(200, { status: "success", workspace: { id: request.workspace_id } });
  }

  const workspaceId = rest[1] ?? "";
  const workspace = repo.workspaces.get(workspaceId);
  if (!workspace) return json(404, { status: "error", status_message: "workspace_not_found" });

  if (rest.length === 2 && call.method === "DELETE") {
    repo.workspaces.delete(workspaceId);
    return json(200, { status: "success" });
  }

  if (rest[2] === "files" && rest.length === 3 && call.method === "DELETE") {
    const notFound: string[] = [];
    for (const path of call.body as string[]) {
      if (workspace.base.has(path)) workspace.removed.add(path);
      else if (workspace.added.has(path)) workspace.added.delete(path);
      else notFound.push(path);
    }
    return notFound.length === 0
      ? json(200, { status: "success", paths: call.body })
      : json(206, { status: "success", paths: notFound });
  }

  if (rest[2] === "changes" && rest.length === 3 && call.method === "DELETE") {
    for (const path of call.body as string[]) {
      workspace.added.delete(path);
      workspace.removed.delete(path);
    }
    return json(200, { status: "success" });
  }

  if (rest[2] === "merge" && call.method === "POST") {
    const branchName = rest.slice(3).join("/");
    const branch = repo.branches.get(branchName);
    if (!branch) return json(404, { status: "error" });
    const removed = [...workspace.removed].filter((path) => branch.has(path));
    for (const path of workspace.removed) branch.delete(path);
    for (const path of workspace.added) branch.add(path);
    hub.commits.push({ repo: repoKey, branch: branchName, workspaceId, removed });
    if (workspace.named) {
      workspace.base = new Set(branch);
      workspace.added.clear();
      workspace.removed.clear();
    } else {
      repo.workspaces.delete(workspaceId);
    }
    return json(200, { status: "success", commit: { id: `c${hub.commits.length}` } });
  }

  return json(404, {});
}

export function workspaceUrl(path: string, workspaceId = "ws", repo = "digisavvy/playground"): string {
  return `https://hub.oxen.ai/api/repos/${repo}/workspaces/${workspaceId}/files/${path}`;
}
