/**
 * What an API token may call (#78): generate, read, and organise. Cookie requests never come
 * here. Anything not listed is refused, so a new route stays closed to tokens until it is added.
 *
 * Patterns: `:name` matches one path segment, a trailing `*` matches one or more segments.
 * Never list a DELETE, settings, admin, branding writes, sign-in routes other than `me`,
 * profile changes, bulk deletes, cleanup, chat, push, or shares.
 */
export const TOKEN_SCOPE: readonly (readonly [method: "GET" | "POST" | "PUT", pattern: string])[] = [
  ["GET", "/api/health"],
  ["GET", "/api/auth/me"],
  ["GET", "/api/models"],
  ["GET", "/api/models/*"],
  ["GET", "/api/billing/credits"],
  ["POST", "/api/upload"],
  ["POST", "/api/media/renew"],
  ["GET", "/api/media/*"],
  ["POST", "/api/generate"],
  ["GET", "/api/generations"],
  ["GET", "/api/generations/:id"],
  ["POST", "/api/generations/:id/last-frame"],
  ["PUT", "/api/generations/:id/tags"],
  ["GET", "/api/profiles"],
  ["GET", "/api/galleries"],
  ["GET", "/api/galleries/:id"],
  ["POST", "/api/galleries"],
  ["PUT", "/api/galleries/:id/collection"],
  ["GET", "/api/collections"],
  ["GET", "/api/collections/:id/assets"],
  ["POST", "/api/collections"],
  ["GET", "/api/slots"],
  ["POST", "/api/slots"],
  ["POST", "/api/slots/:id/files"],
  ["GET", "/api/projects"],
  ["GET", "/api/projects/:id"],
  ["GET", "/api/projects/:id/jobs"],
  ["GET", "/api/prompts"],
  ["GET", "/api/oxen/queue"],
];

export const TOKEN_SCOPE_DENIED = "This token cannot do that.";

function segments(path: string): string[] {
  return path.split("/").slice(1);
}

function patternMatches(pattern: string, path: string): boolean {
  const want = segments(pattern);
  const got = segments(path);
  for (let i = 0; i < want.length; i += 1) {
    const part = want[i]!;
    if (part === "*" && i === want.length - 1) {
      return got.length > i && got.slice(i).every((segment) => segment !== "");
    }
    const actual = got[i];
    if (actual === undefined) return false;
    if (part.startsWith(":")) {
      if (!actual) return false;
      continue;
    }
    if (part !== actual) return false;
  }
  return got.length === want.length;
}

export function tokenMayCall(method: string, path: string): boolean {
  const verb = method.toUpperCase();
  return TOKEN_SCOPE.some(([allowed, pattern]) => allowed === verb && patternMatches(pattern, path));
}
