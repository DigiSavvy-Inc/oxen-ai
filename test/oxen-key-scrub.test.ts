import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const scrub = readFileSync(new URL("../migrations/0020_scrub_invalid_oxen_keys.sql", import.meta.url), "utf8");

describe("0020_scrub_invalid_oxen_keys", () => {
  it("nulls only structurally invalid ciphertext/iv rows and deletes nothing", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, oxen_key_ciphertext TEXT, oxen_key_iv TEXT, updated_at INTEGER)`);
    const rows: Array<[string, string | null, string | null]> = [
      ["valid", "QUJDRA==", "AAAAAAAAAAAAAAAA"],
      ["none", null, null],
      ["bad-length", "a".repeat(219), "AAAAAAAAAAAAAAAA"],
      ["bad-char", "QUJD-A==", "AAAAAAAAAAAAAAAA"],
      ["bad-iv", "QUJDRA==", "AAAA_AAAAAAAAAAA"],
    ];
    const insert = db.prepare(`INSERT INTO users VALUES (?, ?, ?, 0)`);
    for (const r of rows) insert.run(...r);
    db.exec(scrub);
    const out = db.prepare(`SELECT id, oxen_key_ciphertext c, oxen_key_iv i, updated_at u FROM users ORDER BY id`).all() as Array<{ id: string; c: string | null; i: string | null; u: number }>;
    expect(out).toHaveLength(5);
    const byId = Object.fromEntries(out.map((r) => [r.id, r]));
    expect(byId.valid).toMatchObject({ c: "QUJDRA==", i: "AAAAAAAAAAAAAAAA", u: 0 });
    expect(byId.none).toMatchObject({ c: null, i: null, u: 0 });
    for (const id of ["bad-length", "bad-char", "bad-iv"]) {
      expect(byId[id]).toMatchObject({ c: null, i: null });
      expect(Boolean(byId[id]!.c && byId[id]!.i)).toBe(false); // hasOxenKey
    }
  });
});
