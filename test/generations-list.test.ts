import { describe, expect, it } from "vitest";
import app from "../worker/index";
import { SESSION_COOKIE } from "../worker/auth";
import { createEnv, TEST_SESSION_ID } from "./helpers";

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
});
