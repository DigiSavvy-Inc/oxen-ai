import { describe, expect, it } from "vitest";
import { app } from "../worker/index";
import {
  createSignedMediaUrl,
  displayStoredMediaUrl,
  mediaSigningSecret,
  verifyMediaSignature,
} from "../worker/media";
import { resolveRefsForOxen, StudioMediaRefRejected } from "../worker/oxen-refs";
import { TEST_SECRET, createEnv, createMockR2 } from "./helpers";

const ORIGIN = "https://studio.digisavvy.dev";
const KEY = "u/user-1/results/a.png";
const SIGNING_KEY = "dedicated-media-signing-key";

function envWithMedia(overrides: Record<string, string> = {}) {
  const { store, bucket } = createMockR2();
  store.set(KEY, { body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer as ArrayBuffer, contentType: "image/png" });
  return createEnv({ MEDIA: bucket, PUBLIC_BASE_URL: ORIGIN, ...overrides });
}

function sigParts(url: string) {
  const parsed = new URL(url);
  return [parsed.searchParams.get("exp") ?? "", parsed.searchParams.get("sig") ?? ""] as const;
}

describe("dedicated media signing key", () => {
  // Rotating ENCRYPTION_KEY re-encrypts Oxen keys; it must not be what signs media.
  it("signs new URLs with MEDIA_SIGNING_KEY, not ENCRYPTION_KEY", async () => {
    const env = envWithMedia({ MEDIA_SIGNING_KEY: SIGNING_KEY });
    const url = (await displayStoredMediaUrl(env, KEY, null))!;
    const [exp, sig] = sigParts(url);
    expect(await verifyMediaSignature(KEY, exp, sig, SIGNING_KEY)).toBe(true);
    expect(await verifyMediaSignature(KEY, exp, sig, TEST_SECRET)).toBe(false);
  });

  it("falls back to ENCRYPTION_KEY for self-hosters without a signing key", () => {
    expect(mediaSigningSecret(createEnv())).toBe(TEST_SECRET);
  });

  // The grace window for URLs signed before MEDIA_SIGNING_KEY existed closed on 2026-10-01.
  it("rejects URLs signed with ENCRYPTION_KEY once a signing key is set", async () => {
    const env = envWithMedia({ MEDIA_SIGNING_KEY: SIGNING_KEY });
    const legacy = await createSignedMediaUrl(ORIGIN, KEY, TEST_SECRET);
    expect((await app.request(legacy, {}, env)).status).toBe(403);
    await expect(
      resolveRefsForOxen(env.MEDIA, [legacy], undefined, [false], {
        publicBaseUrl: ORIGIN,
        secret: SIGNING_KEY,
        userId: "user-1",
      }),
    ).rejects.toBeInstanceOf(StudioMediaRefRejected);
  });

  it("no longer accepts SESSION_SECRET as a silent signing fallback", async () => {
    const env = envWithMedia({ MEDIA_SIGNING_KEY: SIGNING_KEY });
    const forged = await createSignedMediaUrl(ORIGIN, KEY, "session-secret");
    expect((await app.request(forged, {}, env)).status).toBe(403);
    await expect(
      resolveRefsForOxen(env.MEDIA, [forged], undefined, [false], {
        publicBaseUrl: ORIGIN,
        secret: SIGNING_KEY,
        userId: "user-1",
      }),
    ).rejects.toBeInstanceOf(StudioMediaRefRejected);
  });
});
