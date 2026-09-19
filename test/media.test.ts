import { describe, expect, it } from "vitest";
import {
  MEDIA_URL_TTL_SECONDS,
  buildReferenceMediaUrl,
  createSignedMediaUrl,
  resolvePublicBaseUrl,
  signedMediaExpiry,
  verifyMediaSignature,
} from "../worker/media";

const SECRET = "test-signing-secret";
const KEY = "u/user-1/ref.png";
const PNG = new Uint8Array([137, 80, 78, 71]).buffer;

describe("resolvePublicBaseUrl", () => {
  it("returns null when unset, empty, or whitespace", () => {
    expect(resolvePublicBaseUrl(undefined)).toBeNull();
    expect(resolvePublicBaseUrl("")).toBeNull();
    expect(resolvePublicBaseUrl("   ")).toBeNull();
  });

  it("strips trailing slashes and yields an https origin", () => {
    expect(resolvePublicBaseUrl("https://studio.digisavvy.dev/")).toBe(
      "https://studio.digisavvy.dev",
    );
    expect(resolvePublicBaseUrl("https://studio.digisavvy.dev")).toBe(
      "https://studio.digisavvy.dev",
    );
    expect(resolvePublicBaseUrl("http://studio.digisavvy.dev/")).toBe(
      "https://studio.digisavvy.dev",
    );
    expect(resolvePublicBaseUrl("studio.digisavvy.dev")).toBe(
      "https://studio.digisavvy.dev",
    );
  });
});

describe("signed media URLs", () => {
  it("creates an absolute https URL with exp and a hex sig that verifies", async () => {
    const url = await createSignedMediaUrl(
      "https://studio.digisavvy.dev/",
      KEY,
      SECRET,
    );
    const parsed = new URL(url);
    expect(parsed.protocol).toBe("https:");
    expect(parsed.origin).toBe("https://studio.digisavvy.dev");
    expect(parsed.pathname).toBe(`/api/media/${KEY}`);
    const exp = parsed.searchParams.get("exp") ?? "";
    const sig = parsed.searchParams.get("sig") ?? "";
    expect(exp).toMatch(/^\d+$/);
    expect(sig).toMatch(/^[0-9a-f]+$/);
    expect(sig.includes("+") || sig.includes("/")).toBe(false);
    const ttl = Number(exp) - Math.floor(Date.now() / 1000);
    expect(ttl).toBeGreaterThan(11 * 60 * 60);
    expect(ttl).toBeLessThanOrEqual(MEDIA_URL_TTL_SECONDS);
    expect(await verifyMediaSignature(KEY, exp, sig, SECRET)).toBe(true);
  });

  it("rejects expired signatures", async () => {
    const url = await createSignedMediaUrl(
      "https://studio.digisavvy.dev",
      KEY,
      SECRET,
      -30,
    );
    const parsed = new URL(url);
    expect(
      await verifyMediaSignature(
        KEY,
        parsed.searchParams.get("exp") ?? "",
        parsed.searchParams.get("sig") ?? "",
        SECRET,
      ),
    ).toBe(false);
  });

  it("rejects a tampered key, exp, or sig", async () => {
    const url = await createSignedMediaUrl(
      "https://studio.digisavvy.dev",
      KEY,
      SECRET,
    );
    const parsed = new URL(url);
    const exp = parsed.searchParams.get("exp") ?? "";
    const sig = parsed.searchParams.get("sig") ?? "";
    expect(await verifyMediaSignature("u/other/ref.png", exp, sig, SECRET)).toBe(
      false,
    );
    expect(await verifyMediaSignature(KEY, String(Number(exp) + 1), sig, SECRET)).toBe(
      false,
    );
    expect(await verifyMediaSignature(KEY, exp, "aa".repeat(32), SECRET)).toBe(false);
    expect(await verifyMediaSignature(KEY, exp, sig, "wrong-secret")).toBe(false);
  });

  it("keeps exp aligned to an hourly window so the same object reuses one URL", () => {
    const now = 1_777_000_000;
    expect(signedMediaExpiry(now)).toBe(signedMediaExpiry(now + 59));
    expect(signedMediaExpiry(now + 3600)).not.toBe(signedMediaExpiry(now));
  });

  it("issues the same signed URL twice within the stable window", async () => {
    const first = await createSignedMediaUrl("https://studio.digisavvy.dev", KEY, SECRET);
    const second = await createSignedMediaUrl("https://studio.digisavvy.dev", KEY, SECRET);
    expect(first).toBe(second);
  });
});

describe("buildReferenceMediaUrl local vs PUBLIC_BASE_URL", () => {
  it("returns a data URI when PUBLIC_BASE_URL is unset or empty", async () => {
    for (const publicBaseUrl of [undefined, "", "  "]) {
      const result = await buildReferenceMediaUrl({
        publicBaseUrl,
        key: KEY,
        secret: SECRET,
        bytes: PNG,
        contentType: "image/png",
      });
      expect(result.kind).toBe("data-uri");
      expect(result.url.startsWith("data:image/png;base64,")).toBe(true);
    }
  });

  it("returns a signed https URL under the production origin when PUBLIC_BASE_URL is set", async () => {
    const result = await buildReferenceMediaUrl({
      publicBaseUrl: "https://studio.digisavvy.dev/",
      key: KEY,
      secret: SECRET,
      bytes: PNG,
      contentType: "image/png",
    });
    expect(result.kind).toBe("signed");
    const parsed = new URL(result.url);
    expect(parsed.origin).toBe("https://studio.digisavvy.dev");
    expect(parsed.protocol).toBe("https:");
    expect(parsed.searchParams.has("exp")).toBe(true);
    expect(parsed.searchParams.has("sig")).toBe(true);
    expect(
      await verifyMediaSignature(
        KEY,
        parsed.searchParams.get("exp") ?? "",
        parsed.searchParams.get("sig") ?? "",
        SECRET,
      ),
    ).toBe(true);
  });
});
