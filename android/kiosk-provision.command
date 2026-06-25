#!/bin/bash
#
# One-tap kiosk provisioning for macOS.
# Double-click this file (or run: bash kiosk-provision.command).
#
# It will: download Android ADB if needed -> install the app on the connected
# tablet -> make it Device Owner (unbreakable kiosk) -> launch it.
# This is a ONE-TIME step per tablet. Content updates keep working afterward.

set -e
cd "$(dirname "$0")"

PKG="com.thebilions.aogkiosk"
ADMIN="$PKG/.KioskDeviceAdminReceiver"

echo "============================================"
echo "  AOG Kiosk — tablet setup"
echo "============================================"
echo
echo "Before you continue, on the TABLET:"
echo "  1. It must be FACTORY RESET with NO Google account added"
echo "     (Settings > Accounts must be empty)."
echo "  2. Settings > About > tap 'Build number' 7 times to unlock"
echo "     Developer options."
echo "  3. Settings > Developer options > turn ON 'USB debugging'."
echo "  4. Plug the tablet into this Mac with a USB cable and tap"
echo "     'Allow' on the debugging popup."
echo
read -p "Press Enter once that's done... "

# --- 1. Get adb (download Google's platform-tools if not already present) ----
if command -v adb >/dev/null 2>&1; then
  ADB="adb"
elif [ -x "./platform-tools/adb" ]; then
  ADB="./platform-tools/adb"
else
  echo "Downloading Android platform-tools (one time)..."
  curl -L -o platform-tools.zip \
    https://dl.google.com/android/repository/platform-tools-latest-darwin.zip
  unzip -q -o platform-tools.zip
  rm -f platform-tools.zip
  ADB="./platform-tools/adb"
fi

# --- 2. Find the built APK -------------------------------------------------
APK=$(ls -t app/build/outputs/apk/release/*.apk \
            app/build/outputs/apk/debug/*.apk 2>/dev/null | head -1 || true)
if [ -z "$APK" ]; then
  echo
  echo "!! No APK found. Build it first:"
  echo "     ./gradlew assembleRelease"
  echo "   then run this script again."
  read -p "Press Enter to close. "
  exit 1
fi
echo "Using APK: $APK"

# --- 3. Wait for the tablet ------------------------------------------------
echo "Looking for the tablet..."
"$ADB" wait-for-device
echo "Tablet connected."

# --- 4. Install + lock down ------------------------------------------------
echo "Installing the app..."
"$ADB" install -r "$APK"

echo "Enabling kiosk lockdown (Device Owner)..."
if "$ADB" shell dpm set-device-owner "$ADMIN"; then
  echo "Kiosk lockdown enabled."
else
  echo
  echo "!! Could not set Device Owner. Almost always this means an account is"
  echo "   still on the tablet. Remove every account (Settings > Accounts) or"
  echo "   factory-reset and skip account setup, then run this script again."
  read -p "Press Enter to close. "
  exit 1
fi

echo "Launching the kiosk..."
"$ADB" shell am start -n "$PKG/.KioskActivity" >/dev/null 2>&1 || true

echo
echo "============================================"
echo "  Done. The tablet is now locked to the app."
echo "============================================"
read -p "Press Enter to close. "
