## Learned User Preferences
- Keep the Studio UI light and minimal; do not restyle it dark or add a Cursor UI package. Prefer one auto-detected media drop zone over Atlas-style separate image/video/audio areas.
- Never print, commit, or echo secrets (`.dev.vars`, Oxen API keys, OAuth client secrets, encryption/session keys). Prefer `pbpaste` or in-app Settings over chat.
- Do not invent a synchronous Oxen generation path; image and video stay on the async queue.
- Allowlist lives in Settings as a left-nav category with the form on the right, not as a standalone sidebar button.
- When a DS Studio slice is done, commit to `main`, push, and `wrangler deploy` to studio.digisavvy.dev with the required `--var` flags. Do not wait for a separate ship prompt. Never force-push, skip hooks, or print secrets.
- Continue existing work; do not restart the project or revert finished work.
- Local placeholder GitHub OAuth must not send users to `/login/oauth/authorize`.
- Do not set global model defaults; let each user pick preferred models and persist their settings. Use Oxen’s live catalog and keep controls consistent across models; image models that support resolution (including Seedream 5.x) must expose those options. Ghost unsupported mode pills for the selected model; choosing a ghosted mode resets the model.
- Brand the product as DS Studio with the DigiSavvy favicon from digisavvy.com, not “Oxen Studio”.
- Credits control is labeled “Buy Credits”, shows a live dollar balance, and links to https://www.oxen.ai/digisavvy/settings/billing; the generate button shows live estimated cost (including resolution, count, and duration) and keeps bold keyboard-hint icons.
- Support multiple generations per prompt and `@Image`/`@Video`/`@Audio` mentions for models that accept references.
- History is a click-to-toggle slide-out on desktop and mobile, filterable by tag, and should use generated thumbnails rather than full-size files. Tags apply to a generation group, not each output. Settings and logout live under the user avatar.

## Learned Workspace Facts
- DS Studio is a Cloudflare Workers + Vite/React app (Hono API, D1, R2) in [DigiSavvy-Inc/oxen-ai](https://github.com/DigiSavvy-Inc/oxen-ai).
- Local: `npm run dev` at http://localhost:5173; local sign-in uses this machine’s `gh` login via `GH_TOKEN`.
- Production origin is https://studio.digisavvy.dev (Worker `oxen-studio`); users sign in with GitHub, then add their Oxen key in Settings.
- Access is DigiSavvy-Inc org members or the D1 allowlist; bootstrap admin is `GITHUB_ADMINS=digisavvy`.
- Each user stores an Oxen API key in Settings; the Worker encrypts it and proxies Oxen. Never expose the key to the browser after save.
- Modes (text-to-image, image-to-image, text-to-video, reference-to-video, video-to-video) go through the Oxen async queue only; 1–4 outputs share a `batch_id` with group-level tags, and succeeded results are archived to R2 (`result_key`) then listed with fresh signed URLs.
- Local uploads without `PUBLIC_BASE_URL` return data URIs; production uses signed R2 media URLs via `PUBLIC_BASE_URL=https://studio.digisavvy.dev`.
- Worker unit tests use Vitest (`npm test`); CI lints, tests, and builds, and does not deploy.
- Production GitHub OAuth callback is only `https://studio.digisavvy.dev/api/auth/callback`; do not reuse another app’s callback or point it at `workers.dev`.
- Tracking issue is [DigiSavvy-Inc/oxen-ai#1](https://github.com/DigiSavvy-Inc/oxen-ai/issues/1).
- Production D1 is `oxen-studio` and R2 is `oxen-studio-media`; remote D1 has `0004_generation_tags.sql` applied; committed `wrangler.jsonc` must not include `PUBLIC_BASE_URL` or a real `GITHUB_CLIENT_ID` (those are deploy-time vars).
- Catalog should include Seedream 5.0, GPT Image 2.5, Seedance 2.5, Kling 3.0, and Wan 3.0; image models that support resolution must expose those options. `GET /api/billing/credits` returns remaining USD (or null) plus the DigiSavvy Oxen billing URL.
