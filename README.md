# Oxen Studio

Cursor-inspired media studio for [Oxen AI](https://docs.oxen.ai/inference-api/overview) image and video generation. Runs on Cloudflare Workers (Hono API + React SPA) with GitHub org/allowlist access and per-user Oxen API keys.

Tracking: [DigiSavvy-Inc/oxen-ai#1](https://github.com/DigiSavvy-Inc/oxen-ai/issues/1)

Production origin: **https://studio.digisavvy.dev**

This repository does **not** auto-deploy. CI typechecks and lints; `wrangler deploy` is a manual human step after the checklist below.

## Features

- Text → Image, Image → Image, Text → Video, Reference → Video, Video → Video
- Async Oxen queue with live polling
- GitHub OAuth: DigiSavvy-Inc org members **or** D1 allowlist (admins manage it in Settings)
- Per-user encrypted Oxen API keys
- R2 uploads for reference media (data URI fallback locally)

## Setup

```bash
cp .dev.vars.example .dev.vars
# fill GITHUB_ADMINS, ENCRYPTION_KEY, SESSION_SECRET
# leave GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET empty for local `gh` sign-in
# paste `gh auth token` into GH_TOKEN (do not commit .dev.vars)
npm install
npm run db:migrate:local
npm run dev
```

### GitHub sign-in

A GitHub OAuth app has **exactly one** callback URL. Do not reuse another app's callback, and do not add a `workers.dev` or localhost callback to the production app.

Until a production OAuth app exists, local sign-in uses the GitHub account already logged in via `gh` (`GH_TOKEN` in `.dev.vars`). Leave `GITHUB_CLIENT_ID` empty. A placeholder client id is treated as unconfigured and **must not** send users to `https://github.com/login/oauth/authorize`.

Put your GitHub login in `GITHUB_ADMINS` (local `.dev.vars`) so you can sign in and manage the allowlist.

### Oxen API key

After signing in, open **Settings** and paste your Oxen API key from account settings. Keys are encrypted in D1 and never exposed to the browser after save.

### Reference media (edit / ref-to-video / video-to-video)

Oxen must be able to download `input_image` / `input_video` URLs. Locally (no `PUBLIC_BASE_URL`), uploads are sent as data URIs. Production must set `PUBLIC_BASE_URL=https://studio.digisavvy.dev` so signed `/api/media/...` URLs work.

## Deploy (human steps — not CI)

CI (`npm ci`, lint, `npm run build`) does **not** run `wrangler deploy` and does **not** create Cloudflare or GitHub OAuth resources.

### 1. GitHub OAuth app (new app, production callback only)

1. https://github.com/settings/developers → **New OAuth App** (do not reuse another app)
2. Homepage URL: `https://studio.digisavvy.dev`
3. Authorization callback URL (the only callback): `https://studio.digisavvy.dev/api/auth/callback`
4. Copy the client id. You will set `GITHUB_CLIENT_ID` as a Worker var at deploy time. Local `.dev.vars` stays empty so `npm run dev` keeps using `GH_TOKEN`.

### 2. D1 and R2 (paste real IDs; do not invent UUIDs)

```bash
npx wrangler d1 create oxen-studio
npx wrangler r2 bucket create oxen-studio-media
npx wrangler d1 migrations apply oxen-studio --remote
```

Paste the printed D1 `database_id` into `wrangler.jsonc` (replace the all-zeros placeholder). R2 is bound by bucket name `oxen-studio-media` (no UUID).

### 3. Secrets (never commit)

```bash
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put SESSION_SECRET
```

Use long random values for `ENCRYPTION_KEY` and `SESSION_SECRET` (32+ bytes).

### 4. Production vars

Committed `wrangler.jsonc` vars are local/dev defaults (`GITHUB_ORG=DigiSavvy-Inc`, blank `GITHUB_ADMINS`). Set the production shape in the Cloudflare dashboard or at deploy time:

```text
GITHUB_ORG=DigiSavvy-Inc
GITHUB_ADMINS=digisavvy
GITHUB_CLIENT_ID=<id from the new OAuth app>
PUBLIC_BASE_URL=https://studio.digisavvy.dev
SESSION_TTL_SECONDS=604800
```

Do not put `PUBLIC_BASE_URL` or a real `GITHUB_CLIENT_ID` in the committed jsonc — both would change local `npm run dev` (signed media URLs / OAuth redirects).

### 5. Custom domain `studio.digisavvy.dev`

`wrangler.jsonc` does **not** hard-code a `routes` entry so local `npm run dev` stays on loopback.

After the Worker exists, attach the domain in the Cloudflare dashboard: **Workers & Pages → oxen-studio → Settings → Domains & Routes → Add** `studio.digisavvy.dev` (zone DNS on Cloudflare). Equivalent wrangler shape (only if you later choose to deploy with it; commented in `wrangler.jsonc`):

```jsonc
"routes": [{ "pattern": "studio.digisavvy.dev", "custom_domain": true }]
```

The OAuth callback is the custom domain only. A `*.workers.dev` URL will not complete GitHub sign-in.

### 6. Deploy (manual)

```bash
npm run deploy
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Vite + Workers local runtime |
| `npm run build` | Production build (`tsc -b` + Vite) |
| `npm run lint` | oxlint |
| `npm run preview` | Preview build in workerd |
| `npm run deploy` | Build and deploy to Cloudflare (manual; not in CI) |
| `npm run db:migrate:local` | Apply D1 migrations locally |
