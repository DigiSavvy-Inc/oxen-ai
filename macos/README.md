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

The default build is ad-hoc signed and runs on the Mac that built it. To share it, sign
with a Developer ID (`SIGN_ID`) and notarize.
