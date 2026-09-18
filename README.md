# Oxen Studio

Cursor-inspired media studio for [Oxen AI](https://docs.oxen.ai/inference-api/overview) image and video generation. Runs on Cloudflare Workers (Hono API + React SPA) with GitHub org/allowlist access and per-user Oxen API keys.

Tracking: [DigiSavvy-Inc/oxen-ai#1](https://github.com/DigiSavvy-Inc/oxen-ai/issues/1)

## Features

- Text → Image, Image → Image, Text → Video, Reference → Video, Video → Video
- Async Oxen queue with live polling
- GitHub OAuth: DigiSavvy-Inc org members **or** D1 allowlist (admins manage it in Settings)
- Per-user encrypted Oxen API keys
- R2 uploads for reference media (data URI fallback locally)

## Setup

```bash
cp .dev.vars.example .dev.vars
# fill GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_ADMINS, ENCRYPTION_KEY, SESSION_SECRET
npm install
npm run db:migrate:local
npm run dev
```

### GitHub sign-in

A GitHub OAuth app has exactly one callback URL. Until you create one, local sign-in uses the GitHub account already logged in via `gh` (`GH_TOKEN` in `.dev.vars`). Do not commit that file.

Production still needs a GitHub OAuth App:

1. https://github.com/settings/developers → New OAuth App
2. Callback: `https://studio.digisavvy.dev/api/auth/callback` (one URL per GitHub OAuth app; local stays on `gh` until that app exists)
3. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`

Put your GitHub login in `GITHUB_ADMINS` so you can sign in and manage the allowlist.

### Oxen API key

After signing in, open **Settings** and paste your Oxen API key from account settings. Keys are encrypted in D1 and never exposed to the browser after save.

### Reference media (edit / ref-to-video / video-to-video)

Oxen downloads `input_image` / `input_video` itself, so those values must be URLs Oxen can GET.

- **Local:** leave `PUBLIC_BASE_URL` unset or empty in `.dev.vars`. `POST /api/upload` returns data URIs, which Oxen accepts.
- **Production:** set `PUBLIC_BASE_URL=https://studio.digisavvy.dev` (no trailing slash). Uploads then return signed `https://studio.digisavvy.dev/api/media/...` URLs with `exp` and `sig`. Oxen fetches those over HTTPS without a session cookie or API key. Signatures last 12 hours so queued video jobs can still download reference files.

Uploads stay session-authenticated. The browser never holds Oxen API keys.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Vite + Workers local runtime |
| `npm run build` | Production build |
| `npm run preview` | Preview build in workerd |
| `npm run deploy` | Build and deploy to Cloudflare |
| `npm run db:migrate:local` | Apply D1 migrations locally |
| `npm run test` | Worker media URL tests (no live Oxen / R2) |

## Deploy

1. Create D1 database and R2 bucket; update IDs in `wrangler.jsonc`
2. `wrangler secret put GITHUB_CLIENT_SECRET`
3. `wrangler secret put ENCRYPTION_KEY`
4. `wrangler secret put SESSION_SECRET`
5. Set `GITHUB_CLIENT_ID`, `GITHUB_ADMINS`, and `PUBLIC_BASE_URL=https://studio.digisavvy.dev` as vars
6. Point the GitHub OAuth callback at `https://studio.digisavvy.dev/api/auth/callback` (do not reuse another app's callback)
7. `npm run deploy`
