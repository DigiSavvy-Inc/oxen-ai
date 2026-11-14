import { decryptSecret, encryptSecret, timingSafeEqual } from "./crypto";
import type { SealedGithubToken } from "./auth";

/**
 * Sign-in for the native Mac shell. A web view cannot do passkeys or GitHub Mobile,
 * so the app sends the person through their real browser and then needs the session
 * in its own cookie jar. The browser ends on `oxenstudio://auth?code=…`; the app trades
 * that code for the session cookie.
 *
 * Any app can register a URL scheme, so the code alone must be worthless: it is bound
 * to a PKCE challenge, and only the app that started the sign-in holds the verifier.
 */
export const NATIVE_COOKIE = "oauth_native";
export const NATIVE_SCHEME = "oxenstudio";
/** Custom header: a cross-site form cannot send it, so it cannot plant a session. */
export const NATIVE_HEADER = "X-Studio-Native";

const HANDOFF_TTL_SECONDS = 120;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9_-]{43,128}$/;

type Handoff = {
  t: "native-handoff";
  u: string;
  g: SealedGithubToken | null;
  c: string;
  e: number;
};

export function parseNativeChallenge(value: string | undefined | null): string | null {
  return value && CHALLENGE.test(value) ? value : null;
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let binary = "";
  for (const b of new Uint8Array(digest)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sealHandoff(
  input: { userId: string; github: SealedGithubToken | null; challenge: string },
  encryptionKey: string,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  // An empty key would make the code forgeable by anyone.
  if (!encryptionKey.trim()) throw new Error("ENCRYPTION_KEY is required for native sign-in");
  const payload: Handoff = {
    t: "native-handoff",
    u: input.userId,
    g: input.github,
    c: input.challenge,
    e: now + HANDOFF_TTL_SECONDS,
  };
  const { ciphertext, iv } = await encryptSecret(JSON.stringify(payload), encryptionKey);
  return `${iv}.${ciphertext}`;
}

/** Null for anything forged, expired, or presented without the matching verifier. */
export async function openHandoff(
  code: unknown,
  verifier: unknown,
  encryptionKey: string,
  now = Math.floor(Date.now() / 1000),
): Promise<{ userId: string; github: SealedGithubToken | null } | null> {
  if (typeof code !== "string" || typeof verifier !== "string") return null;
  if (!encryptionKey.trim() || !VERIFIER.test(verifier)) return null;
  const [iv, ciphertext, extra] = code.split(".");
  if (!iv || !ciphertext || extra !== undefined) return null;
  let payload: Handoff;
  try {
    payload = JSON.parse(await decryptSecret(ciphertext, iv, encryptionKey)) as Handoff;
  } catch {
    return null;
  }
  if (payload?.t !== "native-handoff" || typeof payload.u !== "string" || typeof payload.c !== "string") {
    return null;
  }
  if (typeof payload.e !== "number" || payload.e < now) return null;
  if (!(await timingSafeEqual(await challengeFor(verifier), payload.c))) return null;
  return { userId: payload.u, github: payload.g ?? null };
}
