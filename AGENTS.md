## Learned User Preferences
- Keep the Studio UI light; do not restyle it dark or add a Cursor UI package.
- Never print, commit, or echo secrets (`.dev.vars`, Oxen API keys, OAuth client secrets, encryption/session keys). Prefer `pbpaste` or in-app Settings over chat.
- Do not invent a synchronous Oxen generation path; image and video stay on the async queue.
- Allowlist lives in Settings as a left-nav category with the form on the right, not as a standalone sidebar button.
- Do not commit, push, merge, or `wrangler deploy` unless asked.
- Continue existing work; do not restart the project or revert finished work.
- Local placeholder GitHub OAuth must not send users to `/login/oauth/authorize`.

## Learned Workspace Facts
- Oxen Studio is a Cloudflare Workers + Vite/React app (Hono API, D1, R2) in [DigiSavvy-Inc/oxen-ai](https://github.com/DigiSavvy-Inc/oxen-ai).
- Local: `npm run dev` at http://localhost:5173; local sign-in uses this machine’s `gh` login via `GH_TOKEN`.
- Production origin is https://studio.digisavvy.dev (Worker `oxen-studio`).
- Access is DigiSavvy-Inc org members or the D1 allowlist; bootstrap admin is `GITHUB_ADMINS=digisavvy`.
- Each user stores an Oxen API key in Settings; the Worker encrypts it and proxies Oxen. Never expose the key to the browser after save.
- Modes (text-to-image, image-to-image, text-to-video, reference-to-video, video-to-video) go through `POST /api/ai/queue` and poll `GET /api/ai/queue/:id` only.
- Local uploads without `PUBLIC_BASE_URL` return data URIs; production uses signed R2 media URLs via `PUBLIC_BASE_URL=https://studio.digisavvy.dev`.
- Worker unit tests use Vitest (`npm test`); CI lints, tests, and builds, and does not deploy.
- Production GitHub OAuth callback is only `https://studio.digisavvy.dev/api/auth/callback`; do not reuse another app’s callback or point it at `workers.dev`.
- Tracking issue is [DigiSavvy-Inc/oxen-ai#1](https://github.com/DigiSavvy-Inc/oxen-ai/issues/1).
- Production D1 is `oxen-studio` and R2 is `oxen-studio-media`; committed `wrangler.jsonc` must not include `PUBLIC_BASE_URL` or a real `GITHUB_CLIENT_ID` (those are deploy-time vars).
- Production is live; users sign in with GitHub, then add their Oxen key in Settings.
