import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteOxenResultUrls,
  isSingleFilePath,
  parseOxenRepoMediaUrl,
} from "../worker/oxen-delete";
import { createFakeHub, fakeRepo, workspaceUrl, type FakeHub } from "./oxen-hub-fake";

const originalFetch = globalThis.fetch;
const REPO = "digisavvy/playground";

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function install(hub: FakeHub): FakeHub {
  globalThis.fetch = hub.fetch;
  return hub;
}

function counts(report: Awaited<ReturnType<typeof deleteOxenResultUrls>>) {
  return {
    removed: report.removed,
    alreadyGone: report.alreadyGone,
    failed: report.failed,
  };
}

function stepNames(report: Awaited<ReturnType<typeof deleteOxenResultUrls>>): string[] {
  return report.steps.map((entry) => `${entry.step}:${entry.status}`);
}

describe("parseOxenRepoMediaUrl", () => {
  it("strips the files segment from workspace download URLs", () => {
    expect(
      parseOxenRepoMediaUrl(
        "https://hub.oxen.ai/api/repos/digisavvy/playground/workspaces/abc/files/outputs/cow.png",
      ),
    ).toEqual({
      kind: "workspace",
      namespace: "digisavvy",
      repo: "playground",
      workspaceId: "abc",
      path: "outputs/cow.png",
    });
  });

  it("reads workspace result URLs and ignores the signature query", () => {
    expect(
      parseOxenRepoMediaUrl(
        "https://hub.oxen.ai/api/repos/digisavvy/playground/workspaces/abc/outputs/cow.png?sig=1",
      ),
    ).toEqual({
      kind: "workspace",
      namespace: "digisavvy",
      repo: "playground",
      workspaceId: "abc",
      path: "outputs/cow.png",
    });
  });

  it("reads committed file URLs", () => {
    expect(
      parseOxenRepoMediaUrl(
        "https://hub.oxen.ai/api/repos/digisavvy/playground/file/main/renders/ox.png",
      ),
    ).toEqual({
      kind: "file",
      namespace: "digisavvy",
      repo: "playground",
      resource: "main/renders/ox.png",
    });
  });

  it("ignores Studio and malformed URLs", () => {
    expect(parseOxenRepoMediaUrl("https://studio.digisavvy.dev/api/media/u/1/a.png")).toBeNull();
    expect(parseOxenRepoMediaUrl("https://hub.oxen.ai/api/ai/queue/xyz")).toBeNull();
    expect(parseOxenRepoMediaUrl("https://hub.oxen.ai/api/repos/a/b/workspaces/w/files/%E0%A4%A")).toBeNull();
    expect(parseOxenRepoMediaUrl("")).toBeNull();
  });
});

describe("isSingleFilePath", () => {
  it("accepts a file and rejects anything that could name a directory", () => {
    expect(isSingleFilePath("a.png")).toBe(true);
    expect(isSingleFilePath("outputs/2026/clip.mp4")).toBe(true);
    expect(isSingleFilePath("outputs")).toBe(false);
    expect(isSingleFilePath("outputs/")).toBe(false);
    expect(isSingleFilePath("../a.png")).toBe(false);
    expect(isSingleFilePath("/a.png")).toBe(false);
    expect(isSingleFilePath(".png")).toBe(false);
    expect(isSingleFilePath("")).toBe(false);
  });
});

describe("deleteOxenResultUrls", () => {
  it("removes a committed file with one commit and leaves the account's workspace alone", async () => {
    const hub = install(
      createFakeHub({
        [REPO]: fakeRepo({
          branches: { main: ["a.png", "keep.png"] },
          workspaces: { ws: { base: ["a.png", "keep.png"], added: ["draft.png"] } },
        }),
      }),
    );
    const report = await deleteOxenResultUrls("test-key", [workspaceUrl("a.png")]);

    expect(counts(report)).toEqual({ removed: 1, alreadyGone: 0, failed: 0 });
    expect(report.committedRemoved).toBe(1);
    const repo = hub.repos.get(REPO)!;
    expect([...repo.branches.get("main")!]).toEqual(["keep.png"]);
    expect(hub.commits).toHaveLength(1);
    expect(hub.commits[0]!.removed).toEqual(["a.png"]);
    // The account's own workspace is never committed, and nothing is left staged in it.
    expect(hub.commits[0]!.workspaceId).not.toBe("ws");
    expect([...repo.workspaces.keys()]).toEqual(["ws"]);
    expect([...repo.workspaces.get("ws")!.added]).toEqual(["draft.png"]);
    expect(repo.workspaces.get("ws")!.removed.size).toBe(0);
    expect(hub.calls.some((call) => call.path.includes("/workspaces/ws/"))).toBe(false);
  });

  it("removes many committed files with a single commit", async () => {
    const files = ["a.png", "b.png", "c.mp4"];
    const hub = install(
      createFakeHub({
        [REPO]: fakeRepo({ branches: { main: files }, workspaces: { ws: { base: files } } }),
      }),
    );
    const report = await deleteOxenResultUrls("test-key", files.map((file) => workspaceUrl(file)));

    expect(counts(report)).toEqual({ removed: 3, alreadyGone: 0, failed: 0 });
    expect(hub.commits).toHaveLength(1);
    expect(hub.commits[0]!.removed).toEqual(files);
    expect(hub.repos.get(REPO)!.branches.get("main")!.size).toBe(0);
    expect(stepNames(report)).toEqual([
      "branches:200",
      "temp_workspace:200",
      "branch_remove:200",
      "commit:200",
    ]);
  });

  it("removes a file that is only staged in the workspace, without a commit", async () => {
    const hub = install(
      createFakeHub({
        [REPO]: fakeRepo({
          branches: { main: ["other.png"] },
          workspaces: { ws: { base: ["other.png"], added: ["a.png", "keep.png"] } },
        }),
      }),
    );
    const report = await deleteOxenResultUrls("test-key", [workspaceUrl("a.png")]);

    expect(counts(report)).toEqual({ removed: 1, alreadyGone: 0, failed: 0 });
    expect(report.stagedRemoved).toBe(1);
    expect(hub.commits).toHaveLength(0);
    const repo = hub.repos.get(REPO)!;
    expect([...repo.workspaces.get("ws")!.added]).toEqual(["keep.png"]);
    expect([...repo.branches.get("main")!]).toEqual(["other.png"]);
    // The throwaway workspace that looked for the file on the branch is cleaned up.
    expect([...repo.workspaces.keys()]).toEqual(["ws"]);
  });

  it("reports committed, staged, and missing files separately in one pass", async () => {
    const hub = install(
      createFakeHub({
        [REPO]: fakeRepo({
          branches: { main: ["committed.png"] },
          workspaces: { ws: { base: ["committed.png"], added: ["staged.png"] } },
        }),
      }),
    );
    const report = await deleteOxenResultUrls("test-key", [
      workspaceUrl("committed.png"),
      workspaceUrl("staged.png"),
      workspaceUrl("missing.png"),
      workspaceUrl("committed.png"),
    ]);

    expect(counts(report)).toEqual({ removed: 2, alreadyGone: 1, failed: 0 });
    expect(report.committedRemoved).toBe(1);
    expect(report.stagedRemoved).toBe(1);
    expect(hub.commits).toHaveLength(1);
    expect(hub.repos.get(REPO)!.workspaces.get("ws")!.removed.size).toBe(0);
  });

  it("treats a file Oxen no longer has as already gone", async () => {
    install(
      createFakeHub({
        [REPO]: fakeRepo({ branches: { main: ["new.png"] }, workspaces: { current: {} } }),
      }),
    );
    // The repository was deleted and recreated: the old workspace id and file are both gone.
    const report = await deleteOxenResultUrls("test-key", [workspaceUrl("old.png", "old-ws")]);

    expect(counts(report)).toEqual({ removed: 0, alreadyGone: 1, failed: 0 });
    expect(stepNames(report)).toEqual([
      "branches:200",
      "temp_workspace:200",
      "branch_remove:206",
      "temp_workspace_delete:200",
      "workspace_remove:404",
    ]);
  });

  it("treats a missing repository as already gone and stops after one call", async () => {
    const hub = install(createFakeHub({}));
    const report = await deleteOxenResultUrls("test-key", [
      workspaceUrl("a.png"),
      workspaceUrl("b.png"),
    ]);

    expect(counts(report)).toEqual({ removed: 0, alreadyGone: 2, failed: 0 });
    expect(hub.calls).toHaveLength(1);
  });

  it("removes a committed file whose workspace no longer exists", async () => {
    const hub = install(
      createFakeHub({ [REPO]: fakeRepo({ branches: { main: ["a.png"] } }) }),
    );
    const report = await deleteOxenResultUrls("test-key", [workspaceUrl("a.png", "retired-ws")]);

    expect(counts(report)).toEqual({ removed: 1, alreadyGone: 0, failed: 0 });
    expect(hub.repos.get(REPO)!.branches.get("main")!.size).toBe(0);
  });

  it("does not create a first commit in an empty repository", async () => {
    const hub = install(
      createFakeHub({ [REPO]: fakeRepo({ workspaces: { ws: { added: ["a.png"] } } }) }),
    );
    const report = await deleteOxenResultUrls("test-key", [workspaceUrl("a.png")]);

    expect(counts(report)).toEqual({ removed: 1, alreadyGone: 0, failed: 0 });
    expect(hub.initialCommits).toBe(0);
    expect(hub.calls.some((call) => call.path.endsWith("/get_or_create"))).toBe(false);
  });

  it("reports a failed commit as failed, still removes staged files, and drops its workspace", async () => {
    const hub = install(
      createFakeHub(
        {
          [REPO]: fakeRepo({
            branches: { main: ["committed.png"] },
            workspaces: { ws: { base: ["committed.png"], added: ["staged.png"] } },
          }),
        },
        (call) =>
          call.method === "POST" && call.path.includes("/merge/")
            ? new Response("{}", { status: 422 })
            : undefined,
      ),
    );
    const report = await deleteOxenResultUrls("test-key", [
      workspaceUrl("committed.png"),
      workspaceUrl("staged.png"),
      workspaceUrl("missing.png"),
    ]);

    expect(counts(report)).toEqual({ removed: 1, alreadyGone: 1, failed: 1 });
    const repo = hub.repos.get(REPO)!;
    expect([...repo.branches.get("main")!]).toEqual(["committed.png"]);
    expect([...repo.workspaces.keys()]).toEqual(["ws"]);
    expect(stepNames(report)).toContain("commit:422");
    expect(stepNames(report)).toContain("temp_workspace_delete:200");
  });

  it("retries a commit Oxen asks it to retry", async () => {
    let attempts = 0;
    const waits: number[] = [];
    const hub = install(
      createFakeHub(
        { [REPO]: fakeRepo({ branches: { main: ["a.png"] } }) },
        (call) => {
          if (call.method !== "POST" || !call.path.includes("/merge/")) return undefined;
          attempts += 1;
          return attempts === 1
            ? new Response("{}", { status: 429, headers: { "Retry-After": "1" } })
            : undefined;
        },
      ),
    );
    const report = await deleteOxenResultUrls("test-key", [workspaceUrl("a.png")], {
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    expect(counts(report)).toEqual({ removed: 1, alreadyGone: 0, failed: 0 });
    expect(waits).toEqual([1000]);
    expect(hub.commits).toHaveLength(1);
  });

  it("gives up on a commit that keeps being refused", async () => {
    install(
      createFakeHub(
        { [REPO]: fakeRepo({ branches: { main: ["a.png"] } }) },
        (call) =>
          call.method === "POST" && call.path.includes("/merge/")
            ? new Response("{}", { status: 429 })
            : undefined,
      ),
    );
    const report = await deleteOxenResultUrls("test-key", [workspaceUrl("a.png")], {
      sleep: async () => {},
    });

    expect(counts(report)).toEqual({ removed: 0, alreadyGone: 0, failed: 1 });
    expect(stepNames(report).filter((step) => step === "commit:429")).toHaveLength(3);
  });

  it("reports every file as failed when Oxen cannot be reached, and does not throw", async () => {
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    const report = await deleteOxenResultUrls("test-key", [
      workspaceUrl("a.png"),
      workspaceUrl("b.png"),
    ]);

    expect(counts(report)).toEqual({ removed: 0, alreadyGone: 0, failed: 2 });
    expect(report.steps.every((entry) => entry.status === 0)).toBe(true);
  });

  it("does not claim a removal when the branch could not be read", async () => {
    const hub = install(
      createFakeHub(
        {
          [REPO]: fakeRepo({
            branches: { main: ["a.png"] },
            workspaces: { ws: { base: ["a.png"], added: ["staged.png"] } },
          }),
        },
        (call) =>
          call.path.endsWith("/branches") ? new Response("{}", { status: 500 }) : undefined,
      ),
    );
    const report = await deleteOxenResultUrls("test-key", [
      workspaceUrl("a.png"),
      workspaceUrl("staged.png"),
    ]);

    expect(counts(report)).toEqual({ removed: 0, alreadyGone: 0, failed: 2 });
    const repo = hub.repos.get(REPO)!;
    // No removal is staged against a file that may be committed; the staged file is unstaged.
    expect(repo.workspaces.get("ws")!.removed.size).toBe(0);
    expect(repo.workspaces.get("ws")!.added.size).toBe(0);
    expect([...repo.branches.get("main")!]).toEqual(["a.png"]);
  });

  it("reports a rejected key as failed", async () => {
    install(createFakeHub({ [REPO]: fakeRepo({ branches: { main: ["a.png"] } }) }));
    const report = await deleteOxenResultUrls("wrong-key", [workspaceUrl("a.png")]);

    expect(counts(report)).toEqual({ removed: 0, alreadyGone: 0, failed: 1 });
  });

  it("never sends a path that could name a directory", async () => {
    const hub = install(
      createFakeHub({ [REPO]: fakeRepo({ branches: { main: ["outputs/a.png"] } }) }),
    );
    const report = await deleteOxenResultUrls("test-key", [
      workspaceUrl("outputs"),
      "https://hub.oxen.ai/api/repos/digisavvy/playground/file/main/outputs",
      "https://cdn.example.com/a.png",
    ]);

    expect(counts(report)).toEqual({ removed: 0, alreadyGone: 0, failed: 3 });
    expect(hub.calls).toHaveLength(0);
  });

  it("keeps each repository's files in that repository", async () => {
    const hub = install(
      createFakeHub({
        [REPO]: fakeRepo({ branches: { main: ["a.png"] } }),
        "digisavvy/other": fakeRepo({ branches: { main: ["a.png", "b.png"] } }),
      }),
    );
    const report = await deleteOxenResultUrls("test-key", [workspaceUrl("a.png")]);

    expect(counts(report)).toEqual({ removed: 1, alreadyGone: 0, failed: 0 });
    expect(hub.repos.get("digisavvy/other")!.branches.get("main")!.size).toBe(2);
    expect(hub.calls.every((call) => call.path.startsWith("/api/repos/digisavvy/playground/"))).toBe(
      true,
    );
  });

  it("deletes a committed file URL and treats a missing one as already gone", async () => {
    const hub = install(
      createFakeHub({ [REPO]: fakeRepo({ branches: { main: ["renders/ox.png"] } }) }),
    );
    const report = await deleteOxenResultUrls("test-key", [
      "https://hub.oxen.ai/api/repos/digisavvy/playground/file/main/renders/ox.png",
      "https://hub.oxen.ai/api/repos/digisavvy/playground/file/main/renders/gone.png",
    ]);

    expect(counts(report)).toEqual({ removed: 1, alreadyGone: 1, failed: 0 });
    expect(hub.repos.get(REPO)!.branches.get("main")!.size).toBe(0);
  });

  it("sends a large set in chunks and still commits once", async () => {
    const files = Array.from({ length: 1200 }, (_, index) => `out-${index}.png`);
    const hub = install(
      createFakeHub({ [REPO]: fakeRepo({ branches: { main: files } }) }),
    );
    const report = await deleteOxenResultUrls("test-key", files.map((file) => workspaceUrl(file)));

    expect(counts(report)).toEqual({ removed: 1200, alreadyGone: 0, failed: 0 });
    expect(hub.commits).toHaveLength(1);
    expect(stepNames(report).filter((step) => step === "branch_remove:200")).toHaveLength(3);
    expect(hub.calls).toHaveLength(6);
  });

  it("logs statuses and counts without the key, account, workspace, or file names", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    install(
      createFakeHub({
        [REPO]: fakeRepo({
          branches: { main: ["secret-name.png"] },
          workspaces: { "wsid-77": {} },
        }),
      }),
    );
    await deleteOxenResultUrls("test-key", [
      workspaceUrl("secret-name.png", "wsid-77"),
      workspaceUrl("staged-name.png", "wsid-77"),
    ]);

    expect(log).toHaveBeenCalledTimes(1);
    const [label, payload] = log.mock.calls[0]!;
    expect(label).toBe("oxen_delete");
    expect(payload).toMatchObject({
      files: 2,
      removed: 1,
      committedRemoved: 1,
      stagedRemoved: 0,
      alreadyGone: 1,
      failed: 0,
      calls: 6,
      steps:
        "branches:200 temp_workspace:200 branch_remove:206 commit:200 workspace_remove:206 workspace_unstage:200",
    });
    const text = JSON.stringify(log.mock.calls);
    for (const hidden of ["test-key", "digisavvy", "playground", "-name", "wsid-77"]) {
      expect(text).not.toContain(hidden);
    }
  });

  it("makes no call and logs nothing when there is nothing to delete", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const hub = install(createFakeHub({}));
    const report = await deleteOxenResultUrls("test-key", [null, undefined, "  "]);

    expect(counts(report)).toEqual({ removed: 0, alreadyGone: 0, failed: 0 });
    expect(hub.calls).toHaveLength(0);
    expect(log).not.toHaveBeenCalled();
  });
});
