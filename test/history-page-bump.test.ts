import { describe, expect, it } from "vitest";
import { ensureHistoryPageSize36 } from "../worker/history-page-bump";

type Call = { sql: string; args: unknown[] };

function fakeDb(applied: boolean) {
  const calls: Call[] = [];
  function statement(sql: string, args: unknown[]) {
    return {
      bind(...next: unknown[]) {
        return statement(sql, next);
      },
      async first() {
        calls.push({ sql, args });
        return applied ? { id: 1 } : null;
      },
      async run() {
        calls.push({ sql, args });
        return { success: true };
      },
    };
  }
  const db = {
    prepare(sql: string) {
      return statement(sql, []);
    },
  } as unknown as D1Database;
  return { db, calls };
}

describe("history page size bump", () => {
  it("moves the old default of 24 to 36 once", async () => {
    const { db, calls } = fakeDb(false);
    await ensureHistoryPageSize36(db);
    await ensureHistoryPageSize36(db);
    expect(calls.map((call) => call.sql)).toEqual([
      "SELECT id FROM d1_migrations WHERE name = ?",
      "UPDATE user_settings SET history_page_size = 36 WHERE history_page_size = 24",
      "INSERT INTO d1_migrations (name) VALUES (?)",
    ]);
    expect(calls[0]?.args).toEqual(["0023_history_page_size_36.sql"]);
    expect(calls[2]?.args).toEqual(["0023_history_page_size_36.sql"]);
  });
});
