# Cloudflare setup: deploy your own Studio

This takes a fresh Cloudflare account to a working Studio at your own domain. Plan on
about 30 minutes. Everything runs on one Worker with a D1 database and an R2 bucket.

## What you need first

- A Cloudflare account with **your domain on it** (the domain must be a zone in the same
  account as the Worker).
- **R2 turned on** for the account. Cloudflare asks for a payment method before the first
  bucket can be created.
- A GitHub account that can create an OAuth app. If sign-in should be limited to a
  GitHub organization, you need to be able to approve the app for that org.
- Node 22 or later, and git.
- An Oxen account for the API key each person adds after signing in.

Pick the hostname now, for example `studio.example.com`. It is written `YOUR_DOMAIN`
below, and it has to match in three places: the GitHub OAuth callback, the Worker's
custom domain, and `PUBLIC_BASE_URL`.

## 1. Get the code and log in to Cloudflare

Clone [DigiSavvy-Inc/oxen-ai](https://github.com/DigiSavvy-Inc/oxen-ai) (or your fork),
then from the repo folder:

```bash
npm install
npx wrangler login
```

## 2. Create the GitHub OAuth app

GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App** (or the same
path under your organization's settings).

| Field | Value |
| --- | --- |
| Homepage URL | `https://YOUR_DOMAIN` |
| Authorization callback URL | `https://YOUR_DOMAIN/api/auth/callback` |

Use exactly that one callback. Do not point it at `*.workers.dev`.

Copy the **Client ID**, then generate a **client secret** and keep it for step 5.

## 3. Create the database and the bucket

```bash
npx wrangler d1 create oxen-studio
npx wrangler r2 bucket create oxen-studio-media
```

The first command prints a `database_id`. Open `wrangler.jsonc` and replace the
`database_id` under `d1_databases` with yours. The id committed in the repo is
DigiSavvy's production database, so nothing works until you change it.

If you chose different names, change `database_name` and `bucket_name` in
`wrangler.jsonc` to match, and use your database name in the commands below.

## 4. Create the tables

```bash
npx wrangler d1 migrations apply oxen-studio --remote
```

The Worker never alters the database itself. Every schema change is a file in
`migrations/`, so this command is also part of every update (see Updating).

## 5. Set the secrets

Generate three separate random values:

```bash
openssl rand -base64 48
```

Then store each secret. Wrangler prompts for the value, so nothing ends up in your shell
history. If it asks whether to create the Worker `oxen-studio`, say yes.

```bash
npx wrangler secret put GITHUB_CLIENT_SECRET   # from step 2
npx wrangler secret put ENCRYPTION_KEY         # random value 1
npx wrangler secret put SESSION_SECRET         # random value 2
npx wrangler secret put MEDIA_SIGNING_KEY      # random value 3
```

Keep a copy of `ENCRYPTION_KEY` in a password manager. It encrypts every saved Oxen
key; if it is lost or changed, everyone has to re-enter their key.

## 6. Deploy

Find your numeric GitHub account id for `GITHUB_ADMINS`:

```bash
gh api user --jq .id
```

Without the GitHub CLI, open `https://api.github.com/users/YOUR_LOGIN` and read `id`.

Then build and deploy with every variable:

```bash
npm run build && npx wrangler deploy --keep-vars \
  --var GITHUB_ORG:your-org \
  --var GITHUB_ADMINS:your-github-account-id \
  --var GITHUB_CLIENT_ID:your-oauth-client-id \
  --var PUBLIC_BASE_URL:https://YOUR_DOMAIN \
  --var OXEN_BILLING_URL:https://www.oxen.ai/your-namespace/settings/billing \
  --var SESSION_TTL_SECONDS:604800
```

Save this command somewhere outside the repo. You run it again, unchanged, for every
update, and a variable you leave out can be cleared.

## 7. Attach your domain

Cloudflare dashboard → Workers & Pages → **oxen-studio** → Settings → Domains & Routes
→ **Add** → Custom domain → `YOUR_DOMAIN`.

Cloudflare creates the DNS record and certificate. It is usually live within a minute
or two.

## 8. Check it

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://YOUR_DOMAIN/api/health
```

That should print `200`. Then in a browser:

1. Open `https://YOUR_DOMAIN` and continue with GitHub.
2. Open Settings and paste your Oxen API key.
3. Run one image generation and confirm it shows up in the library.

## Settings reference

Variables are passed with `--var` at deploy. Secrets are stored with
`wrangler secret put` and survive deploys.

| Name | Kind | What it does |
| --- | --- | --- |
| `GITHUB_CLIENT_ID` | variable | Client ID of your OAuth app |
| `GITHUB_CLIENT_SECRET` | secret | Client secret of your OAuth app |
| `GITHUB_ORG` | variable | Members of this GitHub org can sign in. For allowlist and admins only, set it to an empty string in `wrangler.jsonc`; the committed default is DigiSavvy's org |
| `GITHUB_ADMINS` | variable | Comma-separated GitHub account ids. Admins can always sign in and manage the allowlist and branding |
| `PUBLIC_BASE_URL` | variable | `https://YOUR_DOMAIN`. Oxen fetches reference media from here, so it must be the public HTTPS origin |
| `OXEN_BILLING_URL` | variable | Where Buy Credits goes. If omitted it points at DigiSavvy's Oxen billing page |
| `SESSION_TTL_SECONDS` | variable | How long a sign-in lasts. `604800` is 7 days |
| `ENCRYPTION_KEY` | secret | Encrypts saved Oxen keys and GitHub tokens. Required |
| `SESSION_SECRET` | secret | Cookie signing secret |
| `MEDIA_SIGNING_KEY` | secret | Signs media URLs. Without it, `ENCRYPTION_KEY` is used |
| `VAPID_PUBLIC_KEY` | variable | Optional, for notifications |
| `VAPID_PRIVATE_KEY` | secret | Optional, for notifications |
| `VAPID_SUBJECT` | variable | Optional. A `mailto:` address or your origin |

Notifications are optional. Generate a VAPID key pair (for example
`npx web-push generate-vapid-keys`), store the private key as a secret, and add
`--var VAPID_PUBLIC_KEY:...` to your deploy command.

To see which variables are live right now:

```bash
npx wrangler deployments list --name oxen-studio
npx wrangler versions view VERSION_ID --name oxen-studio
```

## What Wrangler sets up for you

These come from `wrangler.jsonc` and need no dashboard work:

- **Static assets**: the built web app, served by the same Worker.
- **Images binding** (`IMAGES`): used for thumbnails and image conversion.
- **Cron trigger**, every minute: checks in-flight jobs so notifications go out when a
  generation finishes, even with the app closed.
- **Observability**: Worker logs are on.

## Updating

```bash
git pull
npm install
npx wrangler d1 migrations apply oxen-studio --remote
```

Then run the full deploy command from step 6.

Keep your `database_id` edit in `wrangler.jsonc` when you pull. Apply migrations before
you deploy, so the new code never runs against an old schema.

## Troubleshooting

**"GitHub OAuth is not configured."** `GITHUB_CLIENT_ID` or `GITHUB_CLIENT_SECRET` is
missing or still a placeholder. Redeploy with the variable, or set the secret again.

**GitHub says the redirect URI is not associated with the application.** The callback
in the OAuth app and `PUBLIC_BASE_URL` do not match. Both must use `YOUR_DOMAIN`
exactly, with `https://`, and the callback path is `/api/auth/callback`.

**Access denied after a successful GitHub login.** The account is not in `GITHUB_ORG`,
not in `GITHUB_ADMINS`, and not on the allowlist. If the person is in the org, check
that the org has approved the OAuth app (Organization settings → Third-party access);
without that, GitHub hides the membership from Studio.

**A variable disappeared after a deploy.** The deploy command left it out. Run the full
command from step 6.

**Errors mentioning a missing table or column.** A migration has not been applied. Run
the `migrations apply` command from step 4.

**Reference images or videos fail or time out.** `PUBLIC_BASE_URL` is wrong or not
reachable from the internet. Oxen has to be able to fetch media from
`https://YOUR_DOMAIN`.

**"Your saved Oxen API key can't be read."** `ENCRYPTION_KEY` changed. Each person
re-enters their key in Settings.

## Next

- Local development: see "Run it locally" in the [README](../README.md).
- Mac app for your team: [mac-app.md](mac-app.md).
