import { sniffSafeMediaType } from "./media";

/** Shown when an admin has not saved a name. */
export const DEFAULT_SITE_NAME = "Oxen Studio";
/** Bundled mark. Not a hotlinked URL. */
export const DEFAULT_LOGO_PATH = "/oxen-logo.svg";
export const DEFAULT_LOGO_TYPE = "image/svg+xml";
/** One object, overwritten when an admin uploads a new logo. */
export const INSTANCE_LOGO_KEY = "instance/logo";
export const SITE_NAME_MAX = 80;
export const LOGO_MAX_BYTES = 512 * 1024;

const RASTER_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export type InstanceBranding = {
  /** Name visitors see. Never empty. */
  name: string;
  /** Saved name, or null when the instance is using the default. */
  savedName: string | null;
  logoUrl: string;
  logoType: string;
  customLogo: boolean;
};

type BrandingRow = {
  site_name: string | null;
  logo_key: string | null;
  logo_type: string | null;
  updated_at: number;
};

export function defaultInstanceBranding(): InstanceBranding {
  return {
    name: DEFAULT_SITE_NAME,
    savedName: null,
    logoUrl: DEFAULT_LOGO_PATH,
    logoType: DEFAULT_LOGO_TYPE,
    customLogo: false,
  };
}

/** Blank or missing names resolve to Oxen Studio. */
export function normalizeSiteName(
  input: unknown,
): { ok: true; name: string | null } | { ok: false; error: string } {
  if (input == null) return { ok: true, name: null };
  if (typeof input !== "string") return { ok: false, error: "Site name must be text" };
  const name = input.trim().replace(/\s+/g, " ");
  if (!name) return { ok: true, name: null };
  if (name.length > SITE_NAME_MAX) {
    return { ok: false, error: `Site name must be ${SITE_NAME_MAX} characters or fewer` };
  }
  if ([...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) {
    return { ok: false, error: "Site name has invalid characters" };
  }
  return { ok: true, name };
}

/**
 * Raster images are identified from magic bytes. SVG is admin-only and rejected
 * when it carries script, event handlers, or external references.
 */
export function acceptLogoBytes(
  bytes: Uint8Array,
): { contentType: string } | { error: string } {
  if (bytes.byteLength === 0) return { error: "Logo file is empty" };
  if (bytes.byteLength > LOGO_MAX_BYTES) {
    return { error: "Logo must be 512 KB or smaller" };
  }
  const sniffed = sniffSafeMediaType(bytes);
  if (sniffed && RASTER_LOGO_TYPES.has(sniffed)) return { contentType: sniffed };
  if (isSafeSvg(bytes)) return { contentType: "image/svg+xml" };
  return { error: "Logo must be a PNG, JPEG, WebP, GIF, or SVG" };
}

function isSafeSvg(bytes: Uint8Array): boolean {
  const text = new TextDecoder().decode(bytes).trim();
  if (!text.startsWith("<") && !text.startsWith("<?xml")) return false;
  if (!/<svg[\s>]/i.test(text)) return false;
  const withoutXmlns = text.replace(/xmlns(?::\w+)?="[^"]*"/gi, "");
  if (
    /<script|<\/script|javascript:|on[a-z]+\s*=|<foreignObject|<iframe|<embed|<object|<use[\s>]|data:|https?:/i.test(
      withoutXmlns,
    )
  ) {
    return false;
  }
  return true;
}

function brandingFromRow(row: BrandingRow | null): InstanceBranding {
  if (!row) return defaultInstanceBranding();
  const savedName = row.site_name?.trim() ? row.site_name.trim() : null;
  const customLogo = Boolean(row.logo_key);
  return {
    name: savedName ?? DEFAULT_SITE_NAME,
    savedName,
    logoUrl: customLogo ? `/api/branding/logo?v=${row.updated_at}&frame=3` : DEFAULT_LOGO_PATH,
    logoType: customLogo ? row.logo_type || "image/png" : DEFAULT_LOGO_TYPE,
    customLogo,
  };
}

async function readRow(db: D1Database): Promise<BrandingRow | null> {
  const row = await db
    .prepare(
      `SELECT site_name, logo_key, logo_type, updated_at FROM instance_settings WHERE id = 1`,
    )
    .bind()
    .first<BrandingRow>();
  return row ?? null;
}

async function upsertBranding(
  db: D1Database,
  siteName: string | null,
  logoKey: string | null,
  logoType: string | null,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO instance_settings (id, site_name, logo_key, logo_type, updated_at)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         site_name = excluded.site_name,
         logo_key = excluded.logo_key,
         logo_type = excluded.logo_type,
         updated_at = excluded.updated_at`,
    )
    .bind(siteName, logoKey, logoType, now)
    .run();
}

export async function readInstanceBranding(db: D1Database): Promise<InstanceBranding> {
  try {
    return brandingFromRow(await readRow(db));
  } catch {
    // Table missing (migration not applied yet) still serves the Oxen Studio defaults.
    return defaultInstanceBranding();
  }
}

export async function saveInstanceBranding(
  db: D1Database,
  bucket: R2Bucket,
  input: { name: string | null; clearLogo: boolean },
): Promise<InstanceBranding> {
  const existing = await readRow(db);
  let logoKey = existing?.logo_key ?? null;
  let logoType = existing?.logo_type ?? null;
  if (input.clearLogo && logoKey) {
    await bucket.delete(logoKey);
    logoKey = null;
    logoType = null;
  }
  await upsertBranding(db, input.name, logoKey, logoType);
  return brandingFromRow(await readRow(db));
}

export async function saveInstanceLogo(
  db: D1Database,
  bucket: R2Bucket,
  bytes: Uint8Array,
  contentType: string,
): Promise<InstanceBranding> {
  const existing = await readRow(db);
  const savedName = existing?.site_name?.trim() ? existing.site_name.trim() : null;
  await bucket.put(INSTANCE_LOGO_KEY, bytes, {
    httpMetadata: { contentType },
  });
  await upsertBranding(db, savedName, INSTANCE_LOGO_KEY, contentType);
  return brandingFromRow(await readRow(db));
}
