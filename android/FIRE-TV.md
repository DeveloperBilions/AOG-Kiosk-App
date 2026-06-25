# AOG Kiosk on Amazon Fire TV Stick

The same APK runs on a Fire TV Stick — it just **sideloads** instead of using the
Android-TV/tablet Device-Owner flow. This doc covers what works, what doesn't, and
how to install.

## What you get on Fire TV vs. a real Android TV / tablet

| Capability | Android TV box / tablet | Fire TV Stick (Fire OS) |
|---|---|---|
| Installs & shows the page full-screen | ✅ | ✅ |
| Auto-relaunch on boot | ✅ | ✅ |
| Auto-refresh hosted page every 15 min | ✅ | ✅ |
| Swallow remote **BACK** | ✅ | ✅ |
| Self-heal on WebView render crash | ✅ | ✅ |
| **Unbreakable** Device-Owner lockdown | ✅ | ❌ *not available* |
| QR provisioning | ✅ | ❌ *not available* |

> **Important:** Fire OS is a fork of Android that **removes the Device-Owner /
> managed-provisioning framework**. The QR-provisioning flow and
> `dpm set-device-owner` do **not** work on a stock Fire TV Stick. The app
> detects this and degrades gracefully — it still runs full-screen and captures
> BACK, but a determined user can press the Fire remote's **HOME** to leave it.
> There is no supported way to make a stock Fire TV Stick a true single-app kiosk
> without an Amazon enterprise (Fire TV for Business / Tap to Manage / MDM)
> program.

## Sideloading the APK

### 1. Build it
```bash
cd android
./gradlew assembleRelease   # signed: app/build/outputs/apk/release/app-release.apk
# (or assembleDebug for app-debug.apk while testing)
```

### 2. Enable installs on the Fire TV Stick
On the Stick: **Settings → My Fire TV → Developer Options** →
- turn **ADB debugging** = ON
- turn **Apps from Unknown Sources** = ON

(On newer Fire OS, Developer Options is hidden until you go to
**Settings → My Fire TV → About**, highlight the device name, and click it 7×.)

Note the Stick's IP: **Settings → My Fire TV → About → Network**.

### 3a. Install over the network with ADB
```bash
adb connect <FIRE_TV_IP>:5555          # accept the prompt on the TV the first time
adb install -r app/build/outputs/apk/release/app-release.apk
adb shell monkey -p com.thebilions.aogkiosk -c android.intent.category.LAUNCHER 1
```

### 3b. — or — install with the **Downloader** app (no computer)
1. Install **Downloader** from the Fire TV Appstore.
2. Host `app-release.apk` at a URL (e.g. a GitHub release asset) and enter it in
   Downloader.
3. Downloader fetches and prompts to install.

### 4. Launch
The app appears in **Your Apps & Channels** on the Fire TV home row (it carries a
TV banner). Open it once; it then relaunches on every boot.

## Updating content
Same as every other device — no reinstall. The kiosk reloads `KIOSK_URL`
(`https://developerbilions.github.io/AOG-Kiosk-App/`) on resume and every 15 min.
Edit the page in `web/`, push, and the Stick picks it up. Change the URL/interval
in `app/build.gradle` and rebuild only if those need to change.

## Fire-TV-specific notes
- **Older WebView.** Fire OS bundles an older Chromium than stock Android TV. The
  app sets mixed-content compatibility, file access, and a tagged user-agent
  (`AOGKiosk/<version>`) to keep the hosted page rendering. If the page looks
  broken only on the Stick, test the hosted URL in Fire OS's Silk browser — that's
  the same engine the WebView uses and will reveal the failing JS/CSS feature.
- **Render-crash recovery.** On Fire OS 6+ (API 26+) a WebView renderer crash is
  caught and the kiosk rebuilds itself; on older Fire OS it self-corrects on the
  next 15-min refresh instead.
- **No touchscreen.** Navigation is via the Fire remote D-pad; the hosted page
  must be usable without touch.

## Troubleshooting
- `INSTALL_FAILED_OLDER_SDK` → the Stick's Fire OS is older than `minSdk 21`
  (only the very first-gen Stick). Not supported.
- `INSTALL_FAILED_NO_MATCHING_ABIS` → not applicable here (no native libs), but if
  seen, the APK is fine; reconnect ADB.
- App installs but isn't on the home row → open **Settings → Applications → Manage
  Installed Applications** and launch it once; it then appears.
