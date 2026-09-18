import { Hono } from "hono";
import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import {
  SESSION_COOKIE,
  clearOxenKey,
  createSession,
  deleteSession,
  exchangeGithubCode,
  fetchGithubUser,
  getOxenKey,
  getSessionId,
  getUserBySession,
  isLoopbackHost,
  oauthConfigured,
  saveOxenKey,
  sessionCookieOptions,
  toSessionUser,
  upsertUser,
  userHasAccess,
} from "./auth";
import {
  buildReferenceMediaUrl,
  putMediaObject,
  verifyMediaSignature,
} from "./media";
import {
  cancelGeneration,
  enqueueGeneration,
  getGeneration,
  listModels,
  listQueue,
  type OxenModel,
} from "./oxen";
import type { Env, GenerationMode, SessionUser, UserRow } from "./types";

type Variables = {
  user: UserRow;
  sessionUser: SessionUser;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const MODE_META: Record<
  GenerationMode,
  { mediaType: "image" | "video"; needsImage?: boolean; needsVideo?: boolean }
> = {
  "text-to-image": { mediaType: "image" },
  "image-to-image": { mediaType: "image", needsImage: true },
  "text-to-video": { mediaType: "video" },
  "reference-to-video": { mediaType: "video", needsImage: true },
  "video-to-video": { mediaType: "video", needsVideo: true },
};

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    const message = err.message || "Request failed";
    return c.json({ error: message }, err.status);
  }
  console.error(err);
  return c.json({ error: err.message || "Internal error" }, 500);
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
  const user = await getUserBySession(c.env.DB, sessionId);
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
  const access = await userHasAccess(c.env.DB, ghUser.login, token, c.env);
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
  const sessionId = await createSession(c.env.DB, user.id, ttl);
  setCookie(c, SESSION_COOKIE, sessionId, sessionCookieOptions(ttl, isSecureRequest(c)));
  return c.redirect("/");
}

function filterModelsForMode(models: OxenModel[], mode: GenerationMode): OxenModel[] {
  return models.filter((m) => {
    const endpoint = m.endpoint || "";
    const inputs = m.capabilities?.input ?? [];
    const outputs = m.capabilities?.output ?? [];
    switch (mode) {
      case "text-to-image":
        return (
          endpoint.includes("/images/generate") &&
          outputs.includes("image") &&
          inputs.includes("text") &&
          !inputs.includes("image")
        );
      case "image-to-image":
        return (
          (endpoint.includes("/images/edit") || endpoint.includes("/images/generate")) &&
          outputs.includes("image") &&
          inputs.includes("image")
        );
      case "text-to-video":
        return (
          endpoint.includes("/videos/generate") &&
          outputs.includes("video") &&
          inputs.includes("text") &&
          !inputs.includes("image") &&
          !inputs.includes("video")
        );
      case "reference-to-video":
        return (
          endpoint.includes("/videos/generate") &&
          outputs.includes("video") &&
          inputs.includes("image") &&
          !inputs.includes("video")
        );
      case "video-to-video":
        return (
          endpoint.includes("/videos/generate") &&
          outputs.includes("video") &&
          inputs.includes("video")
        );
      default:
        return false;
    }
  });
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
    ],
    "image-to-image": [
      {
        id: "qwen-image-edit",
        display_name: "Qwen Image Edit",
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
    ],
    "reference-to-video": [
      {
        id: "kling-video-o3-pro-reference-to-video",
        display_name: "Kling O3 Pro Reference-to-Video",
        endpoint: "/videos/generate",
        capabilities: { input: ["text", "image"], output: ["video"] },
      },
      {
        id: "kling-video-v2-6-pro-image-to-video",
        display_name: "Kling v2.6 Pro Image-to-Video",
        endpoint: "/videos/generate",
        capabilities: { input: ["text", "image"], output: ["video"] },
      },
    ],
    "video-to-video": [
      {
        id: "kling-video-o3-pro-video-to-video-edit",
        display_name: "Kling O3 Pro Video-to-Video Edit",
        endpoint: "/videos/generate",
        capabilities: { input: ["text", "video", "image"], output: ["video"] },
      },
    ],
  };
  return catalog[mode];
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
  return c.json({
    mode: oauth ? "oauth" : "local",
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
  const access = await userHasAccess(c.env.DB, ghUser.login, accessToken, c.env);
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
  const sessionId = await createSession(c.env.DB, user.id, ttl);
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

app.get("/api/admin/allowlist", async (c) => {
  await requireUser(c);
  requireAdmin(c.get("sessionUser"));
  const rows = await c.env.DB.prepare(
    `SELECT github_login, added_by, created_at FROM allowlist ORDER BY github_login COLLATE NOCASE`,
  ).all<{ github_login: string; added_by: string | null; created_at: number }>();
  return c.json({
    org: c.env.GITHUB_ORG,
    admins: [...(c.env.GITHUB_ADMINS || "").split(",").map((s) => s.trim()).filter(Boolean)],
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
  await c.env.DB.prepare(`DELETE FROM allowlist WHERE github_login = ? COLLATE NOCASE`)
    .bind(login)
    .run();
  return c.json({ ok: true });
});

app.get("/api/models", async (c) => {
  const user = await requireUser(c);
  const mode = (c.req.query("mode") || "text-to-image") as GenerationMode;
  if (!(mode in MODE_META)) {
    throw new HTTPException(400, { message: "Invalid mode" });
  }

  let models: OxenModel[] = [];
  try {
    const apiKey = await getOxenKey(user, c.env.ENCRYPTION_KEY);
    if (apiKey) {
      const all = await listModels(apiKey);
      models = filterModelsForMode(all, mode);
    }
  } catch (err) {
    console.error("model list error", err);
  }

  if (models.length === 0) {
    models = fallbackModels(mode);
  }

  return c.json({ mode, models });
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
  const contentType = file.type || "application/octet-stream";
  const { key } = await putMediaObject(c.env.MEDIA, buffer, contentType, `u/${user.id}`);
  const secret = c.env.ENCRYPTION_KEY || c.env.SESSION_SECRET;
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
  const secret = c.env.ENCRYPTION_KEY || c.env.SESSION_SECRET;
  const ok = await verifyMediaSignature(key, exp, sig, secret);
  if (!ok) {
    throw new HTTPException(403, { message: "Invalid or expired media signature" });
  }
  const object = await c.env.MEDIA.get(key);
  if (!object) {
    throw new HTTPException(404, { message: "Not found" });
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  const contentType = object.httpMetadata?.contentType || "application/octet-stream";
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", "private, max-age=3600");
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
    duration?: number;
    seed?: number;
    input_image?: string | string[];
    input_video?: string;
    generate_audio?: boolean;
    num_generations?: number;
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
  if (meta.needsImage && !body.input_image) {
    throw new HTTPException(400, { message: "input_image is required for this mode" });
  }
  if (meta.needsVideo && !body.input_video) {
    throw new HTTPException(400, { message: "input_video is required for this mode" });
  }

  const payload: Record<string, unknown> = {
    model: body.model.trim(),
    prompt: body.prompt.trim(),
    num_generations: Math.min(Math.max(body.num_generations ?? 1, 1), 4),
  };
  if (body.aspect_ratio) payload.aspect_ratio = body.aspect_ratio;
  if (body.duration != null) payload.duration = body.duration;
  if (body.seed != null) payload.seed = body.seed;
  if (body.input_image) payload.input_image = body.input_image;
  if (body.input_video) payload.input_video = body.input_video;
  if (body.generate_audio != null) payload.generate_audio = body.generate_audio;

  const generations = await enqueueGeneration(apiKey, payload);
  const now = Math.floor(Date.now() / 1000);
  const saved = [];

  for (const gen of generations) {
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO generations
        (id, user_id, oxen_generation_id, mode, model, prompt, status, media_type, params_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        JSON.stringify(payload),
        now,
        now,
      )
      .run();
    saved.push({
      id,
      oxenGenerationId: gen.generation_id,
      mode,
      model: body.model.trim(),
      prompt: body.prompt.trim(),
      status: gen.status || "queued",
      mediaType: meta.mediaType,
      resultUrl: null as string | null,
      errorMessage: null as string | null,
      createdAt: now,
      updatedAt: now,
    });
  }

  return c.json({ generations: saved });
});

app.get("/api/generations", async (c) => {
  const user = await requireUser(c);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM generations WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(user.id)
    .all<{
      id: string;
      oxen_generation_id: string;
      mode: string;
      model: string;
      prompt: string | null;
      status: string;
      media_type: string | null;
      result_url: string | null;
      error_message: string | null;
      created_at: number;
      updated_at: number;
    }>();

  return c.json({
    generations: (rows.results ?? []).map((r) => ({
      id: r.id,
      oxenGenerationId: r.oxen_generation_id,
      mode: r.mode,
      model: r.model,
      prompt: r.prompt,
      status: r.status,
      mediaType: r.media_type,
      resultUrl: r.result_url,
      errorMessage: r.error_message,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  });
});

app.get("/api/generations/:id", async (c) => {
  const user = await requireUser(c);
  const apiKey = await requireOxenKey(user, c.env);
  const id = c.req.param("id");

  const row = await c.env.DB.prepare(
    `SELECT * FROM generations WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .first<{
      id: string;
      oxen_generation_id: string;
      mode: string;
      model: string;
      prompt: string | null;
      status: string;
      media_type: string | null;
      result_url: string | null;
      error_message: string | null;
      created_at: number;
      updated_at: number;
    }>();

  if (!row) {
    throw new HTTPException(404, { message: "Generation not found" });
  }

  let status = row.status;
  let resultUrl = row.result_url;
  let errorMessage = row.error_message;

  if (!["succeeded", "failed", "cancelled"].includes(status)) {
    try {
      const remote = await getGeneration(apiKey, row.oxen_generation_id);
      status = String(remote.status ?? status);
      resultUrl =
        (remote.result_url as string | null | undefined) ??
        extractResultUrl(remote) ??
        resultUrl;
      errorMessage =
        (remote.error_message as string | null | undefined) ?? errorMessage;
      const now = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `UPDATE generations SET status = ?, result_url = ?, error_message = ?, updated_at = ? WHERE id = ?`,
      )
        .bind(status, resultUrl, errorMessage, now, row.id)
        .run();
    } catch (err) {
      console.error("poll error", err);
    }
  }

  return c.json({
    generation: {
      id: row.id,
      oxenGenerationId: row.oxen_generation_id,
      mode: row.mode,
      model: row.model,
      prompt: row.prompt,
      status,
      mediaType: row.media_type,
      resultUrl,
      errorMessage,
      createdAt: row.created_at,
      updatedAt: Math.floor(Date.now() / 1000),
    },
  });
});

app.delete("/api/generations/:id", async (c) => {
  const user = await requireUser(c);
  const apiKey = await requireOxenKey(user, c.env);
  const id = c.req.param("id");
  const row = await c.env.DB.prepare(
    `SELECT oxen_generation_id, status FROM generations WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .first<{ oxen_generation_id: string; status: string }>();
  if (!row) {
    throw new HTTPException(404, { message: "Generation not found" });
  }
  if (!["succeeded", "failed", "cancelled"].includes(row.status)) {
    try {
      await cancelGeneration(apiKey, row.oxen_generation_id);
    } catch (err) {
      console.error("cancel error", err);
    }
  }
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(
    `UPDATE generations SET status = 'cancelled', updated_at = ? WHERE id = ?`,
  )
    .bind(now, id)
    .run();
  return c.json({ ok: true });
});

app.get("/api/oxen/queue", async (c) => {
  const user = await requireUser(c);
  const apiKey = await requireOxenKey(user, c.env);
  const url = new URL(c.req.url);
  const data = await listQueue(apiKey, url.searchParams);
  return c.json(data);
});

function extractResultUrl(remote: Record<string, unknown>): string | null {
  if (typeof remote.result_url === "string") return remote.result_url;
  const images = remote.images as { url?: string }[] | undefined;
  if (images?.[0]?.url) return images[0].url;
  const videos = remote.videos as { url?: string }[] | undefined;
  if (videos?.[0]?.url) return videos[0].url;
  const result = remote.result as { url?: string } | undefined;
  if (result?.url) return result.url;
  return null;
}

export default app;
