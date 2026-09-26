import { describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { SESSION_COOKIE } from "../worker/auth";
import {
  acceptSavedPromptBody,
  acceptSavedPromptName,
  deleteSavedPrompt,
  listSavedPrompts,
  saveSavedPrompt,
  updateSavedPrompt,
  SAVED_PROMPT_MAX_CHARS,
} from "../worker/saved-prompts";
import { createEnv, TEST_SESSION_ID, TEST_USER } from "./helpers";

type Row = { id: string; user_id: string; name: string; body: string; created_at: number };

function promptsDb(seed: Row[] = []) {
  const rows = [...seed];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async all() {
              const userId = String(args[0]);
              const matched = rows
                .filter((row) => row.user_id === userId)
                .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id));
              if (sql.includes("SELECT id, name, body, created_at")) {
                const limit = Number(args[1]);
                return {
                  results: matched.slice(0, Number.isFinite(limit) ? limit : matched.length),
                };
              }
              if (sql.includes("SELECT id FROM saved_prompts")) {
                return { results: matched.map((row) => ({ id: row.id })) };
              }
              return { results: [] };
            },
            async first() {
              if (sql.includes("FROM sessions")) {
                return args[0] === TEST_SESSION_ID ? TEST_USER : null;
              }
              if (sql.includes("id = ? AND user_id = ?")) {
                return rows.find((row) => row.id === args[0] && row.user_id === args[1]) ?? null;
              }
              return null;
            },
            async run() {
              if (sql.startsWith("INSERT")) {
                rows.push({
                  id: String(args[0]),
                  user_id: String(args[1]),
                  name: String(args[2]),
                  body: String(args[3]),
                  created_at: Number(args[4]),
                });
              } else if (sql.startsWith("UPDATE")) {
                const row = rows.find((item) => item.id === args[3] && item.user_id === args[4]);
                if (row) {
                  row.name = String(args[0]);
                  row.body = String(args[1]);
                  row.created_at = Number(args[2]);
                }
              } else if (sql.startsWith("DELETE")) {
                const index = rows.findIndex((item) => item.id === args[0] && item.user_id === args[1]);
                if (index >= 0) rows.splice(index, 1);
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
  return { rows, db: db as unknown as D1Database };
}

describe("saved prompts", () => {
  it("keeps mention tokens and rejects a blank prompt or name", () => {
    expect(acceptSavedPromptBody("  use @Image1 and @Video2  ")).toBe(
      "  use @Image1 and @Video2  ",
    );
    expect(acceptSavedPromptBody("   ")).toBeNull();
    expect(acceptSavedPromptBody(1)).toBeNull();
    expect(acceptSavedPromptBody("x".repeat(SAVED_PROMPT_MAX_CHARS + 1))).toBeNull();
    expect(acceptSavedPromptName("  Wide shot  ")).toBe("Wide shot");
    expect(acceptSavedPromptName("   ")).toBeNull();
  });

  it("stores a named prompt and edits the name and text without rewriting mentions", async () => {
    const { db } = promptsDb();
    const saved = await saveSavedPrompt(db, TEST_USER.id, {
      name: "Wide",
      body: "wide shot @Image1",
    });
    expect(saved?.body).toBe("wide shot @Image1");
    const again = await saveSavedPrompt(db, TEST_USER.id, {
      name: "Wide",
      body: "wide shot @Image1",
    });
    expect(again?.id).not.toBe(saved?.id);
    await saveSavedPrompt(db, "someone-else", { name: "Wide", body: "wide shot @Image1" });
    const updated = await updateSavedPrompt(db, TEST_USER.id, saved!.id, {
      name: "Closer",
      body: "  hold @Image1 and @Audio2  ",
    });
    expect(updated).toEqual({
      prompt: expect.objectContaining({
        id: saved!.id,
        name: "Closer",
        body: "  hold @Image1 and @Audio2  ",
      }),
    });
    expect(await updateSavedPrompt(db, "someone-else", saved!.id, {
      name: "Nope",
      body: "@Image1",
    })).toEqual({ error: "missing" });
    const mine = await listSavedPrompts(db, TEST_USER.id);
    expect(mine.find((item) => item.id === saved!.id)?.body).toBe("  hold @Image1 and @Audio2  ");
    expect(await saveSavedPrompt(db, TEST_USER.id, { name: "  ", body: "x" })).toBeNull();
  });

  it("deletes only the owner's row", async () => {
    const { db } = promptsDb();
    const saved = await saveSavedPrompt(db, TEST_USER.id, { name: "Audio", body: "@Audio1" });
    expect(saved).not.toBeNull();
    expect(await deleteSavedPrompt(db, "someone-else", saved!.id)).toBe(false);
    expect(await deleteSavedPrompt(db, TEST_USER.id, saved!.id)).toBe(true);
    expect(await listSavedPrompts(db, TEST_USER.id)).toEqual([]);
  });

  it("requires a signed-in user on the prompt routes", async () => {
    const res = await app.request("https://studio.digisavvy.dev/api/prompts", {}, createEnv());
    expect(res.status).toBe(401);
    const authed = await app.request(
      "https://studio.digisavvy.dev/api/prompts",
      {
        method: "POST",
        headers: {
          Cookie: `${SESSION_COOKIE}=${TEST_SESSION_ID}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Wide", body: "   " }),
      },
      createEnv(),
    );
    expect(authed.status).toBe(400);
  });
});
