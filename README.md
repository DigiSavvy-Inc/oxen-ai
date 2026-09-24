# DS Studio

A light web studio for [Oxen AI](https://docs.oxen.ai/inference-api/overview) image and video generation. You pick a mode and a model, write a prompt, attach references, and the app queues the job. Finished files are saved for you.

DigiSavvy runs a copy at **https://studio.digisavvy.dev**. This repository is the app. You can run your own.

Each signed-in person keeps their own Oxen API key. The server encrypts it and talks to Oxen. The browser never sees the key again after it is saved.

Image and video generation always go through Oxen’s async queue. There is no synchronous generate path.

## What it does

- Text → Image, Image → Image, Text → Video, Image → Video, Video → Video
- Live model catalog, per-mode defaults, and Oxen favorites
- `@Image` / `@Video` / `@Audio` mentions for models that take references
- 1–4 outputs per prompt, group tags, and a library of past results
- Estimated cost on Generate, and a Buy Credits link to Oxen billing
- Optional installable app with a notification when a job finishes

## Who can sign in

GitHub only.

- People in the GitHub organization named by `GITHUB_ORG`
- GitHub logins on the in-app allowlist
- Logins in `GITHUB_ADMINS`, who can also manage the allowlist

Leave `GITHUB_ORG` empty if you only want the allowlist and admins.

## Run it locally

You need Node 22+, a Cloudflare account (Wrangler uses it for local D1 and R2), and the [GitHub CLI](https://cli.github.com/) logged in.

```bash
cp .dev.vars.example .dev.vars
```

In `.dev.vars`:

- Set `GITHUB_ADMINS` to your GitHub login.
- Set `ENCRYPTION_KEY` and `SESSION_SECRET` to long random strings.
- Leave `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` empty.
- Set `GH_TOKEN` to the output of `gh auth token`.

Do not commit `.dev.vars`.

```bash
npm install
npm run db:migrate:local
npm run dev
```

Open http://localhost:5173 and continue with this machine’s GitHub account. Then open Settings and paste an Oxen API key from your Oxen account.

Local uploads are sent as data URIs because `PUBLIC_BASE_URL` is empty. That is enough for most image references. Seedance face references need a public HTTPS URL, so use a deployed origin for those.

## Deploy your own

CI lints, tests, and builds. It does not deploy. You deploy with Wrangler.

Create a new GitHub OAuth app. Give it one callback: `https://YOUR_DOMAIN/api/auth/callback`. Do not point that callback at `*.workers.dev`.

```bash
npx wrangler d1 create oxen-studio
npx wrangler r2 bucket create oxen-studio-media
```

Put the printed D1 `database_id` in `wrangler.jsonc` in place of the existing id, then:

```bash
npx wrangler d1 migrations apply oxen-studio --remote
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put SESSION_SECRET
```

Attach your domain to the Worker in the Cloudflare dashboard. Then deploy with every variable you intend to keep. Omitting a variable on a later deploy can clear it. `--keep-vars` retains variables you do not pass this time.

```bash
npm run build && npx wrangler deploy --keep-vars \
  --var GITHUB_ORG:your-org \
  --var GITHUB_ADMINS:your-github-login \
  --var GITHUB_CLIENT_ID:your-oauth-client-id \
  --var PUBLIC_BASE_URL:https://YOUR_DOMAIN \
  --var OXEN_BILLING_URL:https://www.oxen.ai/your-namespace/settings/billing \
  --var SESSION_TTL_SECONDS:604800
```

`PUBLIC_BASE_URL` must be the HTTPS origin Oxen can fetch. Signed media URLs last 12 hours.

`OXEN_BILLING_URL` is where Buy Credits goes. If you omit it, the link points at DigiSavvy’s Oxen billing page.

Notifications are optional. Generate a VAPID key pair, store the private key with `wrangler secret put VAPID_PRIVATE_KEY`, and pass `VAPID_PUBLIC_KEY` as a variable. `VAPID_SUBJECT` can be a `mailto:` address or your origin.

The committed `wrangler.jsonc` is safe for local development: no production OAuth client id and no `PUBLIC_BASE_URL`. The D1 id in that file is DigiSavvy’s production database. Replace it before you deploy your own.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Vite and the Worker locally |
| `npm run build` | Typecheck and production build |
| `npm run lint` | oxlint |
| `npm test` | Unit tests. No live Oxen or R2 calls |
| `npm run db:migrate:local` | Apply D1 migrations locally |
| `npm run deploy` | Build and `wrangler deploy` with whatever vars are already on the Worker |

## License

[MIT](LICENSE) © DigiSavvy, Inc.
