import { describe, expect, it, vi } from "vitest";
import { getOxenKey, readOxenKey, saveOxenKey } from "../worker/auth";
import { encryptSecret } from "../worker/crypto";
import { TEST_SECRET, TEST_USER } from "./helpers";

function captureDb() {
  const writes: unknown[][] = [];
  const db = {
    prepare() {
      return { bind: (...args: unknown[]) => ({ run: async () => (writes.push(args), { success: true }) }) };
    },
  } as unknown as D1Database;
  return { db, writes };
}

describe("Oxen key storage", () => {
  it("returns the key for a good ciphertext", async () => {
    const { ciphertext, iv } = await encryptSecret("oxen_test", TEST_SECRET);
    const user = { ...TEST_USER, oxen_key_ciphertext: ciphertext, oxen_key_iv: iv };
    expect(await getOxenKey(user, TEST_SECRET)).toBe("oxen_test");
  });

  it("treats a non-base64 ciphertext as unreadable instead of throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { iv } = await encryptSecret("oxen_test", TEST_SECRET);
    const user = { ...TEST_USER, oxen_key_ciphertext: "a".repeat(218) + "!", oxen_key_iv: iv };
    expect(await readOxenKey(user, TEST_SECRET)).toEqual({ key: null, unreadable: true });
    expect(await getOxenKey(user, TEST_SECRET)).toBeNull();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("aaaa");
    warn.mockRestore();
  });

  it("treats a ciphertext sealed with another key as unreadable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ciphertext, iv } = await encryptSecret("oxen_test", "other-key");
    const user = { ...TEST_USER, oxen_key_ciphertext: ciphertext, oxen_key_iv: iv };
    expect((await readOxenKey(user, TEST_SECRET)).unreadable).toBe(true);
  });

  it("trims and round-trips before writing", async () => {
    const { db, writes } = captureDb();
    await saveOxenKey(db, "user-1", "  oxen_test \n", TEST_SECRET);
    expect(writes).toHaveLength(1);
    const [ciphertext, iv] = writes[0] as [string, string];
    const user = { ...TEST_USER, oxen_key_ciphertext: ciphertext, oxen_key_iv: iv };
    expect(await getOxenKey(user, TEST_SECRET)).toBe("oxen_test");
  });

  it("rejects an empty key without writing", async () => {
    const { db, writes } = captureDb();
    await expect(saveOxenKey(db, "user-1", "   ", TEST_SECRET)).rejects.toThrow();
    expect(writes).toHaveLength(0);
  });
});

describe("/api/auth/me with an unreadable Oxen key", () => {
  it("reports no key and flags it for re-entry", async () => {
    const { app } = await import("../worker/index");
    const { createEnv, createMockDb, TEST_SESSION_ID } = await import("./helpers");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { iv } = await encryptSecret("oxen_test", TEST_SECRET);
    const user = { ...TEST_USER, oxen_key_ciphertext: "A".repeat(218) + "!", oxen_key_iv: iv };
    const env = createEnv({ DB: createMockDb(user, TEST_SESSION_ID) });
    const res = await app.request(
      "http://localhost/api/auth/me",
      { headers: { Cookie: `oxen_session=${TEST_SESSION_ID}` } },
      env,
    );
    const body = (await res.json()) as { user: { hasOxenKey: boolean; oxenKeyUnreadable?: boolean } };
    expect(res.status).toBe(200);
    expect(body.user.hasOxenKey).toBe(false);
    expect(body.user.oxenKeyUnreadable).toBe(true);
  });
});
