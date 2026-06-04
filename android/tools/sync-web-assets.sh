#!/usr/bin/env bash
# Copy the canonical web/ page into the app's offline-fallback assets so the
# bundled copy (shown when the TV is offline) matches what's hosted.
# Run this after editing web/ and before rebuilding the APK.
set -euo pipefail
here="$(cd "$(dirname "$0")/../.." && pwd)"
src="$here/web"
dst="$here/android/app/src/main/assets/web"
mkdir -p "$dst"
cp "$src/index.html" "$dst/index.html"     # login screen — first screen shown
cp "$src/kiosk.html" "$dst/kiosk.html"      # store-mode kiosk page (post-login)
cp "$src/config.js" "$dst/config.js"        # shared API base + auth helper
cp "$src/QR.png" "$dst/QR.png"              # offline fallback QR
# Login screen art (banner carousel + logo).
mkdir -p "$dst/login"
cp "$src/login/"*.webp "$dst/login/"
cp "$src/login/logo.png" "$dst/login/logo.png"
echo "Synced web/ -> android assets:"
ls -laR "$dst"
