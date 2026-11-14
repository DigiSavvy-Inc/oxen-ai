# Releasing the Mac app

How to cut a new version of Oxen Studio for Mac and publish it as a download. About 10
minutes. The result is a zip on the GitHub Releases page that people install by following
[mac-app.md](mac-app.md).

The app is not notarized yet
([#56](https://github.com/DigiSavvy-Inc/oxen-ai/issues/56)). Until that is done, every
release is ad-hoc signed and published as a pre-release, and each person approves it once
in System Settings.

## Before you start

- An Apple silicon Mac with the Xcode Command Line Tools (`xcode-select --install`). The
  build is arm64 only.
- The GitHub CLI (`gh`), signed in with push access to the repo.
- A checkout of `main` that is up to date and has nothing uncommitted under `macos/`.

## 1. Pick the version

Use `MAJOR.MINOR.PATCH`. The tag is `mac-v` plus the version, for example `mac-v0.2.0`,
so Mac releases never collide with a version of Studio itself.

See what is already out:

```bash
gh release list -R DigiSavvy-Inc/oxen-ai
```

The commands below use a shell variable so the number is typed once:

```bash
VERSION=0.2.0
```

## 2. Ship any Worker changes first

If this version depends on a server change (a new route, a changed sign-in step), deploy
the Worker before you publish the app. Otherwise people download an app their Studio
cannot talk to. Deploy steps are in [cloudflare-setup.md](cloudflare-setup.md) under
Updating.

Say so in the release notes when a newer Worker is required, because self-hosters run
their own.

## 3. Build

```bash
cd macos
env -u STUDIO_URL VERSION="$VERSION" ZIP=1 ./build.sh
```

`env -u STUDIO_URL` makes sure no address is baked in. A public build must ask each
person for their own Studio address.

This writes `build/Oxen Studio.app` and `build/Oxen Studio.zip`, replacing any earlier
build in that folder.

## 4. Check the build

```bash
plutil -p "build/Oxen Studio.app/Contents/Info.plist" | grep -E "ShortVersion|StudioURL"
codesign --verify --deep --strict "build/Oxen Studio.app" && echo "signature ok"
```

Expect one line with your version, **no** `StudioURL` line, and `signature ok`.

Then open it and try the things a wrapper can break:

```bash
open "build/Oxen Studio.app"
```

1. It asks for a Studio address. If it skips the prompt, an address is saved from an
   earlier run; that is fine, or run `defaults delete studio.oxen.mac` to see the prompt.
2. Log out, then sign in with GitHub through the browser.
3. Download one image and confirm it appears in Downloads.
4. Press `⌘,` and confirm Settings opens.

## 5. Name the zip

```bash
cp "build/Oxen Studio.zip" "build/Oxen-Studio-mac-$VERSION.zip"
```

Do not re-zip the app with Finder or `zip`; the build uses `ditto` so the signature
survives.

## 6. Write the notes

Put the notes in a file, for example `build/notes.md`. Keep this shape:

```markdown
What changed, in a few plain bullets.

Your Studio deployment must be running <commit or date> or newer.   <- only if true

## First launch

This build is not notarized yet (#56), so macOS blocks it once:

1. Unzip and move **Oxen Studio** to Applications.
2. Open it; macOS says it cannot be verified. Click **Done**.
3. System Settings → Privacy & Security → scroll to Security → **Open Anyway**.

Requires macOS 13.3 or later, Apple silicon.
```

## 7. Publish

Commit and push anything that belongs to this version first, then:

```bash
gh release create "mac-v$VERSION" "build/Oxen-Studio-mac-$VERSION.zip" \
  -R DigiSavvy-Inc/oxen-ai \
  --target "$(git rev-parse origin/main)" \
  --prerelease \
  --title "Oxen Studio for Mac $VERSION" \
  --notes-file build/notes.md
```

`--target` needs the full commit hash; a short one is rejected. Keep `--prerelease`
until the app is notarized.

## 8. Confirm the download works

```bash
gh release view "mac-v$VERSION" -R DigiSavvy-Inc/oxen-ai --json url,isPrerelease,assets \
  --jq '"\(.url)  prerelease=\(.isPrerelease)  \(.assets[0].name)"'
```

Then download the zip **in a browser**, not with `gh`, and install it the way a new
person would. A browser download is quarantined by macOS, so this is the only way to see
the real first-launch experience. Best done on a second Mac.

If the install steps changed, update [mac-app.md](mac-app.md) in the same push.

## Fixing a bad release

Replace the file on an existing release:

```bash
gh release upload "mac-v$VERSION" "build/Oxen-Studio-mac-$VERSION.zip" \
  -R DigiSavvy-Inc/oxen-ai --clobber
```

If people may already have the bad build, publish a new patch version instead so they
can tell the two apart. To pull a release entirely:

```bash
gh release delete "mac-v$VERSION" -R DigiSavvy-Inc/oxen-ai --cleanup-tag
```

## A private build for your own team

To skip the address prompt for people on one deployment, bake the URL in and hand the
zip over directly. Do not attach this one to a public release.

```bash
STUDIO_URL=https://studio.example.com VERSION="$VERSION" ZIP=1 ./build.sh
```

## Once the app is notarized

When #56 is done, `build.sh` will sign with a Developer ID, notarize, and produce a DMG.
At that point drop `--prerelease`, remove the First launch section from the notes, and
update this page and [mac-app.md](mac-app.md).
