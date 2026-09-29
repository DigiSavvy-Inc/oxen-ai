# DS Studio API for agents

Production origin: `https://studio.digisavvy.dev`  
Repo: https://github.com/DigiSavvy-Inc/oxen-ai (`main`, Worker `worker/index.ts`)

All paths below are on that origin. JSON errors are `{ "error": "..." }`.

## Auth today

There is no agent token, API key, or `Authorization` header for Studio. `requireUser` reads only the `oxen_session` cookie.

Production sign-in is a browser GitHub OAuth redirect:

1. `GET /api/auth/github` sends the browser to GitHub (`read:user`, `read:org`).
2. GitHub returns to `https://studio.digisavvy.dev/api/auth/callback` only.
3. The callback sets `oxen_session` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`). Default lifetime is `SESSION_TTL_SECONDS` (604800 seconds).

Access is a DigiSavvy-Inc org member, the D1 allowlist, or a `GITHUB_ADMINS` login. The session JSON never includes the Oxen key.

`GET /api/auth/me` with no cookie returns `200` `{ "user": null }`. Every generate, upload, model, and library route returns `401` `{ "error": "Unauthorized" }` without a live session.

**An agent cannot create a generation without a logged-in browser session.** A headless client can call these routes only if it already holds that cookie and sends `Cookie: oxen_session=...`. The API does not issue the cookie as JSON, and page script cannot read it (`HttpOnly`).

`GET /api/health` is public: `{ "ok": true, "service": "oxen-studio" }`.

## Oxen key

The user’s Oxen key is saved once in Settings and encrypted on the Worker. Generate uses that stored key. It is never returned.

- `GET /api/settings/oxen-key` → `{ "hasOxenKey": true | false }`
- `PUT /api/settings/oxen-key` body `{ "apiKey": "..." }` → `{ "ok": true, "hasOxenKey": true }` (the key is not echoed)
- Generate without a saved key → `400` `Add your Oxen API key in Settings before generating`

Do not send the Oxen key on `/api/generate`. Do not log it.

## What is async

Image, video, and audio jobs go through the Oxen queue only (`POST https://hub.oxen.ai/api/ai/queue` inside the Worker). There is no synchronous generate route. Audio does not call `/api/ai/audio/generate`. `POST /api/generate` returns as soon as Oxen accepts the job. `resultUrl` is null until a later poll.

A cron (`* * * * *`) also polls in-flight rows. Do not rely on it. Poll the generation id.

## Call sequence

Send `Content-Type: application/json` and the session cookie on every step except the final media GET.

### 1. Pick a model

`GET /api/models?mode=<mode>` with a saved Oxen key returns the live catalog (`{ "mode", "models": [{ "id", "display_name", "capabilities", ... }] }`).

`GET /api/models/<id>` returns `{ "model", "controls" }`. `controls.slots` is the media the model accepts (`kind`: `image` | `video` | `audio`, `required`, `maxItems`). `controls` also lists `aspectRatios`, `duration`, `resolution`, `quality`, `outputFormat`, `background`, `seed`, `generateAudio`, and for Seed Audio `sampleRate`, `speed`, `volume`, and `pitch` when the model schema has them.

Modes:

| `mode` | output `mediaType` | reference |
| --- | --- | --- |
| `text-to-image` | `image` | none |
| `image-to-image` | `image` | image required when the model slot is required |
| `text-to-video` | `video` | none |
| `reference-to-video` | `video` | image only when that model’s image slot is `required`. Optional-ref models (including Seedance 2.5) run with no file. |
| `video-to-video` | `video` | video required when the model slot is required |
| `text-to-audio` | `audio` | none. Seed Audio 1.0 (`bytedance-seed-audio-1-0`) runs from a prompt. Optional `audio_urls` (up to 3, `@Audio1`…) or one `image_url`. Those two references cannot be combined. The model does not accept video. |

If the model schema cannot be loaded, `image-to-image` and `reference-to-video` require an image, and `video-to-video` requires a video.

### 2. Upload a reference (only if the model needs one)

`POST /api/upload` as `multipart/form-data`, field `file`. Max 80MB.

Response: `{ "key", "url", "contentType", "size", "name" }`. Pass `url` back on generate. In production `url` is a signed `https://studio.digisavvy.dev/api/media/...` URL.

### 3. Create

`POST /api/generate`

```json
{
  "mode": "text-to-image",
  "model": "<model id from /api/models>",
  "prompt": "a red bicycle on wet asphalt",
  "num_generations": 1,
  "aspect_ratio": "1:1",
  "images": ["<upload url>"],
  "image_roles": ["character"],
  "videos": [],
  "audios": []
}
```

Required: `mode`, `model`, `prompt`. `num_generations` is clamped to 1–4 (default 1). Omit empty reference arrays.

Reference fields the handler actually reads: `images`, `input_image`, `input_images`, `input_face_images`, `videos`, `input_video`, `input_videos`, `input_face_videos`, `audios`, `input_audios`. `image_roles` / `video_roles` are `"character"` or `"scene"` and only matter when the model has a face slot (`input_face_images` / `input_face_videos`).

Optional passthrough, kept only when the model schema allows it: `aspect_ratio`, `duration`, `seed`, `generate_audio`, `quality`, `resolution`, `output_format`, `background`, `moderation`. `get_last_frame: true` is stored for some video models; the Worker does not extract a still. `lastFrameUrl` stays empty unless something later `POST`s `/api/generations/:id/last-frame`.

Response: `{ "generations": [ { "id", "oxenGenerationId", "batchId", "status", "mediaType", "resultUrl": null, ... } ] }`. One Studio `id` per output. They share `batchId`. There is no batch fetch. Poll each `id`.

### 4. Poll

`GET /api/generations/<id>`

This call asks Oxen for status and, on success, copies the file into R2. Repeat until `status` is `succeeded`, `failed`, or `cancelled`. The Studio UI polls about every 3 seconds. `errorMessage` is set on failure.

`GET /api/generations?scope=active` lists in-flight rows (limit 50) and does **not** refresh them from Oxen. `scope=library` (default) lists the latest 100 and also does not poll. Use the id route.

### 5. Fetch the file

On `succeeded`, `generation.resultUrl` is the media URL (a signed Studio URL once the file is archived). `thumbUrl` is a small image preview when one exists.

`GET` that URL. `/api/media/*` does not use the session cookie. It checks `exp` and `sig`. Signed URLs last 12 hours. If the signature is expired, `GET /api/generations/<id>` again for a fresh `resultUrl`.

## Limits

- Count is 1–4 per request. It does not carry over; send `num_generations` every time (the UI resets to 1 when the model changes).
- Attach only kinds and counts in `controls.slots` for that model. Extra files are clipped to `maxItems`.
- Upload max is 80MB. Studio inlines image refs from R2 up to 12MB so the provider does not download hub file URLs. Face refs stay signed Studio `https` URLs.
- The Oxen key lives in Settings. `GET /api/auth/me` and `GET /api/settings/oxen-key` never return it.
- Generation charges the Oxen account behind that key. `GET /api/billing/credits` returns remaining USD (or null) and the billing URL.

## Smallest gap, and what not to build

The blocker is session issuance. The smallest fix is one user-scoped credential that `requireUser` accepts beside `oxen_session`, minted in Settings for a user who already saved an Oxen key. Do not build that unless asked.

Do not add a synchronous generate path, return the Oxen key to the agent, add an `asset://` ingest, or point OAuth at another callback.
