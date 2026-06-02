#!/usr/bin/env bash
# Copy the canonical web/ page into the app's offline-fallback assets so the
# bundled copy (shown when the TV is offline) matches what's hosted.
# Run this after editing web/ and before rebuilding the APK.
set -euo pipefail
here="$(cd "$(dirname "$0")/../.." && pwd)"
src="$here/web"
dst="$here/android/app/src/main/assets/web"
mkdir -p "$dst"
cp "$src/index.html" "$dst/index.html"
cp "$src/QR.png" "$dst/QR.png"
echo "Synced web/ -> android assets:"
ls -la "$dst"
