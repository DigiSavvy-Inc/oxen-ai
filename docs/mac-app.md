# Oxen Studio for Mac: setup

The Mac app is a small native window onto a Studio deployment. It does not run Studio
itself, so you need the address of a running one (for example `https://studio.example.com`)
and an account that is allowed to sign in there.

Requirements: an Apple silicon Mac on macOS 13.3 or later.

## Install

1. Download the latest `Oxen-Studio-mac-*.zip` from
   [Releases](https://github.com/DigiSavvy-Inc/oxen-ai/releases).
2. Unzip it and drag **Oxen Studio** into Applications.

## First launch

The app is not notarized yet
([#56](https://github.com/DigiSavvy-Inc/oxen-ai/issues/56)), so macOS blocks it one time.

1. Open **Oxen Studio**. macOS says it cannot be verified. Click **Done**.
2. Open System Settings → Privacy & Security and scroll down to Security.
3. Next to the Oxen Studio message, click **Open Anyway** and confirm.

You only do this once per version you install.

## Connect and sign in

1. The app asks for a **Studio address**. Enter the full URL of your deployment,
   starting with `https://`, and click **Open**.
2. Click **Sign in with GitHub**. macOS asks whether Oxen Studio may use that site to
   sign in; click **Continue**.
3. Finish the GitHub sign-in in the browser window that opens. Passkeys, GitHub Mobile,
   and authenticator codes all work there. The window closes and the app is signed in.
4. Open Settings (`⌘,`) and add your Oxen API key if you have not saved one for this
   account yet. The key is stored by the Studio deployment, so a key you already saved
   in the browser is already there.

If GitHub signs you in but Studio shows **Access denied**, your account is not in the
deployment's GitHub org or on its allowlist. Ask the admin to add you.

## Using it

| Action | Shortcut |
| --- | --- |
| Settings | `⌘,` |
| Library | `⌘⇧L` |
| Reload | `⌘R` |
| Back to Studio home | `⌘⇧H` |
| Zoom in, out, reset | `⌘+`, `⌘-`, `⌘0` |

- Downloads save to your Downloads folder.
- Links that leave Studio, such as Buy Credits, open in your default browser.
- Generations run on the server. Quitting the app does not cancel them.
- To point the app at a different deployment, choose **Oxen Studio → Change Server…**.

## Troubleshooting

**The sign-in window shows Studio already signed in and never closes.** The deployment is
running an older Worker without Mac sign-in. Close the window and ask the admin to deploy
the current `main`.

**"Sign-in expired. Try again."** The handoff from the browser is valid for two minutes.
Start the sign-in again.

**"Can't reach Studio."** Check the connection and click **Try again**. If the address
is wrong, use **Change Server…**.

**Start over.** Quit the app and run `defaults delete studio.oxen.mac` in Terminal. The
next launch asks for the address again.

## Updating and removing

To update, download the newer zip and replace the app in Applications, then repeat the
first-launch approval. To remove it, drag the app to the Trash.

## For whoever runs the deployment

- Deploy the current `main`. Mac sign-in needs the `/api/auth/native` route; nothing
  else changes. No new variables, secrets, or migrations, and the GitHub OAuth callback
  URL stays the same.
- `ENCRYPTION_KEY` must be set (it already is on any working deployment). Mac sign-in
  refuses to run without it.
- To hand your team a build that skips the address prompt, build it with your URL baked
  in. This needs only the Xcode Command Line Tools:

  ```bash
  cd macos
  STUDIO_URL=https://studio.example.com ZIP=1 ./build.sh
  ```

  The zip is written to `macos/build/`. `macos/build.sh` lists the other options (app
  name, bundle id, icon, signing identity).
