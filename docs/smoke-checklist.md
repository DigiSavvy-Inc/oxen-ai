# Production smoke checklist

A short pass to run against a live Studio after each deploy. It answers one question: can a
signed-in person still do the basics? Run the steps in order at desktop width (1280), then
steps 1 to 4 again at phone width (390).

Stop and report right away if step 1 or step 2 fails. Everything else depends on them.

The repo's Playwright suite (`npm run test:e2e`) covers the same screens against a local
throwaway Studio before a deploy. This checklist is the after-deploy check on the real site,
and the only place a real generation is exercised.

## Before you start

A person runs every step. A bot runs steps 1 to 5 and skips steps 6 to 8.

**A person** signs in with GitHub, as an account in the deployment's GitHub org or on its
allowlist, in a browser profile already signed in to GitHub. Steps 6 to 8 need that account's
own Oxen API key saved in Settings.

**A bot** has no GitHub session, so it signs in as the QA user. That only works on a
deployment that has QA sign-in switched on (`QA_LOGIN_SHA256`, see the README). Before
opening the site, post the secret from the same browser context, then load the page:

```js
const res = await context.request.post(`${origin}/api/auth/qa-login`, {
  headers: { "X-Studio-QA": "1" },
  data: { secret },
});
// 200: signed in for two hours. 401: wrong secret. 429: too many tries, wait ten minutes.
// 404: QA sign-in is off on this deployment.
await page.goto(origin);
```

Read the secret from where it is kept. Never paste it into a report, an issue, or a chat.
The QA user is not an admin and has no Oxen API key, which is why a bot skips steps 6 to 8.
In step 5 it will see the key section with no key saved. That is a pass.

## Steps

| # | Do this | Pass looks like |
| --- | --- | --- |
| 1 | Open the site. If asked, press **Continue with GitHub**. | The composer loads: a prompt box, a **Generate** button, and a top bar with Library, New, Projects, Slots, Settings. No error page, no "Access denied". |
| 2 | Press **Library**. | The panel opens with "Past work" and image tiles, or an empty state on a new account. Thumbnails load; none are broken. |
| 3 | In the Library, press **Galleries**, then open any gallery. | The gallery opens and its tiles load. **Galleries** returns to the list. Skip if the account has no galleries, and say so. |
| 4 | Close the Library. Press **Slots**. Click one slot row. | The list shows one row per slot with a name, an @handle, and a file count. The clicked row opens and any other open row closes. |
| 5 | Close Slots. Press **Settings**. | Settings opens and shows the "Oxen API key" section. Close it. |
| 6 (people only) | Choose **Text → Image**, pick a model, type `a plain red cube on a white table`, leave Count at **1×**, press **Generate**. | A tile appears on the canvas and reaches a finished image within 5 minutes. No error message on the tile. |
| 7 (people only) | Press **Library**. | The image from step 6 is the newest tile. |
| 8 (people only) | Delete that image from the Library. | The tile is gone and stays gone after a reload. |

On a phone the top-left menu button opens Library, Projects, Slots, and Galleries. Library and
Slots fill the whole screen there.

## Reporting

One line per step: the step number, pass or fail, and a screenshot for any failure. A bot
run reports steps 6 to 8 as skipped. Include
the deployed commit and the time. A failure at step 1 or 2 is urgent. A failure at step 6 with
steps 1 to 5 passing is usually Oxen or the model, not the deploy: note the model and the
error text.

## Cost

A bot run costs nothing: it skips steps 6 to 8. Step 6 runs one image at 1×, a few cents. Do not raise the count, pick a video model, or run
the step more than once per deploy.

## Keeping this current

Update this file in the same change that renames a control or moves a screen it mentions.
