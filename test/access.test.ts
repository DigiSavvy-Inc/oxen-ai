import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isAdminUser, userHasAccess } from "../worker/auth";
import { createEnv } from "./helpers";

// Real SQLite + the real migrations, so the allowlist SQL is exercised as D1 runs it.
function sqliteD1(): { db: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  for (const file of ["0001_init.sql", "0011_allowlist_github_id.sql"]) {
    raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: (string | number | null)[]) {
          const stmt = raw.prepare(sql);
          return {
            async first() {
              return stmt.get(...args) ?? null;
            },
            async run() {
              stmt.run(...args);
              return { success: true };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
  return { db, raw };
}

const originalFetch = globalThis.fetch;
let orgMember = false;

beforeEach(() => {
  orgMember = false;
  globalThis.fetch = (async () =>
    orgMember
      ? new Response(JSON.stringify({ state: "active" }), { status: 200 })
      : new Response("{}", { status: 404 })) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function allow(raw: DatabaseSync, login: string, githubId: number | null = null) {
  raw
    .prepare(`INSERT INTO allowlist (github_login, github_id, added_by, created_at) VALUES (?, ?, 'admin', 0)`)
    .run(login, githubId);
}

describe("isAdminUser", () => {
  it("matches a numeric GITHUB_ADMINS entry on account id, not login", () => {
    const env = createEnv({ GITHUB_ADMINS: "4242" });
    expect(isAdminUser({ githubId: 4242, login: "renamed" }, env)).toBe(true);
    expect(isAdminUser({ githubId: 1, login: "4242" }, env)).toBe(false);
  });

  it("still honors login entries for self-hosters", () => {
    const env = createEnv({ GITHUB_ADMINS: "Tester" });
    expect(isAdminUser({ githubId: 1, login: "tester" }, env)).toBe(true);
  });
});

describe("userHasAccess allowlist", () => {
  const env = createEnv({ GITHUB_ADMINS: "", GITHUB_ORG: "" });

  it("binds a legacy login-only row to the account id on first sign-in", async () => {
    const { db, raw } = sqliteD1();
    allow(raw, "bob");
    expect((await userHasAccess(db, { id: 7, login: "Bob" }, "t", env)).allowed).toBe(true);
    expect(raw.prepare(`SELECT github_id FROM allowlist WHERE github_login = 'bob'`).get()).toEqual({
      github_id: 7,
    });
  });

  // The attack: bob renames, someone else registers "bob" and signs in.
  it("rejects a different account that later claims an allowlisted login", async () => {
    const { db, raw } = sqliteD1();
    allow(raw, "bob", 7);
    expect((await userHasAccess(db, { id: 999, login: "bob" }, "t", env)).allowed).toBe(false);
  });

  it("keeps access for the original account after it renames", async () => {
    const { db, raw } = sqliteD1();
    allow(raw, "bob", 7);
    expect((await userHasAccess(db, { id: 7, login: "robert" }, "t", env)).allowed).toBe(true);
    expect(raw.prepare(`SELECT github_login FROM allowlist WHERE github_id = 7`).get()).toEqual({
      github_login: "robert",
    });
  });

  it("falls through to org membership when not allowlisted", async () => {
    const { db } = sqliteD1();
    const orgEnv = createEnv({ GITHUB_ADMINS: "", GITHUB_ORG: "DigiSavvy-Inc" });
    expect((await userHasAccess(db, { id: 5, login: "eve" }, "t", orgEnv)).allowed).toBe(false);
    orgMember = true;
    expect((await userHasAccess(db, { id: 5, login: "eve" }, "t", orgEnv)).allowed).toBe(true);
  });
});
