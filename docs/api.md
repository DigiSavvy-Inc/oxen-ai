# Studio API with a personal token

A script or an AI agent can use Studio's REST API with a personal API token. It generates with any model and settings, and the results land in your history, galleries, slots, and collections, the same as runs from the browser. There is no separate generation path: every run still goes through `POST /api/generate` and the Oxen async queue.

All examples use two shell variables:

```bash
export STUDIO=https://studio.digisavvy.dev   # your Studio origin
export TOKEN=dss_...                         # the token from Settings, never commit it
```

JSON errors are `{ "error": "..." }`. Field-level detail for each route is in [studio-api-for-agents.md](studio-api-for-agents.md).

## Make a token

1. Sign in to Studio in a browser and add your Oxen key in Settings → API key. A token uses that key; it never sees it.
2. Open Settings → API tokens. Enter a name and a daily cap in dollars, from 0.50 to 500, then Create.
3. Copy the token. **This is the only time it is shown.** Studio keeps only its SHA-256 hash.

You can have 10 live tokens. Revoke stops a token on its next request. Tokens are managed only from a browser session: a token cannot list, create, or revoke tokens.

## Send the token

```
Authorization: Bearer dss_...
```

- If the request also carries the browser session cookie, the cookie wins and the token is ignored.
- An unknown, malformed, or revoked token gets `401 Unauthorized`. Too many failed tokens from one address in ten minutes get `429`.
- The token acts as its owner while the owner still has access. Admins and allowlisted users always pass. An org member passes while they have a live browser session in Studio; when it ends, the token gets `401` "Sign in to Studio in a browser to use this token again."
- A route outside the token's scope gets `403` "This token cannot do that."

## Choose a profile

A token request always works in one profile: your active profile by default. Items on your other profiles answer `404` by id. To use another one for a single request, send its id:

```
X-Studio-Profile: <profile id from GET /api/profiles>
```

It applies to that request only and never changes your active profile. An id that is not yours gets `400` "Profile not found".

With the header, a gallery, project, or generation on another profile answers `404` as if it were not there, including a `project_id` sent to `POST /api/generate`.

## Daily cap

Each `POST /api/generate` from a token is priced by the Worker from the model's Oxen pricing and the request's count, duration, resolution, quality, and audio. The `estimated_cost` field a client sends is ignored for the cap. The run counts toward today's spend when it is queued; a run that later fails is not refunded.

**The day is UTC.** Spend resets at 00:00 UTC.

| Status | Error | Meaning |
| --- | --- | --- |
| `402` | `This token's daily limit of $X is used up ($Y spent today).` | Today's spend plus this run is over the cap. Nothing was queued. |
| `400` | `Studio cannot price this model, so a token cannot run it.` | The model has no usable price. Nothing was queued. Run it from the browser instead. |

`GET /api/auth/me` shows the cap and today's spend:

```bash
curl -s "$STUDIO/api/auth/me" -H "Authorization: Bearer $TOKEN"
# { "user": { "id", "login", ..., "hasOxenKey": true },
#   "token": { "name": "Render agent", "dailyCapUsd": 5, "spentTodayUsd": 0.42 } }
```

## What a token can call

Generate, read, and organise. Nothing else.

| Method | Path |
| --- | --- |
| GET | `/api/health`, `/api/auth/me`, `/api/billing/credits`, `/api/oxen/queue` |
| GET | `/api/models`, `/api/models/*` (search, references, favorites, one model) |
| POST | `/api/upload`, `/api/media/renew` |
| GET | `/api/media/*` |
| POST | `/api/generate` |
| GET | `/api/generations`, `/api/generations/:id` |
| POST | `/api/generations/:id/last-frame` |
| PUT | `/api/generations/:id/tags` |
| GET | `/api/profiles`, `/api/prompts` |
| GET | `/api/galleries`, `/api/galleries/:id` |
| POST | `/api/galleries` (create, or save with `id`) |
| PUT | `/api/galleries/:id/collection` |
| GET | `/api/collections`, `/api/collections/:id/assets` |
| POST | `/api/collections` |
| GET | `/api/slots` |
| POST | `/api/slots`, `/api/slots/:id/files` |
| GET | `/api/projects`, `/api/projects/:id`, `/api/projects/:id/jobs` |

Never allowed: any `DELETE`, `/api/settings/*` (including token management), `/api/admin/*`, branding changes, sign-in routes other than `me`, creating, renaming, activating, or deleting profiles, `/api/library/cleanup`, `/api/generations/delete`, `/api/galleries/files/delete`, `/api/chat`, push notifications, and project shares. New routes are closed to tokens until they are added to `worker/api-scope.ts`.

## Examples

### List models

```bash
curl -s "$STUDIO/api/models?mode=text-to-image" -H "Authorization: Bearer $TOKEN" \
  | jq '.models[] | {id, display_name}'
```

`GET /api/models/<id>` returns that model's `controls` (accepted references, aspect ratios, duration, resolution, quality).

### Upload a reference

```bash
curl -s "$STUDIO/api/upload" -H "Authorization: Bearer $TOKEN" -F "file=@face.jpg"
# { "key": "u/<user>/....jpg", "url": "https://.../api/media/...", "contentType": "image/jpeg", ... }
```

Pass `url` back on generate, for example in `images`.

### Generate

```bash
curl -s "$STUDIO/api/generate" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"mode":"text-to-image","model":"<model id>","prompt":"a red bicycle on wet asphalt","num_generations":1}'
# { "generations": [ { "id": "<generation id>", "status": "queued", "resultUrl": null, ... } ] }
```

One `id` per output. Poll each one.

### Poll a generation until it finishes

```bash
ID=<generation id>
while :; do
  GEN=$(curl -s "$STUDIO/api/generations/$ID" -H "Authorization: Bearer $TOKEN")
  STATUS=$(echo "$GEN" | jq -r '.generation.status')
  case "$STATUS" in succeeded|failed|cancelled) break ;; esac
  sleep 5
done
echo "$GEN" | jq '.generation | {status, resultUrl, resultKey, errorMessage}'
```

### Add the result to a gallery

A gallery save sends the whole list, so read it, append, and save it back with its `id`:

```bash
GALLERY=<gallery id>
KEY=$(echo "$GEN" | jq -r '.generation.resultKey')
curl -s "$STUDIO/api/galleries/$GALLERY" -H "Authorization: Bearer $TOKEN" \
  | jq --arg key "$KEY" '{id: .gallery.id, name: .gallery.name,
      items: ([.gallery.items[] | {key, kind, name, role, label}] + [{key: $key, kind: "image", name: "Agent render"}])}' \
  | curl -s "$STUDIO/api/galleries" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d @-
```

To make a new gallery instead, send `{ "name": "Renders", "items": [{ "key": "...", "kind": "image", "name": "Agent render" }] }` with no `id`.

### File a gallery in a collection

```bash
curl -s "$STUDIO/api/collections" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Agent work"}'
# { "collection": { "id": "<collection id>", ... } }

curl -s -X PUT "$STUDIO/api/galleries/$GALLERY/collection" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"collectionId":"<collection id>"}'
```

## Keep tokens safe

- Never commit, print, or log a token. Keep it in an environment variable or a secrets manager.
- Give each script its own token with the smallest cap that works, so you can revoke one without touching the others.
- If a token leaks, revoke it in Settings → API tokens and make a new one.

## Handles in a prompt

Write `@Maya` or `@Loft.wide` in `prompt` and Studio attaches that slot's or gallery's files and writes the slot's note, as the composer does. The response's `names` field says what was attached and what was left out. See [api-names.md](api-names.md).
