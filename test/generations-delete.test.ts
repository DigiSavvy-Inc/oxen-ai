import { afterEach, describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { SESSION_COOKIE } from "../worker/auth";
import { encryptSecret } from "../worker/crypto";
import { BULK_DELETE_MAX_IDS } from "../worker/library";
import { createEnv, createMockDb, TEST_SECRET, TEST_SESSION_ID, TEST_USER } from "./helpers";
import { createFakeHub, fakeRepo, workspaceUrl } from "./oxen-hub-fake";
import type { UserRow } from "../worker/types";

const originalFetch = globalThis.fetch;
const REPO = "digisavvy/playground";
const ORIGIN = "https://studio.digisavvy.dev";

afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Row = { id: string; user_id: string; status: string; result_url: string | null };

async function userWithOxenKey(): Promise<UserRow> {
  const { ciphertext, iv } = await encryptSecret("test-key", TEST_SECRET);
  return { ...TEST_USER, oxen_key_ciphertext: ciphertext, oxen_key_iv: iv };
}

/** The session and settings lookups of the shared mock, plus a generations table. */
function dbWithGenerations(user: UserRow, rows: Row[]): D1Database {
  const base = createMockDb(user, TEST_SESSION_ID);
  return {
    prepare(sql: string) {
      const fallback = base.prepare(sql);
      return {
        bind(...args: unknown[]) {
          const bound = fallback.bind(...args);
          return {
            async first() {
              if (sql.includes("FROM generations WHERE id = ? AND user_id = ?")) {
                return rows.find((row) => row.id === args[0] && row.user_id === args[1]) ?? null;
              }
              return bound.first();
            },
            async all() {
              if (sql.includes("FROM generations WHERE user_id = ? AND id IN")) {
                const ids = new Set(args.slice(1));
                return {
                  results: rows.filter((row) => row.user_id === args[0] && ids.has(row.id)),
                };
              }
              return bound.all();
            },
            async run() {
              if (sql.includes("DELETE FROM generations WHERE user_id = ? AND id IN")) {
                const ids = new Set(args.slice(1));
                for (let i = rows.length - 1; i >= 0; i--) {
                  if (rows[i]!.user_id === args[0] && ids.has(rows[i]!.id)) rows.splice(i, 1);
                }
              }
              return bound.run();
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function request(path: string, init: RequestInit, env: ReturnType<typeof createEnv>) {
  return app.request(
    `${ORIGIN}${path}`,
    {
      ...init,
      headers: {
        Cookie: `${SESSION_COOKIE}=${TEST_SESSION_ID}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    },
    env,
  );
}

describe("POST /api/generations/delete", () => {
  it("requires a session", async () => {
    const res = await app.request(
      `${ORIGIN}/api/generations/delete`,
      { method: "POST", body: JSON.stringify({ ids: ["gen-1"] }) },
      createEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a missing, empty, or oversized id list", async () => {
    const tooMany = Array.from({ length: BULK_DELETE_MAX_IDS + 1 }, (_, i) => `id-${i}`);
    for (const body of [{}, { ids: [] }, { ids: "gen-1" }, { ids: tooMany }]) {
      const res = await request(
        "/api/generations/delete",
        { method: "POST", body: JSON.stringify(body) },
        createEnv(),
      );
      expect(res.status).toBe(400);
    }
  });

  it("deletes the caller's rows, removes their Oxen copies together, and counts the rest as missing", async () => {
    const hub = createFakeHub({
      [REPO]: fakeRepo({
        branches: { main: ["a.png", "b.png", "theirs.png"] },
        workspaces: { ws: { base: ["a.png", "b.png", "theirs.png"] } },
      }),
    });
    globalThis.fetch = hub.fetch;
    const user = await userWithOxenKey();
    const rows: Row[] = [
      { id: "gen-1", user_id: user.id, status: "succeeded", result_url: workspaceUrl("a.png") },
      { id: "gen-2", user_id: user.id, status: "succeeded", result_url: workspaceUrl("b.png") },
      { id: "gen-3", user_id: user.id, status: "succeeded", result_url: workspaceUrl("old.png", "old-ws") },
      { id: "theirs", user_id: "user-2", status: "succeeded", result_url: workspaceUrl("theirs.png") },
    ];
    const env = createEnv({ DB: dbWithGenerations(user, rows) });
    const res = await request(
      "/api/generations/delete",
      {
        method: "POST",
        body: JSON.stringify({ ids: ["gen-1", "gen-2", "gen-3", "theirs", "nope"], fromOxen: true }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      deleted: 3,
      missing: 2,
      oxenDeleted: 2,
      oxenAlreadyGone: 1,
      oxenFailed: 0,
    });
    expect(hub.commits).toHaveLength(1);
    // Another user's row and its Oxen file are untouched.
    expect(rows.map((row) => row.id)).toEqual(["theirs"]);
    expect([...hub.repos.get(REPO)!.branches.get("main")!]).toEqual(["theirs.png"]);
  });

  it("keeps Oxen untouched unless asked", async () => {
    const hub = createFakeHub({ [REPO]: fakeRepo({ branches: { main: ["a.png"] } }) });
    globalThis.fetch = hub.fetch;
    const user = await userWithOxenKey();
    const rows: Row[] = [
      { id: "gen-1", user_id: user.id, status: "succeeded", result_url: workspaceUrl("a.png") },
    ];
    const res = await request(
      "/api/generations/delete",
      { method: "POST", body: JSON.stringify({ ids: ["gen-1"] }) },
      createEnv({ DB: dbWithGenerations(user, rows) }),
    );

    expect(await res.json()).toEqual({
      ok: true,
      deleted: 1,
      missing: 0,
      oxenDeleted: 0,
      oxenAlreadyGone: 0,
      oxenFailed: 0,
    });
    expect(hub.calls).toHaveLength(0);
    expect(rows).toHaveLength(0);
  });
});

describe("DELETE /api/generations/:id", () => {
  it("reports an Oxen copy that was already gone, and still deletes the Studio row", async () => {
    globalThis.fetch = createFakeHub({}).fetch;
    const user = await userWithOxenKey();
    const rows: Row[] = [
      { id: "gen-1", user_id: user.id, status: "succeeded", result_url: workspaceUrl("old.png") },
    ];
    const res = await request(
      "/api/generations/gen-1?fromOxen=1",
      { method: "DELETE" },
      createEnv({ DB: dbWithGenerations(user, rows) }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      oxenDeleted: 0,
      oxenAlreadyGone: 1,
      oxenFailed: 0,
    });
    expect(rows).toHaveLength(0);
  });

  it("deletes the Studio row and says so when Oxen could not remove its copy", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 503 })) as typeof fetch;
    const user = await userWithOxenKey();
    const rows: Row[] = [
      { id: "gen-1", user_id: user.id, status: "succeeded", result_url: workspaceUrl("a.png") },
    ];
    const res = await request(
      "/api/generations/gen-1?fromOxen=1",
      { method: "DELETE" },
      createEnv({ DB: dbWithGenerations(user, rows) }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      oxenDeleted: 0,
      oxenAlreadyGone: 0,
      oxenFailed: 1,
    });
    expect(rows).toHaveLength(0);
  });
});
