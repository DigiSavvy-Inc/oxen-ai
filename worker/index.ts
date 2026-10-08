import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import {
  SESSION_COOKIE,
  clearOxenKey,
  createSession,
  deleteSession,
  deleteSessionsForAllowlistLogin,
  exchangeGithubCode,
  fetchGithubUser,
  getOxenKey,
  getSessionId,
  isLoopbackHost,
  isNumericAdminEntry,
  loadAuthorizedUser,
  oauthConfigured,
  saveOxenKey,
  sealGithubToken,
  sessionCookieOptions,
  toSessionUser,
  upsertUser,
  userHasAccess,
} from "./auth";
import { creditBalanceResponse, fetchOxenCredits, OXEN_BILLING_URL } from "./credits";
import {
  buildReferenceMediaUrl,
  displayStoredMediaUrl,
  guessMediaContentType,
  mediaServeDisposition,
  mediaSigningSecret,
  mediaVerifySecrets,
  putMediaObject,
  sniffSafeMediaType,
  verifyMediaSignature,
} from "./media";
import { collectOxenRefs, resolveRefsForOxen, StudioMediaRefRejected } from "./oxen-refs";
import {
  buildEnqueuePayload,
  downloadOxenResult,
  enqueueGeneration,
  extractOxenErrorMessage,
  extractOxenTiming,
  extractResultUrl,
  favoriteModel,
  filterModelsForMode,
  getGeneration,
  getModel,
  isD1TooBig,
  isMediaGenerationModel,
  listFavoriteModels,
  OxenApiError,
  listModels,
  listQueue,
  mergeMissingFeaturedModels,
  notePollFailure,
  pollErrorMessage,
  presentGenerationError,
  resetPollFailures,
  searchModels,
  shouldPersistPollFailure,
  unfavoriteModel,
  unionModelsById,
  type OxenModel,
} from "./oxen";
import {
  asSingleString,
  asStringList,
  clampDuration,
  clampNumericControl,
  imageSlotRequired,
  mapMediaUrls,
  parseGenerationListScope,
  parseModelControls,
  showGetLastFrame,
  pickCompatible,
  resolveEnqueueAspectRatio,
  resolveSafetyTolerance,
  resolutionPayloadFields,
  unsupportedReferenceMessage,
  videoSlotRequired,
  type GenerationListScope,
} from "./schema";
import {
  captureLastFrameRequested,
  generationParamsForStorage,
  rejectLastFrameUpload,
  sniffImageContentType,
} from "./last-frame";
import {
  acceptGalleryItems,
  acceptGalleryName,
  getGallery,
  listGalleries,
  saveGallery,
} from "./galleries";
import {
  deleteSavedPrompt,
  listSavedPrompts,
  saveSavedPrompt,
  updateSavedPrompt,
} from "./saved-prompts";
import { parseTagList } from "./tags";
import { createImageThumbnail } from "./thumbs";
import {
  backfillMissingThumbnails,
  deleteAllUserMedia,
  deleteFailedGenerations,
  deleteStoredMedia,
  parseCleanupAction,
  parseFromOxenFlag,
  removeStudioGeneration,
} from "./library";
import { GENERATION_MODES } from "./model-modes";
import { flux3VideoModel } from "./flux-video";
import { seedAudioModel } from "./seed-audio";
import type { Env, GenerationMode, SessionUser, UserRow } from "./types";
import { getStudioSettings, saveStudioSettings } from "./user-settings";
import { reserveUploadBytes } from "./upload-quota";
import {
  acceptLogoBytes,
  INSTANCE_LOGO_KEY,
  normalizeSiteName,
  readInstanceBranding,
  saveInstanceBranding,
  saveInstanceLogo,
} from "./branding";
import { frameLogoPng } from "./logo-frame";
import {
  deletePushSubscription,
  notifyGenerationComplete,
  parsePushSubscription,
  savePushSubscription,
  userHasPushSubscription,
  vapidConfigured,
} from "./push";

type Variables = {
  user: UserRow;
  sessionUser: SessionUser;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const MODE_META: Record<
  GenerationMode,
  { mediaType: "image" | "video" | "audio"; needsImage?: boolean; needsVideo?: boolean }
> = {
  "text-to-image": { mediaType: "image" },
  "image-to-image": { mediaType: "image", needsImage: true },
  "text-to-video": { mediaType: "video" },
  "reference-to-video": { mediaType: "video", needsImage: true },
  "video-to-video": { mediaType: "video", needsVideo: true },
  "text-to-audio": { mediaType: "audio" },
};

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    const message = err.message || "Request failed";
    return c.json({ error: message }, err.status);
  }
  if (err instanceof OxenApiError) {
    return c.json({ error: err.message || "Oxen request failed" }, 502);
  }
  // Internal errors (D1, R2, GitHub) can carry schema or infrastructure detail. Log it
  // with a short reference and give the browser only the reference.
  const ref = crypto.randomUUID().slice(0, 8);
  console.error(`internal error ${ref}`, err);
  return c.json({ error: `Something went wrong (ref ${ref})` }, 500);
});

// API responses never need to run script or be framed. A locked-down CSP means media
// served from /api/media renders as a document with no script, even if mislabeled.
// Static assets get the app CSP from public/_headers.
app.use("/api/*", async (c, next) => {
  await next();
  const headers = c.res.headers;
  headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; media-src 'self'; frame-ancestors 'none'");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Strict-Transport-Security", "max-age=31536000");
});

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// SameSite=Lax still sends the session cookie from other *.digisavvy.dev subdomains,
// and c.req.json() parses text/plain bodies, so browser writes must come from Studio.
// Requests without an Origin header (curl, server-to-server) are not browser CSRF.
app.use("/api/*", async (c, next) => {
  if (UNSAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin && origin !== publicOrigin(c)) {
      throw new HTTPException(403, { message: "Cross-origin request blocked" });
    }
  }
  await next();
});

async function requireUser(c: {
  req: { header: (name: string) => string | undefined };
  env: Env;
  set: (key: "user" | "sessionUser", value: unknown) => void;
}): Promise<UserRow> {
  const sessionId = getSessionId(c.req.header("Cookie"));
  if (!sessionId) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  const user = await loadAuthorizedUser(c.env, sessionId);
  if (!user) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  c.set("user", user);
  c.set("sessionUser", toSessionUser(user, c.env));
  return user;
}

function requireAdmin(sessionUser: SessionUser) {
  if (!sessionUser.isAdmin) {
    throw new HTTPException(403, { message: "Admin only" });
  }
}

async function requireOxenKey(user: UserRow, env: Env): Promise<string> {
  const key = await getOxenKey(user, env.ENCRYPTION_KEY);
  if (!key) {
    throw new HTTPException(400, {
      message: "Add your Oxen API key in Settings before generating",
    });
  }
  return key;
}

function publicOrigin(c: { req: { url: string }; env: Env }): string {
  if (c.env.PUBLIC_BASE_URL) return c.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  return new URL(c.req.url).origin;
}

function isSecureRequest(c: { req: { url: string }; env: Env }): boolean {
  return publicOrigin(c).startsWith("https://");
}

async function signInWithLocalGithub(c: Context<{ Bindings: Env; Variables: Variables }>) {
  const host = new URL(c.req.url).hostname;
  if (!isLoopbackHost(host)) {
    throw new HTTPException(500, {
      message: "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.",
    });
  }
  const token = c.env.GH_TOKEN?.trim();
  if (!token) {
    return c.html(
      `<!doctype html><html><body style="font-family:system-ui;background:#f6f5f2;color:#1c1b19;padding:3rem;max-width:40rem">
        <h1>GitHub sign-in isn’t set up</h1>
        <p>There is no OAuth app yet, so GitHub returns a 404 for a placeholder client id.</p>
        <p>For local use, run <code>gh auth login</code>, then restart the dev server so <code>GH_TOKEN</code> is available.</p>
        <p><a href="/" style="color:#1d4e89">Back</a></p>
      </body></html>`,
      500,
    );
  }

  const ghUser = await fetchGithubUser(token);
  const access = await userHasAccess(c.env.DB, ghUser, token, c.env);
  if (!access.allowed) {
    return c.html(
      `<!doctype html><html><body style="font-family:system-ui;background:#f6f5f2;color:#1c1b19;padding:3rem">
        <h1>Access denied</h1>
        <p>${access.reason ?? "You are not allowed to use Oxen Studio."}</p>
        <p>Add <strong>${ghUser.login}</strong> to <code>GITHUB_ADMINS</code> in <code>.dev.vars</code>.</p>
        <p><a href="/" style="color:#1d4e89">Back</a></p>
      </body></html>`,
      403,
    );
  }

  const user = await upsertUser(c.env.DB, {
    githubId: ghUser.id,
    login: ghUser.login,
    name: ghUser.name,
    avatarUrl: ghUser.avatar_url,
  });
  const ttl = Number(c.env.SESSION_TTL_SECONDS || 604800);
  const sealed = await sealGithubToken(token, c.env.ENCRYPTION_KEY);
  const sessionId = await createSession(c.env.DB, user.id, ttl, sealed);
  setCookie(c, SESSION_COOKIE, sessionId, sessionCookieOptions(ttl, isSecureRequest(c)));
  return c.redirect("/");
}

function fallbackModels(mode: GenerationMode): OxenModel[] {
  const catalog: Record<GenerationMode, OxenModel[]> = {
    "text-to-image": [
      {
        id: "black-forest-labs-flux-2-klein-4b",
        display_name: "FLUX.2 Klein 4B",
        endpoint: "/images/generate",
        capabilities: { input: ["text"], output: ["image"] },
      },
      {
        id: "gpt-image-2-5-flare",
        display_name: "GPT Image 2.5 Flare",
        endpoint: "/images/edit",
        capabilities: { input: ["text", "image"], output: ["image"] },
      },
      {
        id: "gpt-image-2-5-sunburst",
        display_name: "GPT Image 2.5 Sunburst",
        endpoint: "/images/edit",
        capabilities: { input: ["text", "image"], output: ["image"] },
      },
      {
        id: "bytedance-seedream-5-lite",
        display_name: "Seedream 5.0 Lite",
        endpoint: "/images/edit",
        capabilities: { input: ["text", "image"], output: ["image"] },
      },
      {
        id: "bytedance-seedream-5-pro",
        display_name: "Seedream 5.0 Pro",
        endpoint: "/images/edit",
        capabilities: { input: ["text", "image"], output: ["image"] },
      },
      {
        id: "bytedance-seedream-5-0-lite",
        display_name: "Seedream 5.0 Lite",
        endpoint: "/images/generate",
        capabilities: { input: ["text"], output: ["image"] },
      },
      {
        id: "bytedance-seedream-5-0-pro",
        display_name: "Seedream 5.0 Pro",
        endpoint: "/images/generate",
        capabilities: { input: ["text"], output: ["image"] },
      },
    ],
    "image-to-image": [
      {
        id: "qwen-image-edit",
        display_name: "Qwen Image Edit",
        endpoint: "/images/edit",
        capabilities: { input: ["text", "image"], output: ["image"] },
      },
      {
        id: "bytedance-seedream-5-lite",
        display_name: "Seedream 5.0 Lite",
        endpoint: "/images/edit",
        capabilities: { input: ["text", "image"], output: ["image"] },
      },
      {
        id: "bytedance-seedream-5-pro",
        display_name: "Seedream 5.0 Pro",
        endpoint: "/images/edit",
        capabilities: { input: ["text", "image"], output: ["image"] },
      },
      {
        id: "gpt-image-2-5-flare",
        display_name: "GPT Image 2.5 Flare",
        endpoint: "/images/edit",
        capabilities: { input: ["text", "image"], output: ["image"] },
      },
      {
        id: "gpt-image-2-5-sunburst",
        display_name: "GPT Image 2.5 Sunburst",
        endpoint: "/images/edit",
        capabilities: { input: ["text", "image"], output: ["image"] },
      },
    ],
    "text-to-video": [
      {
        id: "kling-video-v2-6-pro-text-to-video",
        display_name: "Kling v2.6 Pro Text-to-Video",
        endpoint: "/videos/generate",
        capabilities: { input: ["text"], output: ["video"] },
      },
      {
        id: "bytedance-seedance-2-5-text-to-video",
        display_name: "Seedance 2.5 Text-to-Video",
        endpoint: "/videos/generate",
        capabilities: { input: ["text"], output: ["video"] },
      },
      {
        id: "wan-3-0",
        display_name: "Wan 3.0",
        endpoint: "/videos/generate",
        capabilities: { input: ["text"], output: ["video"] },
      },
      flux3VideoModel,
    ],
    "reference-to-video": [
      {
        id: "kling-video-o3-pro-reference-to-video",
        display_name: "Kling O3 Pro Reference-to-Video",
        endpoint: "/videos/generate",
        capabilities: { input: ["text", "image"], output: ["video"] },
      },
      {
        id: "bytedance-seedance-2-0-reference-to-video",
        display_name: "Seedance 2.0 Reference-to-Video",
        endpoint: "/videos/generate",
        capabilities: { input: ["text", "image"], output: ["video"] },
      },
      {
        id: "kling-video-v2-6-pro-image-to-video",
        display_name: "Kling v2.6 Pro Image-to-Video",
        endpoint: "/videos/generate",
        capabilities: { input: ["text", "image"], output: ["video"] },
      },
      {
        id: "bytedance-seedance-2-5-image-to-video",
        display_name: "Seedance 2.5 Image-to-Video",
        endpoint: "/videos/generate",
        capabilities: { input: ["text", "image", "audio"], output: ["video"] },
      },
      {
        id: "bytedance-seedance-2-5-reference-to-video",
        display_name: "Seedance 2.5 Reference-to-Video",
        endpoint: "/videos/generate",
        capabilities: { input: ["text", "image", "video", "audio"], output: ["video"] },
      },
      {
        id: "kling-video-v3-pro-motion-control",
        display_name: "Kling 3.0 Pro Motion Control",
        endpoint: "/videos/generate",
        capabilities: { input: ["text", "image", "video"], output: ["video"] },
      },
      {
        id: "wan-3-0",
        display_name: "Wan 3.0",
        endpoint: "/videos/generate",
        capabilities: { input: ["text"], output: ["video"] },
      },
      {
        id: "wan-3-0-prime",
        display_name: "Wan 3.0 Prime",
        endpoint: "/videos/generate",
        capabilities: { input: ["text", "image"], output: ["video"] },
      },
      flux3VideoModel,
    ],
    "video-to-video": [
      {
        id: "kling-video-o3-pro-video-to-video-edit",
        display_name: "Kling O3 Pro Video-to-Video Edit",
        endpoint: "/videos/generate",
        capabilities: { input: ["text", "video", "image"], output: ["video"] },
      },
      {
        id: "bytedance-seedance-2-5-reference-to-video",
        display_name: "Seedance 2.5 Reference-to-Video",
        endpoint: "/videos/generate",
        capabilities: { input: ["text", "image", "video", "audio"], output: ["video"] },
      },
      {
        id: "kling-video-v3-pro-motion-control",
        display_name: "Kling 3.0 Pro Motion Control",
        endpoint: "/videos/generate",
        capabilities: { input: ["text", "image", "video"], output: ["video"] },
      },
      flux3VideoModel,
    ],
    "text-to-audio": [seedAudioModel],
  };
  return catalog[mode];
}

function featuredVideoFallbacks(mode: GenerationMode): OxenModel[] {
  const featured = new Set([
    "bytedance-seedance-2-5-text-to-video",
    "bytedance-seedance-2-5-image-to-video",
    "bytedance-seedance-2-5-reference-to-video",
    "kling-video-v3-pro-motion-control",
    "wan-3-0",
    "wan-3-0-prime",
    "flux-3-video",
  ]);
  return fallbackModels(mode).filter((model) => featured.has(model.id));
}

function fallbackModelsFor(mode: GenerationMode | null): OxenModel[] {
  if (mode) return fallbackModels(mode);
  return GENERATION_MODES.reduce(
    (models, item) => unionModelsById(models, fallbackModels(item)),
    [] as OxenModel[],
  );
}

function catalogForMode(all: OxenModel[], mode: GenerationMode | null): OxenModel[] {
  if (!mode) return all.filter(isMediaGenerationModel);
  return unionModelsById(filterModelsForMode(all, mode), featuredVideoFallbacks(mode));
}

type GenerationRow = {
  id: string;
  user_id?: string;
  oxen_generation_id: string;
  mode: string;
  model: string;
  prompt: string | null;
  status: string;
  media_type: string | null;
  result_url: string | null;
  result_key?: string | null;
  thumb_key?: string | null;
  last_frame_key?: string | null;
  params_json?: string | null;
  error_message: string | null;
  batch_id?: string | null;
  created_at: number;
  updated_at: number;
};

async function displayResultUrl(
  env: Env,
  resultKey: string | null | undefined,
  resultUrl: string | null,
): Promise<string | null> {
  return displayStoredMediaUrl(env, resultKey, resultUrl);
}

function toGenerationJson(
  row: GenerationRow,
  resultUrl: string | null,
  extras?: {
    status?: string;
    errorMessage?: string | null;
    updatedAt?: number;
    enqueuedAt?: number | null;
    startedAt?: number | null;
    etaSeconds?: number | null;
    progress?: number | null;
    typicalSeconds?: number | null;
    tags?: string[];
    thumbUrl?: string | null;
    lastFrameUrl?: string | null;
  },
) {
  return {
    id: row.id,
    oxenGenerationId: row.oxen_generation_id,
    mode: row.mode,
    model: row.model,
    prompt: row.prompt,
    status: extras?.status ?? row.status,
    mediaType: row.media_type,
    resultUrl,
    thumbUrl: extras?.thumbUrl ?? null,
    captureLastFrame: captureLastFrameRequested(row.params_json),
    lastFrameUrl: extras?.lastFrameUrl ?? null,
    errorMessage: presentGenerationError(
      extras?.errorMessage === undefined ? row.error_message : extras.errorMessage,
    ),
    batchId: row.batch_id ?? null,
    createdAt: row.created_at,
    updatedAt: extras?.updatedAt ?? row.updated_at,
    enqueuedAt: extras?.enqueuedAt ?? null,
    startedAt: extras?.startedAt ?? null,
    etaSeconds: extras?.etaSeconds ?? null,
    progress: extras?.progress ?? null,
    typicalSeconds: extras?.typicalSeconds ?? null,
    tags: extras?.tags ?? [],
  };
}

function shouldPollOxen(
  status: string,
  resultUrl: string | null,
  resultKey: string | null | undefined,
  pollActive: boolean,
): boolean {
  if (status === "failed" || status === "cancelled") return false;
  if (status === "succeeded") return !resultUrl && !resultKey;
  return pollActive;
}

async function tagsByGeneration(
  env: Env,
  userId: string,
  generationIds?: string[],
): Promise<Map<string, string[]>> {
  if (generationIds && generationIds.length === 0) return new Map();
  try {
    const rows =
      generationIds && generationIds.length > 0
        ? await env.DB.prepare(
            `SELECT generation_id as generationId, tag
             FROM generation_tags
             WHERE user_id = ? AND generation_id IN (${generationIds.map(() => "?").join(",")})
             ORDER BY created_at ASC`,
          )
            .bind(userId, ...generationIds)
            .all<{ generationId: string; tag: string }>()
        : await env.DB.prepare(
            `SELECT generation_id as generationId, tag
             FROM generation_tags
             WHERE user_id = ?
             ORDER BY created_at ASC`,
          )
            .bind(userId)
            .all<{ generationId: string; tag: string }>();
    const map = new Map<string, string[]>();
    for (const row of rows.results ?? []) {
      const list = map.get(row.generationId) ?? [];
      list.push(row.tag);
      map.set(row.generationId, list);
    }
    return map;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("generation_tags") || message.includes("SQLITE_ERROR")) {
      console.error("generation_tags missing; apply migrations/0004_generation_tags.sql");
      return new Map();
    }
    throw err;
  }
}

async function replaceGenerationTags(
  env: Env,
  userId: string,
  generationId: string,
  tags: string[],
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const statements = [
    env.DB.prepare(`DELETE FROM generation_tags WHERE generation_id = ? AND user_id = ?`).bind(
      generationId,
      userId,
    ),
    ...tags.map((tag) =>
      env.DB.prepare(
        `INSERT INTO generation_tags (generation_id, user_id, tag, created_at) VALUES (?, ?, ?, ?)`,
      ).bind(generationId, userId, tag, now),
    ),
  ];
  await env.DB.batch(statements);
}

async function typicalWaitByMedia(
  env: Env,
  userId: string,
): Promise<Record<string, number>> {
  const rows = await env.DB.prepare(
    `SELECT media_type as mediaType, AVG(updated_at - created_at) as avgSecs
     FROM generations
     WHERE user_id = ? AND status = 'succeeded' AND media_type IN ('image', 'video', 'audio')
       AND updated_at > created_at
     GROUP BY media_type`,
  )
    .bind(userId)
    .all<{ mediaType: string; avgSecs: number }>();
  const out: Record<string, number> = {};
  for (const row of rows.results ?? []) {
    if (!row.mediaType || !Number.isFinite(row.avgSecs)) continue;
    const clamped =
      row.mediaType === "video"
        ? Math.min(900, Math.max(30, row.avgSecs))
        : Math.min(120, Math.max(5, row.avgSecs));
    out[row.mediaType] = Math.round(clamped);
  }
  return out;
}

function generationListQuery(scope: GenerationListScope): string {
  switch (scope) {
    case "active":
      return `SELECT * FROM generations WHERE user_id = ? AND status NOT IN ('succeeded', 'failed', 'cancelled') ORDER BY created_at DESC LIMIT 50`;
    case "library":
      return `SELECT * FROM generations WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`;
    default: {
      const _never: never = scope;
      throw new Error(`Unhandled generation list scope: ${_never}`);
    }
  }
}

/** One file per library open. Archiving the whole page inline held the response for minutes. */
const LIBRARY_ARCHIVE_LIMIT = 1;

async function archiveMissingLibraryResults(
  env: Env,
  userId: string,
  apiKey: string,
): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT * FROM generations
     WHERE user_id = ? AND status = 'succeeded'
       AND result_url IS NOT NULL AND (result_key IS NULL OR result_key = '')
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(userId, LIBRARY_ARCHIVE_LIMIT)
    .all<GenerationRow>();
  for (const row of rows.results ?? []) {
    await syncGenerationRow(env, userId, apiKey, row, {
      persistMissing: true,
      pollActive: false,
    });
  }
}

async function persistOxenResult(
  env: Env,
  userId: string,
  apiKey: string,
  resultUrl: string,
): Promise<{ resultKey: string; thumbKey: string | null; oxenUrl: string }> {
  const { bytes, contentType } = await downloadOxenResult(apiKey, resultUrl);
  const { key } = await putMediaObject(env.MEDIA, bytes, contentType, `u/${userId}/results`);
  let thumbKey: string | null = null;
  const thumb = await createImageThumbnail(env.IMAGES, bytes, contentType);
  if (thumb) {
    const stored = await putMediaObject(
      env.MEDIA,
      thumb.bytes,
      thumb.contentType,
      `u/${userId}/thumbs`,
    );
    thumbKey = stored.key;
  }
  return { resultKey: key, thumbKey, oxenUrl: resultUrl };
}

async function writeGenerationRow(
  env: Env,
  row: {
    id: string;
    status: string;
    resultUrl: string | null;
    resultKey: string | null;
    thumbKey: string | null;
    errorMessage: string | null;
    updatedAt: number;
  },
) {
  try {
    await env.DB.prepare(
      `UPDATE generations SET status = ?, result_url = ?, result_key = ?, thumb_key = ?, error_message = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(
        row.status,
        row.resultUrl,
        row.resultKey,
        row.thumbKey,
        row.errorMessage,
        row.updatedAt,
        row.id,
      )
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("thumb_key") && !message.includes("SQLITE_ERROR")) throw err;
    await env.DB.prepare(
      `UPDATE generations SET status = ?, result_url = ?, result_key = ?, error_message = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(row.status, row.resultUrl, row.resultKey, row.errorMessage, row.updatedAt, row.id)
      .run();
  }
}

async function syncGenerationRow(
  env: Env,
  userId: string,
  apiKey: string | null,
  row: GenerationRow,
  options: {
    persistMissing: boolean;
    pollActive: boolean;
    typicalSeconds?: number | null;
    tags?: string[];
  },
) {
  let status = row.status;
  let resultUrl = row.result_url;
  let resultKey = row.result_key ?? null;
  let thumbKey = row.thumb_key ?? null;
  let errorMessage = row.error_message;
  let updatedAt = row.updated_at;
  let dirty = false;
  let enqueuedAt: number | null = null;
  let startedAt: number | null = null;
  let etaSeconds: number | null = null;
  let progress: number | null = null;

  if (apiKey && shouldPollOxen(status, resultUrl, resultKey, options.pollActive)) {
    try {
      const remote = await getGeneration(apiKey, row.oxen_generation_id);
      resetPollFailures(row.id);
      status = String(remote.status ?? status);
      resultUrl = extractResultUrl(remote) ?? resultUrl;
      const timing = extractOxenTiming(remote);
      enqueuedAt = timing.enqueuedAt;
      startedAt = timing.startedAt;
      etaSeconds = timing.etaSeconds;
      progress = timing.progress;
      const remoteError = extractOxenErrorMessage(remote);
      if (status === "failed") {
        errorMessage = remoteError ?? errorMessage ?? "Oxen generation failed";
      } else {
        errorMessage = remoteError;
      }
      dirty = true;
    } catch (err) {
      console.error("poll error", err);
      const failures = notePollFailure(row.id);
      if (shouldPersistPollFailure(failures)) {
        errorMessage = pollErrorMessage(err);
        dirty = true;
      }
    }
  }

  if (apiKey && options.persistMissing && status === "succeeded" && resultUrl && !resultKey) {
    try {
      const persisted = await persistOxenResult(env, userId, apiKey, resultUrl);
      resultKey = persisted.resultKey;
      thumbKey = persisted.thumbKey ?? thumbKey;
      resultUrl = persisted.oxenUrl;
      dirty = true;
    } catch (err) {
      console.error("result persist error", err);
    }
  }

  if (dirty) {
    updatedAt = Math.floor(Date.now() / 1000);
    await writeGenerationRow(env, {
      id: row.id,
      status,
      resultUrl,
      resultKey,
      thumbKey,
      errorMessage,
      updatedAt,
    });
    await notifyGenerationComplete(env, userId, row.status, {
      id: row.id,
      status,
      prompt: row.prompt,
      mediaType: row.media_type,
      errorMessage,
    });
  }

  const [displayUrl, thumbUrl, lastFrameUrl] = await Promise.all([
    displayResultUrl(env, resultKey, resultUrl),
    displayStoredMediaUrl(env, thumbKey, null),
    displayStoredMediaUrl(env, row.last_frame_key, null),
  ]);
  return toGenerationJson(row, displayUrl, {
    status,
    errorMessage,
    updatedAt,
    enqueuedAt,
    startedAt,
    etaSeconds,
    progress,
    typicalSeconds: options.typicalSeconds ?? null,
    tags: options.tags ?? [],
    thumbUrl,
    lastFrameUrl,
  });
}

app.get("/api/health", (c) => c.json({ ok: true, service: "oxen-studio" }));

app.get("/api/auth/me", async (c) => {
  try {
    await requireUser(c);
    return c.json({ user: c.get("sessionUser") });
  } catch {
    return c.json({ user: null });
  }
});

app.get("/api/auth/config", (c) => {
  const oauth = oauthConfigured(c.env);
  const org = c.env.GITHUB_ORG?.trim() || null;
  return c.json({
    mode: oauth ? "oauth" : "local",
    org,
  });
});

app.get("/api/auth/github", async (c) => {
  if (!oauthConfigured(c.env)) {
    return signInWithLocalGithub(c);
  }
  const redirectUri = `${publicOrigin(c)}/api/auth/callback`;
  const state = crypto.randomUUID();
  setCookie(c, "oauth_state", state, {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: "Lax",
    path: "/",
    maxAge: 600,
  });
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "read:user read:org");
  url.searchParams.set("state", state);
  return c.redirect(url.toString());
});

app.get("/api/auth/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const stored = getCookie(c, "oauth_state");
  deleteCookie(c, "oauth_state", { path: "/" });

  if (!code || !state || !stored || state !== stored) {
    throw new HTTPException(400, { message: "Invalid OAuth state" });
  }

  const redirectUri = `${publicOrigin(c)}/api/auth/callback`;
  const accessToken = await exchangeGithubCode(code, c.env, redirectUri);
  const ghUser = await fetchGithubUser(accessToken);
  const access = await userHasAccess(c.env.DB, ghUser, accessToken, c.env);
  if (!access.allowed) {
    return c.html(
      `<!doctype html><html><body style="font-family:system-ui;background:#f6f5f2;color:#1c1b19;padding:3rem">
        <h1>Access denied</h1>
        <p>${access.reason ?? "You are not allowed to use Oxen Studio."}</p>
        <p>Ask an admin to add <strong>${ghUser.login}</strong> to the allowlist, or join the ${c.env.GITHUB_ORG} org.</p>
        <p><a href="/" style="color:#1d4e89">Back</a></p>
      </body></html>`,
      403,
    );
  }

  const user = await upsertUser(c.env.DB, {
    githubId: ghUser.id,
    login: ghUser.login,
    name: ghUser.name,
    avatarUrl: ghUser.avatar_url,
  });
  const ttl = Number(c.env.SESSION_TTL_SECONDS || 604800);
  const sealed = await sealGithubToken(accessToken, c.env.ENCRYPTION_KEY);
  const sessionId = await createSession(c.env.DB, user.id, ttl, sealed);
  setCookie(c, SESSION_COOKIE, sessionId, sessionCookieOptions(ttl, isSecureRequest(c)));
  return c.redirect("/");
});

app.post("/api/auth/logout", async (c) => {
  const sessionId = getSessionId(c.req.header("Cookie"));
  if (sessionId) {
    await deleteSession(c.env.DB, sessionId);
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.get("/api/settings/oxen-key", async (c) => {
  await requireUser(c);
  return c.json({ hasOxenKey: c.get("sessionUser").hasOxenKey });
});

app.put("/api/settings/oxen-key", async (c) => {
  const user = await requireUser(c);
  const body = await c.req.json<{ apiKey?: string }>();
  const apiKey = body.apiKey?.trim();
  if (!apiKey) {
    throw new HTTPException(400, { message: "apiKey is required" });
  }
  if (!c.env.ENCRYPTION_KEY) {
    throw new HTTPException(500, { message: "ENCRYPTION_KEY is not configured" });
  }
  await saveOxenKey(c.env.DB, user.id, apiKey, c.env.ENCRYPTION_KEY);
  return c.json({ ok: true, hasOxenKey: true });
});

app.delete("/api/settings/oxen-key", async (c) => {
  const user = await requireUser(c);
  await clearOxenKey(c.env.DB, user.id);
  return c.json({ ok: true, hasOxenKey: false });
});

/** GITHUB_ADMINS may hold account ids; show the login of anyone who has signed in. */
async function adminDisplayNames(env: Env): Promise<string[]> {
  const entries = (env.GITHUB_ADMINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return Promise.all(
    entries.map(async (entry) => {
      if (!isNumericAdminEntry(entry)) return entry;
      const row = await env.DB.prepare(`SELECT login FROM users WHERE github_id = ?`)
        .bind(Number(entry))
        .first<{ login: string }>();
      return row?.login ?? entry;
    }),
  );
}

app.get("/manifest.webmanifest", async (c) => {
  const branding = await readInstanceBranding(c.env.DB);
  const body = {
    name: branding.name,
    short_name: branding.name,
    description: "Image and video generation",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f6f5f2",
    theme_color: "#f6f5f2",
    icons: [
      {
        src: branding.logoUrl,
        sizes: "any",
        type: branding.logoType,
        purpose: "any",
      },
    ],
  };
  return c.body(JSON.stringify(body), 200, {
    "Content-Type": "application/manifest+json; charset=utf-8",
    "Cache-Control": "no-cache",
  });
});

app.get("/api/branding", async (c) => {
  return c.json(await readInstanceBranding(c.env.DB));
});

app.put("/api/branding", async (c) => {
  await requireUser(c);
  requireAdmin(c.get("sessionUser"));
  const body = await c.req.json<{ name?: unknown; clearLogo?: unknown }>();
  const parsed = normalizeSiteName(body.name);
  if (!parsed.ok) throw new HTTPException(400, { message: parsed.error });
  const branding = await saveInstanceBranding(c.env.DB, c.env.MEDIA, {
    name: parsed.name,
    clearLogo: body.clearLogo === true,
  });
  return c.json(branding);
});

app.put("/api/branding/logo", async (c) => {
  await requireUser(c);
  requireAdmin(c.get("sessionUser"));
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const accepted = acceptLogoBytes(bytes);
  if ("error" in accepted) throw new HTTPException(400, { message: accepted.error });
  const branding = await saveInstanceLogo(c.env.DB, c.env.MEDIA, bytes, accepted.contentType);
  return c.json(branding);
});

app.get("/api/branding/logo", async (c) => {
  const object = await c.env.MEDIA.get(INSTANCE_LOGO_KEY);
  if (!object) throw new HTTPException(404, { message: "No custom logo" });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.get("Content-Type")) headers.set("Content-Type", "application/octet-stream");
  headers.set("Cache-Control", "public, max-age=300");
  const bytes = new Uint8Array(await object.arrayBuffer());
  const type = headers.get("Content-Type") ?? "";
  if (type.includes("png") || isPng(bytes)) {
    try {
      const framed = await frameLogoPng(bytes);
      if (framed) {
        headers.set("Content-Type", "image/png");
        return new Response(framed, { headers });
      }
    } catch (err) {
      console.error("logo frame error", err);
    }
  }
  return new Response(bytes, { headers });
});

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 8 &&
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71
  );
}

app.get("/api/admin/allowlist", async (c) => {
  await requireUser(c);
  requireAdmin(c.get("sessionUser"));
  const rows = await c.env.DB.prepare(
    `SELECT github_login, added_by, created_at FROM allowlist ORDER BY github_login COLLATE NOCASE`,
  ).all<{ github_login: string; added_by: string | null; created_at: number }>();
  return c.json({
    org: c.env.GITHUB_ORG,
    admins: await adminDisplayNames(c.env),
    allowlist: rows.results ?? [],
  });
});

app.post("/api/admin/allowlist", async (c) => {
  await requireUser(c);
  requireAdmin(c.get("sessionUser"));
  const body = await c.req.json<{ login?: string }>();
  const login = body.login?.trim().replace(/^@/, "");
  if (!login) {
    throw new HTTPException(400, { message: "login is required" });
  }
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    `INSERT INTO allowlist (github_login, added_by, created_at) VALUES (?, ?, ?)
     ON CONFLICT(github_login) DO UPDATE SET added_by = excluded.added_by`,
  )
    .bind(login, c.get("sessionUser").login, now)
    .run();
  return c.json({ ok: true, login });
});

app.delete("/api/admin/allowlist/:login", async (c) => {
  await requireUser(c);
  requireAdmin(c.get("sessionUser"));
  const login = c.req.param("login");
  await deleteSessionsForAllowlistLogin(c.env.DB, login);
  await c.env.DB.prepare(`DELETE FROM allowlist WHERE github_login = ? COLLATE NOCASE`)
    .bind(login)
    .run();
  return c.json({ ok: true });
});

app.get("/api/settings/studio", async (c) => {
  const user = await requireUser(c);
  const settings = await getStudioSettings(c.env.DB, user.id);
  return c.json(settings);
});

app.put("/api/settings/studio", async (c) => {
  const user = await requireUser(c);
  const body = await c.req.json<{
    defaultModelByMode?: Partial<Record<GenerationMode, string>>;
    lastParams?: Record<string, unknown>;
  }>();
  const settings = await saveStudioSettings(c.env.DB, user.id, {
    defaultModelByMode: body.defaultModelByMode,
    lastParams: body.lastParams,
  });
  return c.json(settings);
});

app.get("/api/prompts", async (c) => {
  const user = await requireUser(c);
  const prompts = await listSavedPrompts(c.env.DB, user.id);
  return c.json({ prompts });
});

app.post("/api/prompts", async (c) => {
  const user = await requireUser(c);
  const body = await c.req.json<{ name?: unknown; body?: unknown }>();
  const prompt = await saveSavedPrompt(c.env.DB, user.id, { name: body.name, body: body.body });
  if (!prompt) {
    throw new HTTPException(400, { message: "Prompt needs a name and text" });
  }
  return c.json({ prompt });
});

app.patch("/api/prompts/:id", async (c) => {
  const user = await requireUser(c);
  const body = await c.req.json<{ name?: unknown; body?: unknown }>();
  const result = await updateSavedPrompt(c.env.DB, user.id, c.req.param("id"), {
    name: body.name,
    body: body.body,
  });
  if ("error" in result) {
    throw new HTTPException(result.error === "missing" ? 404 : 400, {
      message: result.error === "missing" ? "Saved prompt not found" : "Prompt needs a name and text",
    });
  }
  return c.json({ prompt: result.prompt });
});

app.delete("/api/prompts/:id", async (c) => {
  const user = await requireUser(c);
  const removed = await deleteSavedPrompt(c.env.DB, user.id, c.req.param("id"));
  if (!removed) {
    throw new HTTPException(404, { message: "Saved prompt not found" });
  }
  return c.json({ ok: true });
});

async function galleryResponse(
  env: Env,
  gallery: NonNullable<Awaited<ReturnType<typeof getGallery>>>,
) {
  const items = await Promise.all(
    gallery.items.map(async (item) => ({
      id: item.id,
      kind: item.kind,
      name: item.name,
      key: item.key,
      url: (await displayStoredMediaUrl(env, item.key, null)) ?? "",
    })),
  );
  return { id: gallery.id, name: gallery.name, updatedAt: gallery.updatedAt, items };
}

app.get("/api/galleries", async (c) => {
  const user = await requireUser(c);
  const galleries = await listGalleries(c.env.DB, user.id, c.req.query("q") || "");
  return c.json({ galleries });
});

app.get("/api/galleries/:id", async (c) => {
  const user = await requireUser(c);
  const gallery = await getGallery(c.env.DB, user.id, c.req.param("id"));
  if (!gallery) {
    throw new HTTPException(404, { message: "Gallery not found" });
  }
  return c.json({ gallery: await galleryResponse(c.env, gallery) });
});

app.post("/api/galleries", async (c) => {
  const user = await requireUser(c);
  const body = await c.req.json<{ id?: unknown; name?: unknown; items?: unknown }>();
  const id = typeof body.id === "string" ? body.id : null;
  const gallery = await saveGallery(c.env.DB, user.id, {
    id,
    name: body.name,
    items: body.items,
  });
  if (!gallery) {
    const named = acceptGalleryName(body.name);
    const items = acceptGalleryItems(user.id, body.items);
    if (id && named && items) {
      throw new HTTPException(404, { message: "Gallery not found" });
    }
    throw new HTTPException(400, { message: "Gallery needs a name and media that belong to you" });
  }
  return c.json({ gallery: await galleryResponse(c.env, gallery) });
});

app.get("/api/models/favorites", async (c) => {
  const user = await requireUser(c);
  const apiKey = await requireOxenKey(user, c.env);
  const models = await listFavoriteModels(apiKey);
  return c.json({ models });
});

app.post("/api/models/:id/favorite", async (c) => {
  const user = await requireUser(c);
  const apiKey = await requireOxenKey(user, c.env);
  await favoriteModel(apiKey, c.req.param("id"));
  return c.json({ ok: true });
});

app.delete("/api/models/:id/favorite", async (c) => {
  const user = await requireUser(c);
  const apiKey = await requireOxenKey(user, c.env);
  await unfavoriteModel(apiKey, c.req.param("id"));
  return c.json({ ok: true });
});

app.get("/api/models/search", async (c) => {
  const user = await requireUser(c);
  const mode = c.req.query("mode") as GenerationMode | undefined;
  if (mode && !(mode in MODE_META)) {
    throw new HTTPException(400, { message: "Invalid mode" });
  }
  const query = (c.req.query("q") || "").trim();
  if (!query) return c.json({ mode: mode ?? null, models: [] });
  const apiKey = await requireOxenKey(user, c.env);
  const found = await searchModels(apiKey, query);
  return c.json({
    mode: mode ?? null,
    models: mode ? filterModelsForMode(found, mode) : found.filter(isMediaGenerationModel),
  });
});

app.get("/api/models/:id", async (c) => {
  const user = await requireUser(c);
  const apiKey = await requireOxenKey(user, c.env);
  const modelId = c.req.param("id");
  try {
    const model = await getModel(apiKey, modelId);
    return c.json({ model, controls: parseModelControls(model) });
  } catch (err) {
    // Generate already uses the bundled schema when live detail fails. The composer
    // needs the same controls, or a schema outage blanks every option.
    console.error("model schema error", err);
    const fallback = fallbackModelsFor(null).find((item) => item.id === modelId);
    if (fallback?.request_schema) {
      return c.json({ model: fallback, controls: parseModelControls(fallback) });
    }
    throw err;
  }
});

app.get("/api/models", async (c) => {
  const user = await requireUser(c);
  const modeQuery = c.req.query("mode");
  if (modeQuery && !(modeQuery in MODE_META)) {
    throw new HTTPException(400, { message: "Invalid mode" });
  }
  const mode = modeQuery && modeQuery in MODE_META ? (modeQuery as GenerationMode) : null;

  let models: OxenModel[] = [];
  try {
    const apiKey = await getOxenKey(user, c.env.ENCRYPTION_KEY);
    if (apiKey) {
      const all = await mergeMissingFeaturedModels(apiKey, await listModels(apiKey));
      models = catalogForMode(all, mode);
    }
  } catch (err) {
    console.error("model list error", err);
  }

  if (models.length === 0) {
    models = fallbackModelsFor(mode);
  }

  return c.json({ mode, models });
});

app.get("/api/billing/credits", async (c) => {
  const user = await requireUser(c);
  const apiKey = await requireOxenKey(user, c.env);
  const remaining = await fetchOxenCredits(apiKey);
  return c.json(
    creditBalanceResponse(remaining, c.env.OXEN_BILLING_URL || OXEN_BILLING_URL),
  );
});

app.post("/api/upload", async (c) => {
  const user = await requireUser(c);
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new HTTPException(400, { message: "file is required" });
  }
  if (file.size > 80 * 1024 * 1024) {
    throw new HTTPException(400, { message: "File too large (max 80MB)" });
  }

  const buffer = await file.arrayBuffer();
  const contentType = sniffSafeMediaType(new Uint8Array(buffer));
  if (!contentType) {
    throw new HTTPException(400, { message: "Only image, video, and audio files are accepted" });
  }
  if (!(await reserveUploadBytes(c.env.DB, user.id, buffer.byteLength))) {
    throw new HTTPException(429, {
      message: "Daily upload limit reached (2 GB). Try again tomorrow.",
    });
  }
  const folder = form.get("folder");
  const prefix = folder === "galleries" ? `u/${user.id}/galleries` : `u/${user.id}`;
  const { key } = await putMediaObject(c.env.MEDIA, buffer, contentType, prefix);
  const secret = mediaSigningSecret(c.env);
  const { url } = await buildReferenceMediaUrl({
    publicBaseUrl: c.env.PUBLIC_BASE_URL,
    key,
    secret,
    bytes: buffer,
    contentType,
  });

  return c.json({ key, url, contentType, size: file.size, name: file.name });
});

app.get("/api/media/*", async (c) => {
  let key = c.req.path.replace(/^\/api\/media\//, "");
  try {
    key = decodeURIComponent(key);
  } catch {
    throw new HTTPException(400, { message: "Invalid media key" });
  }
  if (!key || key.includes("..")) {
    throw new HTTPException(400, { message: "Invalid media key" });
  }
  const exp = c.req.query("exp") || "";
  const sig = c.req.query("sig") || "";
  const ok = await verifyMediaSignature(key, exp, sig, mediaVerifySecrets(c.env));
  if (!ok) {
    throw new HTTPException(403, { message: "Invalid or expired media signature" });
  }
  const object = await c.env.MEDIA.get(key);
  if (!object) {
    throw new HTTPException(404, { message: "Not found" });
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  const storedType = object.httpMetadata?.contentType || guessMediaContentType(key);
  const served = mediaServeDisposition(storedType);
  headers.set("Content-Type", served.contentType);
  headers.set("Content-Disposition", served.disposition);
  headers.set("X-Content-Type-Options", "nosniff");
  if (typeof object.size === "number" && Number.isFinite(object.size)) {
    headers.set("Content-Length", String(object.size));
  }
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  const remaining = Number(exp) - Math.floor(Date.now() / 1000);
  headers.set(
    "Cache-Control",
    `public, max-age=${Math.max(0, remaining)}, immutable`,
  );
  return new Response(object.body, { headers });
});

app.post("/api/generate", async (c) => {
  const user = await requireUser(c);
  const apiKey = await requireOxenKey(user, c.env);
  const body = await c.req.json<{
    mode: GenerationMode;
    model: string;
    prompt?: string;
    aspect_ratio?: string;
    duration?: number | string;
    seed?: number;
    input_image?: string | string[];
    input_images?: string[];
    input_face_images?: string[];
    input_video?: string;
    input_videos?: string[];
    input_face_videos?: string[];
    input_audios?: string[];
    images?: string[];
    videos?: string[];
    audios?: string[];
    image_roles?: ("character" | "scene")[];
    video_roles?: ("character" | "scene")[];
    generate_audio?: boolean;
    draft?: boolean;
    get_last_frame?: boolean;
    num_generations?: number;
    quality?: string;
    resolution?: string;
    output_format?: string;
    background?: string;
    moderation?: string;
    safety_tolerance?: number | string;
    sample_rate?: number;
    speed?: number;
    volume?: number;
    pitch?: number;
    image_url?: string;
    audio_urls?: string[];
  }>();

  const mode = body.mode;
  if (!(mode in MODE_META)) {
    throw new HTTPException(400, { message: "Invalid mode" });
  }
  if (!body.model?.trim()) {
    throw new HTTPException(400, { message: "model is required" });
  }
  if (!body.prompt?.trim()) {
    throw new HTTPException(400, { message: "prompt is required" });
  }

  const meta = MODE_META[mode];
  const modelId = body.model.trim();
  let controls = parseModelControls({ id: modelId });
  let displayName: string | null = null;
  try {
    const detail = await getModel(apiKey, modelId);
    controls = parseModelControls(detail);
    displayName = detail.display_name ?? null;
  } catch (err) {
    console.error("model schema error", err);
    const fallback = fallbackModelsFor(null).find((item) => item.id === modelId);
    if (fallback?.request_schema) {
      controls = parseModelControls(fallback);
      displayName = fallback.display_name ?? null;
    }
  }

  const imageHasFace = controls.slots.some((slot) => slot.field === "input_face_images");
  const videoHasFace = controls.slots.some((slot) => slot.field === "input_face_videos");
  const imageRefs = collectOxenRefs([
    { urls: body.images ?? [], roles: body.image_roles, face: imageHasFace },
    {
      urls: Array.isArray(body.input_image)
        ? body.input_image
        : body.input_image
          ? [body.input_image]
          : [],
    },
    { urls: body.input_images ?? [] },
    { urls: body.input_face_images ?? [], face: true },
  ]);
  const videoRefs = collectOxenRefs([
    { urls: body.videos ?? [], roles: body.video_roles, face: videoHasFace },
    { urls: body.input_video ? [body.input_video] : [] },
    { urls: body.input_videos ?? [] },
    { urls: body.input_face_videos ?? [], face: true },
  ]);
  const signing = {
    publicBaseUrl: c.env.PUBLIC_BASE_URL,
    secret: mediaSigningSecret(c.env),
    verifySecrets: mediaVerifySecrets(c.env),
    userId: user.id,
  };
  let imageUrls: string[];
  let videoUrls: string[];
  let audioUrls: string[];
  try {
    imageUrls = await resolveRefsForOxen(
      c.env.MEDIA,
      imageRefs.urls,
      c.env.IMAGES,
      imageRefs.keepHttps,
      signing,
    );
    videoUrls = await resolveRefsForOxen(
      c.env.MEDIA,
      videoRefs.urls,
      c.env.IMAGES,
      videoRefs.keepHttps,
      signing,
    );
    audioUrls = await resolveRefsForOxen(
      c.env.MEDIA,
      [...(body.audios ?? []), ...(body.input_audios ?? [])].filter((url) => url.trim()),
      c.env.IMAGES,
      undefined,
      signing,
    );
  } catch (err) {
    if (err instanceof StudioMediaRefRejected) {
      throw new HTTPException(400, { message: err.message });
    }
    throw err;
  }

  const mapped =
    controls.slots.length > 0
      ? mapMediaUrls(
          controls.slots,
          {
            image: imageUrls,
            video: videoUrls,
            audio: audioUrls,
          },
          {
            image: body.image_roles,
            video: body.video_roles,
          },
        )
      : {};
  const useFallback = controls.slots.length === 0;

  const needsImage =
    imageSlotRequired(controls) ||
    (useFallback &&
      (mode === "image-to-image" || (mode === "reference-to-video" && Boolean(meta.needsImage))));
  const needsVideo =
    videoSlotRequired(controls) ||
    (useFallback && (mode === "video-to-video" || Boolean(meta.needsVideo)));

  if (needsImage && imageUrls.length === 0) {
    throw new HTTPException(400, { message: "input_image is required for this mode" });
  }
  if (needsVideo && videoUrls.length === 0) {
    throw new HTTPException(400, { message: "input_video is required for this mode" });
  }
  if (controls.imageVideoExclusive && imageUrls.length > 0 && videoUrls.length > 0) {
    throw new HTTPException(400, {
      message: "Keyframes and a continuation clip can’t be used together",
    });
  }
  if (controls.imageVideoExclusive && mode === "text-to-video" && (imageUrls.length > 0 || videoUrls.length > 0)) {
    throw new HTTPException(400, {
      message: "Text to video does not take keyframes or a continuation clip",
    });
  }
  if (controls.imageVideoExclusive && mode === "reference-to-video" && videoUrls.length > 0) {
    throw new HTTPException(400, {
      message: "Keyframes and a continuation clip can’t be used together",
    });
  }
  if (controls.imageVideoExclusive && mode === "video-to-video" && imageUrls.length > 0) {
    throw new HTTPException(400, {
      message: "Keyframes and a continuation clip can’t be used together",
    });
  }

  const rejectedMedia = unsupportedReferenceMessage(
    controls.slots,
    { image: imageUrls.length, video: videoUrls.length, audio: audioUrls.length },
    controls.imageAudioExclusive,
    controls.imageVideoExclusive,
  );
  if (rejectedMedia) {
    throw new HTTPException(400, { message: rejectedMedia });
  }

  const audioFieldUrls =
    asStringList(mapped.audio_urls) ??
    asStringList(mapped.input_audios) ??
    asStringList(mapped.input_audio) ??
    (useFallback && audioUrls.length > 0 ? audioUrls : undefined);
  const safetyTolerance = resolveSafetyTolerance(body.safety_tolerance, controls.safetyTolerance);
  const sampleRate = clampNumericControl(body.sample_rate, controls.sampleRate);
  const speed = clampNumericControl(body.speed, controls.speed);
  const volume = clampNumericControl(body.volume, controls.volume);
  const pitch = clampNumericControl(body.pitch, controls.pitch);

  const payload = buildEnqueuePayload(meta.mediaType, {
    model: modelId,
    prompt: body.prompt.trim(),
    aspect_ratio:
      meta.mediaType === "audio" && !controls.aspectRatios?.length
        ? undefined
        : resolveEnqueueAspectRatio(body.aspect_ratio, controls.aspectRatios),
    duration: controls.duration ? clampDuration(body.duration, controls.duration) : undefined,
    seed: controls.seed || useFallback ? body.seed : undefined,
    generate_audio:
      controls.generateAudio || useFallback
        ? typeof body.generate_audio === "boolean"
          ? body.generate_audio
          : (controls.generateAudioDefault ?? undefined)
        : undefined,
    draft: controls.draft ? body.draft === true : undefined,
    num_generations: body.num_generations,
    quality: pickCompatible(body.quality, controls.quality) ?? (useFallback ? body.quality : undefined),
    ...resolutionPayloadFields(
      controls.resolutionField,
      pickCompatible(body.resolution, controls.resolution) ??
        (useFallback ? body.resolution : undefined),
    ),
    output_format:
      pickCompatible(body.output_format, controls.outputFormat) ??
      (useFallback ? body.output_format : undefined),
    background:
      pickCompatible(body.background, controls.background) ??
      (useFallback ? body.background : undefined),
    moderation: controls.moderation || useFallback ? body.moderation : undefined,
    safety_tolerance: safetyTolerance,
    input_image:
      mapped.input_image ?? (useFallback && imageUrls.length === 1 ? imageUrls[0] : undefined),
    input_images:
      asStringList(mapped.input_images) ??
      (useFallback && imageUrls.length > 1 ? imageUrls : undefined),
    input_face_images: asStringList(mapped.input_face_images),
    input_video:
      asSingleString(mapped.input_video) ??
      (useFallback && videoUrls.length === 1 ? videoUrls[0] : undefined),
    input_videos:
      asStringList(mapped.input_videos) ??
      (useFallback && videoUrls.length > 1 ? videoUrls : undefined),
    input_face_videos: asStringList(mapped.input_face_videos),
    input_audios: meta.mediaType === "audio" ? undefined : audioFieldUrls,
    audio_urls: meta.mediaType === "audio" ? audioFieldUrls : undefined,
    image_url:
      meta.mediaType === "audio" ? asSingleString(mapped.image_url) : undefined,
    sample_rate: typeof sampleRate === "number" ? sampleRate : undefined,
    speed,
    volume,
    pitch,
  });
  const captureLastFrame =
    body.get_last_frame === true &&
    meta.mediaType === "video" &&
    showGetLastFrame({
      modelId: body.model.trim(),
      displayName,
      mode,
    });

  const generations = await enqueueGeneration(apiKey, payload);
  const now = Math.floor(Date.now() / 1000);
  const batchId = crypto.randomUUID();
  const saved = [];

  for (const gen of generations) {
    const id = crypto.randomUUID();
    const row = [
      id,
      user.id,
      gen.generation_id,
      mode,
      body.model.trim(),
      body.prompt.trim(),
      gen.status || "queued",
      meta.mediaType,
      generationParamsForStorage(payload, captureLastFrame),
      batchId,
      now,
      now,
    ] as const;
    try {
      await c.env.DB.prepare(
        `INSERT INTO generations
          (id, user_id, oxen_generation_id, mode, model, prompt, status, media_type, params_json, batch_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(...row)
        .run();
    } catch (err) {
      if (!isD1TooBig(err)) throw err;
      await c.env.DB.prepare(
        `INSERT INTO generations
          (id, user_id, oxen_generation_id, mode, model, prompt, status, media_type, params_json, batch_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          user.id,
          gen.generation_id,
          mode,
          body.model.trim(),
          body.prompt.trim(),
          gen.status || "queued",
          meta.mediaType,
          generationParamsForStorage({}, captureLastFrame),
          batchId,
          now,
          now,
        )
        .run();
    }
    saved.push({
      id,
      oxenGenerationId: gen.generation_id,
      mode,
      model: body.model.trim(),
      prompt: body.prompt.trim(),
      status: gen.status || "queued",
      mediaType: meta.mediaType,
      resultUrl: null as string | null,
      thumbUrl: null as string | null,
      captureLastFrame,
      lastFrameUrl: null as string | null,
      errorMessage: null as string | null,
      batchId,
      createdAt: now,
      updatedAt: now,
      enqueuedAt: now,
      startedAt: null as number | null,
      etaSeconds: null as number | null,
      progress: null as number | null,
      typicalSeconds: null as number | null,
      tags: [] as string[],
    });
  }

  try {
    await saveStudioSettings(c.env.DB, user.id, {
      lastParams: {
        aspect_ratio: body.aspect_ratio,
        duration: controls.duration ? clampDuration(body.duration, controls.duration) : undefined,
        seed: body.seed,
        generate_audio: body.generate_audio,
        quality: body.quality,
        resolution: body.resolution,
        output_format: body.output_format,
        background: body.background,
        safety_tolerance: safetyTolerance,
        sample_rate: typeof sampleRate === "number" ? sampleRate : undefined,
        speed,
        volume,
        pitch,
      },
    });
  } catch (err) {
    console.error("settings persist error", err);
  }

  return c.json({ generations: saved });
});

function runInBackground(c: Context<{ Bindings: Env; Variables: Variables }>, work: Promise<unknown>) {
  const task = work.catch((err) => {
    console.error("background task error", err);
  });
  try {
    c.executionCtx.waitUntil(task);
  } catch {
    /* unit tests call app.request without an execution context */
  }
}

app.get("/api/generations", async (c) => {
  const user = await requireUser(c);
  const scope = parseGenerationListScope(c.req.query("scope"));
  if (!scope) {
    throw new HTTPException(400, { message: "Invalid generation list scope" });
  }
  const sql = generationListQuery(scope);
  const apiKey = await getOxenKey(user, c.env.ENCRYPTION_KEY);
  const rows = await c.env.DB.prepare(sql).bind(user.id).all<GenerationRow>();

  const typicals = await typicalWaitByMedia(c.env, user.id);
  const tagMap = await tagsByGeneration(
    c.env,
    user.id,
    (rows.results ?? []).map((row) => row.id),
  );
  const generations = await Promise.all(
    (rows.results ?? []).map((row) =>
      syncGenerationRow(c.env, user.id, apiKey, row, {
        persistMissing: false,
        pollActive: false,
        typicalSeconds: row.media_type ? typicals[row.media_type] ?? null : null,
        tags: tagMap.get(row.id) ?? [],
      }),
    ),
  );

  if (scope === "library") {
    runInBackground(c, backfillMissingThumbnails(c.env, user.id));
    if (apiKey) runInBackground(c, archiveMissingLibraryResults(c.env, user.id, apiKey));
  }

  return c.json({ generations });
});

app.post("/api/generations/:id/last-frame", async (c) => {
  const user = await requireUser(c);
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(`SELECT * FROM generations WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .first<GenerationRow>();
  if (!row) {
    throw new HTTPException(404, { message: "Generation not found" });
  }
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new HTTPException(400, { message: "file is required" });
  }
  const bytes = await file.arrayBuffer();
  const contentType = sniffImageContentType(new Uint8Array(bytes.slice(0, 12)), file.type || "");
  const reason = rejectLastFrameUpload({
    mediaType: row.media_type,
    status: row.status,
    paramsJson: row.params_json ?? null,
    contentType,
    size: bytes.byteLength,
  });
  if (reason || !contentType) {
    throw new HTTPException(400, { message: reason || "Last frame must be an image" });
  }
  const stored = await putMediaObject(
    c.env.MEDIA,
    bytes,
    contentType,
    `u/${user.id}/last-frames`,
  );
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    `UPDATE generations SET last_frame_key = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
  )
    .bind(stored.key, now, id, user.id)
    .run();
  if (row.last_frame_key && row.last_frame_key !== stored.key) {
    await deleteStoredMedia(c.env, [row.last_frame_key]);
  }
  const lastFrameUrl = await displayStoredMediaUrl(c.env, stored.key, null);
  return c.json({ lastFrameUrl, updatedAt: now });
});

app.get("/api/generations/:id", async (c) => {
  const user = await requireUser(c);
  const apiKey = await requireOxenKey(user, c.env);
  const id = c.req.param("id");

  const row = await c.env.DB.prepare(
    `SELECT * FROM generations WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .first<GenerationRow>();

  if (!row) {
    throw new HTTPException(404, { message: "Generation not found" });
  }

  const typicals = await typicalWaitByMedia(c.env, user.id);
  const tagMap = await tagsByGeneration(c.env, user.id, [row.id]);
  const generation = await syncGenerationRow(c.env, user.id, apiKey, row, {
    persistMissing: true,
    pollActive: true,
    typicalSeconds: row.media_type ? typicals[row.media_type] ?? null : null,
    tags: tagMap.get(row.id) ?? [],
  });
  return c.json({ generation });
});

app.put("/api/generations/:id/tags", async (c) => {
  const user = await requireUser(c);
  const id = c.req.param("id");
  const body = await c.req.json<{ tags?: unknown }>().catch(() => ({ tags: [] as unknown }));
  const tags = parseTagList(body.tags);
  const row = await c.env.DB.prepare(`SELECT * FROM generations WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .first<GenerationRow>();
  if (!row) {
    throw new HTTPException(404, { message: "Generation not found" });
  }
  await replaceGenerationTags(c.env, user.id, id, tags);
  const typicals = await typicalWaitByMedia(c.env, user.id);
  const generation = await syncGenerationRow(
    c.env,
    user.id,
    await getOxenKey(user, c.env.ENCRYPTION_KEY),
    row,
    {
      persistMissing: false,
      pollActive: false,
      typicalSeconds: row.media_type ? typicals[row.media_type] ?? null : null,
      tags,
    },
  );
  return c.json({ generation });
});

app.delete("/api/generations/:id", async (c) => {
  const user = await requireUser(c);
  const id = c.req.param("id");
  const fromOxen = parseFromOxenFlag(c.req.query("fromOxen"));
  const row = await c.env.DB.prepare(`SELECT * FROM generations WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .first<GenerationRow>();
  if (!row) {
    throw new HTTPException(404, { message: "Generation not found" });
  }
  const apiKey = await getOxenKey(user, c.env.ENCRYPTION_KEY);
  const result = await removeStudioGeneration(c.env, user.id, row, { apiKey, fromOxen });
  return c.json({ ok: true, ...result });
});

app.post("/api/library/cleanup", async (c) => {
  const user = await requireUser(c);
  const body = await c.req.json<{ action?: unknown; fromOxen?: unknown }>().catch(() => ({
    action: null,
    fromOxen: null,
  }));
  const action = parseCleanupAction(body.action);
  if (!action) {
    throw new HTTPException(400, { message: "Invalid cleanup action" });
  }
  const fromOxen = parseFromOxenFlag(body.fromOxen);
  switch (action) {
    case "failed": {
      const deleted = await deleteFailedGenerations(c.env, user.id);
      return c.json({
        action,
        deleted,
        built: 0,
        remaining: false,
        oxenDeleted: 0,
        oxenFailed: 0,
      });
    }
    case "thumbs": {
      const result = await backfillMissingThumbnails(c.env, user.id, {
        rebuildOversized: true,
      });
      return c.json({
        action,
        deleted: 0,
        built: result.built,
        remaining: result.remaining,
        oxenDeleted: 0,
        oxenFailed: 0,
      });
    }
    case "all": {
      const result = await deleteAllUserMedia(c.env, user.id, {
        apiKey: await getOxenKey(user, c.env.ENCRYPTION_KEY),
        fromOxen,
      });
      return c.json({
        action,
        deleted: result.deleted,
        built: 0,
        remaining: false,
        r2Deleted: result.r2Deleted,
        oxenDeleted: result.oxenDeleted,
        oxenFailed: result.oxenFailed,
      });
    }
    default: {
      const _never: never = action;
      throw new HTTPException(400, { message: `Unhandled cleanup action: ${_never}` });
    }
  }
});

app.get("/api/oxen/queue", async (c) => {
  const user = await requireUser(c);
  const apiKey = await requireOxenKey(user, c.env);
  const url = new URL(c.req.url);
  const data = await listQueue(apiKey, url.searchParams);
  return c.json(data);
});

app.get("/api/push/config", async (c) => {
  const user = await requireUser(c);
  const enabled = vapidConfigured(c.env);
  const subscribed = enabled ? await userHasPushSubscription(c.env.DB, user.id) : false;
  return c.json({
    enabled,
    vapidPublicKey: enabled ? c.env.VAPID_PUBLIC_KEY : null,
    subscribed,
  });
});

app.post("/api/push/subscribe", async (c) => {
  const user = await requireUser(c);
  if (!vapidConfigured(c.env)) {
    throw new HTTPException(503, { message: "Push notifications are not configured" });
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Invalid push subscription" });
  }
  let subscription: ReturnType<typeof parsePushSubscription>;
  try {
    subscription = parsePushSubscription(body);
  } catch {
    throw new HTTPException(400, { message: "Invalid push subscription" });
  }
  // Outside the try: a storage failure is a 500 with a reference, not a 400 carrying D1 text.
  await savePushSubscription(c.env.DB, user.id, subscription);
  return c.json({ ok: true });
});

app.delete("/api/push/subscribe", async (c) => {
  const user = await requireUser(c);
  let endpoint = "";
  try {
    const body = (await c.req.json()) as { endpoint?: unknown };
    endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  } catch {
    endpoint = "";
  }
  if (!endpoint) {
    throw new HTTPException(400, { message: "Missing push endpoint" });
  }
  await deletePushSubscription(c.env.DB, user.id, endpoint);
  return c.json({ ok: true });
});

export async function pollActiveGenerations(env: Env): Promise<{ polled: number }> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM generations
     WHERE status NOT IN ('succeeded', 'failed', 'cancelled')
     ORDER BY updated_at ASC
     LIMIT 80`,
  ).all<GenerationRow & { user_id: string }>();
  const rows = results ?? [];
  const users = new Map<string, UserRow>();
  let polled = 0;
  for (const row of rows) {
    if (!row.user_id) continue;
    let user = users.get(row.user_id);
    if (!user) {
      const loaded = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
        .bind(row.user_id)
        .first<UserRow>();
      if (!loaded) continue;
      user = loaded;
      users.set(row.user_id, loaded);
    }
    const apiKey = await getOxenKey(user, env.ENCRYPTION_KEY);
    await syncGenerationRow(env, user.id, apiKey, row, {
      persistMissing: true,
      pollActive: true,
    });
    polled += 1;
  }
  return { polled };
}

export { app };

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(pollActiveGenerations(env));
  },
};
