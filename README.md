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
| `web/auto/` | **Second, separate weblink**: auto sign-in from the link itself (below) |

## The auto-link (second weblink, no login screen)

`web/auto/` is a self-contained second solution that skips the typed login:
the link carries base64 credentials and lands straight on the QR kiosk.

```
https://developerbilions.github.io/AOG-Kiosk-App/auto/?c=BASE64
https://developerbilions.github.io/AOG-Kiosk-App/auto/#c=BASE64   (preferred*)
```

- `BASE64` = `base64("username:password")` — generate with
  `echo -n 'username:password' | base64`. URL-safe base64 also accepted.
- *The `#c=` form is preferred: a URL fragment is never sent over the network,
  so the credentials can't end up in any server/CDN access log. `?c=` works too.
- Fully separate from the classic flow: own pages (`auto/index.html`,
  `auto/kiosk.html`), own `auto/config.js`, own localStorage keys
  (`aog_auto_*`) — signing in/out on one never affects the other. Only the
  promo media files (`web/*.webp`, `*.webm`) are shared, so content updates
  reach both.
- **The link IS the password** (base64 is encoding, not encryption). Share it
  like a credential; rotate the account password to revoke a leaked link.

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

# Debug build (quick local testing):
./gradlew :app:assembleDebug
# -> app/build/outputs/apk/debug/app-debug.apk

# Signed RELEASE build (what you sideload onto store TVs):
./gradlew :app:assembleRelease
# -> app/build/outputs/apk/release/app-release.apk
```

### Release signing

The release build is signed with a keystore. Signing is driven by a gitignored
`android/keystore.properties` (and the keystore itself):

```
storeFile=keystore/aog-kiosk-release.jks
storePassword=...
keyAlias=aogkiosk
keyPassword=...
```

The signing config explicitly enables **v1 + v2 + v3** signature schemes — some
Android TVs reject v1-only or v2-less APKs, which shows up as a vague
"App not installed". A pre-built signed APK is attached to each
[GitHub Release](https://github.com/DeveloperBilions/AOG-Kiosk-App/releases)
(and built locally into `dist/`, which is gitignored).

> **Back up the keystore + passwords.** If you lose them you can no longer ship
> updates that overwrite an already-installed copy (the signatures won't match).

## Sideloading onto an Android TV

> Download the current signed APK from the
> [latest GitHub Release](https://github.com/DeveloperBilions/AOG-Kiosk-App/releases/latest),
> or build it yourself (`./gradlew :app:assembleRelease`).

### Why "App not installed" happens (Android 9/10+ via USB)

On newer Android TV / Google TV, installing from a USB stick fails unless the
**specific file-manager app you open the APK with** is allowed to install
unknown apps. The permission is **per-app**, not global. Do this on the TV:

1. **Settings → Apps → Security & restrictions → Install unknown apps**
   (on some TVs: *Settings → System → … → Install unknown apps*).
2. Find the app you'll open the APK with (e.g. **X-plore**, **File Commander**,
   **Downloader**, **Files**) and toggle it **ON**.
3. Now open the APK from that file manager → **Install**.

If it still fails: uninstall any earlier copy first (a different signature on the
old build blocks the update — see below), and make sure you're using the
`-release.apk`, not a debug build.

### USB install (recommended for store TVs)

1. Copy the signed `app-release.apk` (from the Release or your local build) to a
   USB stick; plug it into the TV.
2. Open it with a file manager that's allowed to install unknown apps (above).
3. Install, then launch **AOG Kiosk** from the Android TV home screen.

### ADB install (if the TV is on your network)

```bash
adb connect <TV_IP>:5555          # TV IP is in network settings
# If an older/differently-signed copy is installed, remove it first:
adb uninstall com.thebilions.aogkiosk   # (ignore "not installed")
adb install -r dist/AOG-Kiosk-v1.0-release.apk
```

A signature-mismatch failure looks like `INSTALL_FAILED_UPDATE_INCOMPATIBLE`
— the uninstall step above clears it.

### Make it the always-on kiosk (optional hardening)

- Set AOG Kiosk as the **default launcher / home app** so it returns after reboot.
- Or use Android **screen pinning** / a dedicated-device (kiosk/lock-task) setup
  via MDM for locked-down stores.

## Notes

- `minSdk 21` (Android 5.0) covers essentially all Android TV hardware.
- The app declares `leanback` so it shows on the TV launcher, and marks
  touchscreen/leanback **not required** so the same APK also runs on phones/tablets.
- The TV remote **BACK** button is swallowed so the kiosk can't be exited by accident.
