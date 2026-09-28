# User-scoped agent credential

Implement a credential so a headless agent can call DS Studio without a browser session.

Repo: https://github.com/DigiSavvy-Inc/oxen-ai
Production: https://studio.digisavvy.dev
Read `AGENTS.md` and `docs/studio-api-for-agents.md` before editing.

## Goal

Settings mints a user-scoped credential. `requireUser` accepts it beside the existing `oxen_session` cookie. The Oxen API key stays encrypted in Settings and is never returned.

## Auth today

- Studio auth is only the `oxen_session` cookie (`HttpOnly`, `Secure`, `SameSite=Lax`). There is no bearer token.
- Production sign-in is GitHub OAuth. Callback is `https://studio.digisavvy.dev/api/auth/callback` only. Do not point OAuth at another host.
- Access is a DigiSavvy-Inc org member, the D1 allowlist, or a `GITHUB_ADMINS` login. The credential uses those same checks. It does not bypass them.
- `GET /api/auth/me` with no cookie returns `{ "user": null }`. Generate, upload, model, and library routes return `401` `{ "error": "Unauthorized" }` without a live session.
- `GET /api/settings/oxen-key` returns `{ "hasOxenKey": true | false }` only. `PUT /api/settings/oxen-key` with `{ "apiKey" }` does not echo the key.
- Generate with no saved Oxen key returns `400` `Add your Oxen API key in Settings before generating`.

## Credential

- Mint only for a signed-in user who already has an Oxen key saved.
- Show the secret once at creation. Store only a hash. Never log the secret or the Oxen key.
- Prefix the secret `ds_studio_` so a leak is recognizable.
- Accept `Authorization: Bearer <credential>` on the routes `requireUser` already guards. The session cookie keeps working.
- Revoke from Settings. A missing or revoked credential returns `401`.
- Do not put the credential, the Oxen key, or other secrets in `wrangler.jsonc`, docs, or logs.

## Calls the credential must authorize

1. `GET /api/models?mode=<mode>` and `GET /api/models/<id>`
2. `POST /api/upload` as `multipart/form-data`, field `file`, max 80MB, only when the model needs a reference
3. `POST /api/generate` with `mode`, `model`, `prompt`, and `num_generations` from 1 to 4
4. Poll `GET /api/generations/:id` until `succeeded`, `failed`, or `cancelled`
5. `GET` `resultUrl`

Modes: `text-to-image`, `image-to-image`, `text-to-video`, `reference-to-video`, `video-to-video`.

Image and video stay on the Oxen async queue. `POST /api/generate` returns when Oxen accepts the job. There is no synchronous generate route. Do not add one. Do not add an `asset://` ingest.

Reference fields the handler reads: `images`, `input_image`, `input_images`, `input_face_images`, `videos`, `input_video`, `input_videos`, `input_face_videos`, `audios`, `input_audios`. Attach only kinds and counts in `controls.slots` for that model.

`resultUrl` is a signed `/api/media/...` link (about 12 hours) and does not need the credential.

## Tests and ship

Add a test that a bearer credential authenticates `requireUser`, and that a missing or revoked one returns `401`. Do not print the secret in test output.

When the slice works: commit to `main`, push, and `wrangler deploy` to studio.digisavvy.dev with the required `--var` flags. Never force-push, skip hooks, or print secrets (`.dev.vars`, Oxen keys, OAuth client secrets, encryption or session keys, this credential).

## Do not

- Return or log the Oxen key
- Change the light UI, branding, or model defaults
- Commit `PUBLIC_BASE_URL` or a real `GITHUB_CLIENT_ID`
- Pre-select a mode chip or set a global model default
