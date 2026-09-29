import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { UPLOAD_DAILY_BYTES, reserveUploadBytes } from "../worker/upload-quota";

// Real SQLite + the real migration, so the upsert-with-WHERE runs as D1 runs it.
function sqliteD1(): D1Database {
  const raw = new DatabaseSync(":memory:");
  raw.exec(readFileSync(new URL("../migrations/0014_upload_usage.sql", import.meta.url), "utf8"));
  return {
    prepare(sql: string) {
      return {
        bind(...args: (string | number)[]) {
          return {
            async first() {
              return raw.prepare(sql).get(...args) ?? null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

const DAY = new Date("2026-09-29T12:00:00Z");
const MB = 1024 * 1024;

describe("daily upload quota", () => {
  // Uploads land in Studio's R2 bucket, so one account must not be able to fill it.
  it("stops an account once today's uploads would pass the budget", async () => {
    const db = sqliteD1();
    const chunk = 80 * MB;
    const fits = Math.floor(UPLOAD_DAILY_BYTES / chunk);
    for (let i = 0; i < fits; i++) {
      expect(await reserveUploadBytes(db, "u1", chunk, DAY)).toBe(true);
    }
    expect(await reserveUploadBytes(db, "u1", chunk, DAY)).toBe(false);
    // A small file that still fits is allowed; the rejection recorded nothing.
    const left = UPLOAD_DAILY_BYTES - fits * chunk;
    expect(await reserveUploadBytes(db, "u1", left, DAY)).toBe(true);
    expect(await reserveUploadBytes(db, "u1", 1, DAY)).toBe(false);
  });

  it("tracks each account and each UTC day separately", async () => {
    const db = sqliteD1();
    expect(await reserveUploadBytes(db, "u1", UPLOAD_DAILY_BYTES, DAY)).toBe(true);
    expect(await reserveUploadBytes(db, "u1", 1, DAY)).toBe(false);
    expect(await reserveUploadBytes(db, "u2", 1, DAY)).toBe(true);
    expect(await reserveUploadBytes(db, "u1", 1, new Date("2026-09-30T00:00:01Z"))).toBe(true);
  });
});
