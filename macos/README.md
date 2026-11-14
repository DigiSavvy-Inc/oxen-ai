# Oxen Studio for Mac

A small Swift shell around a Studio deployment: Dock app, native menus (`⌘,` opens
Settings), downloads to `~/Downloads`, and GitHub sign-in through your real browser so
passkeys and GitHub Mobile work.

```bash
STUDIO_URL=https://studio.example.com ./build.sh
open "build/Oxen Studio.app"
```

Needs only the Swift toolchain (Xcode Command Line Tools). Leave `STUDIO_URL` unset and
the app asks for the address on first launch. `build.sh` lists the other options.

Setup guide for people you share it with: [docs/mac-app.md](../docs/mac-app.md).

## Sharing it

`ZIP=1 ./build.sh` also writes `build/Oxen Studio.zip`. The build is not notarized yet
(#56), so macOS blocks the first launch on another Mac:

1. Unzip and move **Oxen Studio** to Applications.
2. Open it once; macOS says it cannot be verified. Click **Done**.
3. System Settings → Privacy & Security → scroll to Security → **Open Anyway**.

After that it opens normally.
