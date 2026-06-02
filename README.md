# AOG Store Kiosk

In-store "scan to join" kiosk for Android TV. A single full-screen web page
(the promo loop + sign-up QR) packaged as a native Android TV app you sideload
onto TVs in stores.

## How it works (the important part)

```
  web/index.html + web/QR.png
        │  push to main
        ▼
  GitHub Actions → GitHub Pages
        │  https://developerbilions.github.io/AOG-Kiosk-App/
        ▼
  Android TV app (WebView)  ──auto-refresh every 15 min──┐
        │                                                 │
        └─ if offline → bundled copy in app assets ◄──────┘
```

- The app loads the **hosted page** and **silently reloads it every 15 minutes**
  (and whenever the app resumes). So to change the QR or any content you just
  **edit `web/` and push** — every TV updates itself. **No reinstall, no store visit.**
- If a TV's internet is down, the app falls back to a **bundled offline copy** of
  the page so the screen is never blank.

You build & sideload the APK **once per TV**. After that, content is pure web edits.

## Repo layout

| Path | What |
|------|------|
| `web/index.html` | The kiosk page (canonical source, served by GitHub Pages) |
| `web/QR.png` | The fixed sign-up QR shown on the page |
| `.github/workflows/deploy-pages.yml` | Auto-deploys `web/` to GitHub Pages on push |
| `android/` | Android TV WebView app (Gradle project) |
| `android/app/src/main/assets/web/` | Offline fallback copy of the page (kept in sync) |
| `android/tools/sync-web-assets.sh` | Copies `web/` → app assets before a rebuild |

## Updating the kiosk content (the everyday workflow)

1. Edit `web/index.html` and/or replace `web/QR.png`.
2. (Optional, for offline fallback parity) `./android/tools/sync-web-assets.sh`
3. `git commit && git push` → Pages redeploys → TVs auto-refresh within 15 min.

You only rebuild/redistribute the APK if you change the **app** (URL, refresh
interval, kiosk behaviour) — not for content.

## Configuration

Both live in [`android/app/build.gradle`](android/app/build.gradle) under `defaultConfig`:

- `KIOSK_URL` — the hosted page the TV loads.
- `REFRESH_INTERVAL_MS` — auto-refresh cadence (currently 15 minutes).

## Building the APK

Requirements: JDK 17 and the Android SDK (build-tools 34, platform android-34).
The Gradle wrapper handles Gradle itself.

```bash
cd android
# Point Gradle at your SDK (once):
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties

# Debug build (installable immediately):
./gradlew :app:assembleDebug
# -> app/build/outputs/apk/debug/app-debug.apk
```

For store distribution, produce a signed **release** APK (create a keystore,
add a `signingConfig`, then `./gradlew :app:assembleRelease`).

## Sideloading onto an Android TV

1. On the TV: **Settings → Device Preferences → About →** click *Build* 7×
   to enable Developer options, then enable **USB debugging** /
   **Apps from unknown sources**.
2. Connect over network ADB (find the TV's IP in network settings):
   ```bash
   adb connect <TV_IP>:5555
   adb install -r android/app/build/outputs/apk/debug/app-debug.apk
   ```
   …or copy the APK to a USB stick and install it with a file manager on the TV.
3. Launch **AOG Kiosk** from the Android TV home screen (it has a TV banner).

### Make it the always-on kiosk (optional hardening)

- Set AOG Kiosk as the **default launcher / home app** so it returns after reboot.
- Or use Android **screen pinning** / a dedicated-device (kiosk/lock-task) setup
  via MDM for locked-down stores.

## Notes

- `minSdk 21` (Android 5.0) covers essentially all Android TV hardware.
- The app declares `leanback` so it shows on the TV launcher, and marks
  touchscreen/leanback **not required** so the same APK also runs on phones/tablets.
- The TV remote **BACK** button is swallowed so the kiosk can't be exited by accident.
