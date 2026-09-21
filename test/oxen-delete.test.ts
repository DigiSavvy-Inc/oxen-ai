import { afterEach, describe, expect, it } from "vitest";
import {
  deleteOxenGeneration,
  deleteOxenRepoMedia,
  parseOxenRepoMediaUrl,
} from "../worker/oxen-delete";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("parseOxenRepoMediaUrl", () => {
  it("reads workspace result URLs", () => {
    expect(
      parseOxenRepoMediaUrl(
        "https://hub.oxen.ai/api/repos/digisavvy/playground/workspaces/abc/outputs/cow.png",
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
    expect(parseOxenRepoMediaUrl("")).toBeNull();
  });
});

describe("deleteOxenGeneration", () => {
  it("cancels the Oxen job and deletes workspace media", async () => {
    const calls: { url: string; method: string; body: string | null }[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? init.body : null;
      calls.push({ url, method, body });
      return new Response(JSON.stringify({ status: "success" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await deleteOxenGeneration(
      "test-key",
      "gen-1",
      "https://hub.oxen.ai/api/repos/digisavvy/playground/workspaces/abc/file.png",
    );

    expect(calls).toEqual([
      {
        url: "https://hub.oxen.ai/api/ai/queue/gen-1",
        method: "DELETE",
        body: null,
      },
      {
        url: "https://hub.oxen.ai/api/repos/digisavvy/playground/workspaces/abc/files",
        method: "DELETE",
        body: JSON.stringify(["file.png"]),
      },
    ]);
  });

  it("still deletes Oxen media when cancel is a no-op", async () => {
    const urls: string[] = [];
    globalThis.fetch = async (input, init) => {
      urls.push(`${init?.method ?? "GET"} ${String(input)}`);
      if (String(input).includes("/queue/")) {
        return new Response(JSON.stringify({ error: "already finished" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    };

    await deleteOxenGeneration(
      "test-key",
      "gen-2",
      "https://hub.oxen.ai/api/repos/ox/data/file/main/out.webp",
    );
    expect(urls[0]).toBe("DELETE https://hub.oxen.ai/api/ai/queue/gen-2");
    expect(urls[1]).toMatch(/DELETE https:\/\/hub\.oxen\.ai\/api\/repos\/ox\/data\/file\/main\/out\.webp/);
  });

  it("treats a missing Oxen file as deleted", async () => {
    globalThis.fetch = async (input, init) => {
      if (String(input).includes("/queue/")) {
        return new Response("{}", { status: 200 });
      }
      expect(init?.method).toBe("DELETE");
      return new Response("missing", { status: 404 });
    };
    await expect(
      deleteOxenRepoMedia("test-key", {
        kind: "workspace",
        namespace: "digisavvy",
        repo: "playground",
        workspaceId: "abc",
        path: "gone.png",
      }),
    ).resolves.toBe(true);
  });
});
