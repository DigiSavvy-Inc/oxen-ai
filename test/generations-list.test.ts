import { afterEach, describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { SESSION_COOKIE } from "../worker/auth";
import { encryptSecret } from "../worker/crypto";
import { createEnv, TEST_SECRET, TEST_SESSION_ID, TEST_USER } from "./helpers";
import type { UserRow } from "../worker/types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function cookieHeader() {
  return `${SESSION_COOKIE}=${TEST_SESSION_ID}`;
}

function captureSql(env: ReturnType<typeof createEnv>) {
  const sql: string[] = [];
  const original = env.DB.prepare.bind(env.DB);
  env.DB.prepare = ((query: string) => {
    sql.push(query);
    return original(query);
  }) as D1Database["prepare"];
  return sql;
}

describe("GET /api/generations", () => {
  it("rejects unknown scopes", async () => {
    const res = await app.request(
      "https://studio.digisavvy.dev/api/generations?scope=all",
      { headers: { Cookie: cookieHeader() } },
      createEnv(),
    );
    expect(res.status).toBe(400);
  });

  it("queries in-flight jobs for scope=active", async () => {
    const env = createEnv();
    const sql = captureSql(env);
    const res = await app.request(
      "https://studio.digisavvy.dev/api/generations?scope=active",
      { headers: { Cookie: cookieHeader() } },
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ generations: [] });
    expect(sql.some((query) => query.includes("status NOT IN"))).toBe(true);
  });

  it("queries the archive for scope=library", async () => {
    const env = createEnv();
    const sql = captureSql(env);
    const res = await app.request(
      "https://studio.digisavvy.dev/api/generations?scope=library",
      { headers: { Cookie: cookieHeader() } },
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ generations: [] });
    const listQuery = sql.find((query) => query.includes("FROM generations WHERE user_id"));
    expect(listQuery).toContain("LIMIT 100");
    expect(listQuery).not.toContain("status NOT IN");
  });

  it("returns the library while a missing result is still downloading", async () => {
    const { ciphertext, iv } = await encryptSecret("oxen-test-key", TEST_SECRET);
    const user: UserRow = {
      ...TEST_USER,
      oxen_key_ciphertext: ciphertext,
      oxen_key_iv: iv,
    };
    const resultUrl = "https://cdn.example/result.png";
    let releaseDownload: () => void = () => {};
    const downloadGate = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });
    let downloads = 0;
    let downloadFinished = false;
    globalThis.fetch = async () => {
      downloads += 1;
      await downloadGate;
      downloadFinished = true;
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { "content-type": "image/png" },
      });
    };
    const row = {
      id: "gen-1",
      user_id: user.id,
      oxen_generation_id: "oxen-1",
      mode: "text-to-image",
      model: "flux",
      prompt: "a red ox",
      status: "succeeded",
      media_type: "image",
      result_url: resultUrl,
      result_key: null,
      thumb_key: null,
      last_frame_key: null,
      params_json: null,
      error_message: null,
      batch_id: "batch-1",
      created_at: 1_700_000_100,
      updated_at: 1_700_000_100,
    };
    const env = createEnv({
      DB: {
        prepare(sql: string) {
          return {
            bind(...args: unknown[]) {
              return {
                async first() {
                  if (sql.includes("FROM sessions") && args[0] === TEST_SESSION_ID) return user;
                  return null;
                },
                async all() {
                  if (sql.includes("FROM generations") && args[0] === user.id) {
                    return { results: [row] };
                  }
                  return { results: [] };
                },
                async run() {
                  return { success: true };
                },
              };
            },
          };
        },
      } as unknown as D1Database,
    });

    try {
      const pending = app.request(
        "https://studio.digisavvy.dev/api/generations?scope=library",
        { headers: { Cookie: cookieHeader() } },
        env,
      );
      const res = await Promise.race([
        pending,
        new Promise<Response>((_, reject) => {
          setTimeout(() => reject(new Error("library list hung")), 3000);
        }),
      ]);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        generations: Array<{ id: string; resultUrl: string | null; status: string }>;
      };
      expect(body.generations).toEqual([
        expect.objectContaining({
          id: "gen-1",
          status: "succeeded",
          resultUrl,
        }),
      ]);
      expect(downloadFinished).toBe(false);
      expect(downloads).toBeLessThanOrEqual(1);
    } finally {
      releaseDownload();
    }
  });
});
