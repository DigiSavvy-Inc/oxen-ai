#!/bin/bash
# Builds "build/<APP_NAME>.app" with the Swift toolchain alone (no Xcode project).
#
#   STUDIO_URL=https://studio.example.com ./build.sh
#
# STUDIO_URL  deployment the app opens; leave unset and the app asks on first launch
# APP_NAME    default "Oxen Studio"
# BUNDLE_ID   default studio.oxen.mac
# ICON_SRC    square PNG, default ../public/icon-512.png
# SIGN_ID     codesign identity, default "-" (ad-hoc; other Macs must approve it once)
# ZIP=1       also write build/<APP_NAME>.zip for sharing
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="${APP_NAME:-Oxen Studio}"
BUNDLE_ID="${BUNDLE_ID:-studio.oxen.mac}"
ICON_SRC="${ICON_SRC:-../public/icon-512.png}"
SIGN_ID="${SIGN_ID:--}"
VERSION="${VERSION:-0.1.0}"
STUDIO_URL="${STUDIO_URL:-}"

swift build -c release
BIN="$(swift build -c release --show-bin-path)/OxenStudio"

APP="build/$APP_NAME.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/OxenStudio"

ICONSET="build/AppIcon.iconset"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
for size in 16 32 128 256; do
  sips -z "$size" "$size" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
sips -z 512 512 "$ICON_SRC" --out "$ICONSET/icon_512x512.png" >/dev/null
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
rm -rf "$ICONSET"

PLIST="$APP/Contents/Info.plist"
cat > "$PLIST" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>OxenStudio</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>LSMinimumSystemVersion</key><string>13.3</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.graphics-design</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
EOF
plutil -insert CFBundleName -string "$APP_NAME" "$PLIST"
plutil -insert CFBundleDisplayName -string "$APP_NAME" "$PLIST"
plutil -insert CFBundleIdentifier -string "$BUNDLE_ID" "$PLIST"
plutil -insert CFBundleShortVersionString -string "$VERSION" "$PLIST"
plutil -insert CFBundleVersion -string "$VERSION" "$PLIST"
if [ -n "$STUDIO_URL" ]; then
  plutil -insert StudioURL -string "$STUDIO_URL" "$PLIST"
fi

codesign --force --sign "$SIGN_ID" "$APP"
echo "Built $PWD/$APP"

if [ -n "${ZIP:-}" ]; then
  # ditto keeps the signature and bundle metadata intact; plain zip can break both.
  ditto -c -k --keepParent "$APP" "build/$APP_NAME.zip"
  echo "Zipped $PWD/build/$APP_NAME.zip"
fi
