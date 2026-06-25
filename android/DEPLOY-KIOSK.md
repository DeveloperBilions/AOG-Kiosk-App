# AOG Kiosk — Device Owner provisioning (true single-app lockdown)

This makes the tablet run **only** this app: no HOME, no recents, no notification
shade, no Settings, no way out. It requires making the app the device's
**Device Owner**, which can only be done on a tablet that has **no Google/user
account** yet — i.e. fresh out of the box or factory-reset.

> One-time, per tablet. Budget ~10 minutes each.

## Requirements
- Android tablet, **factory reset**, with setup wizard either skipped or completed
  **without adding any Google account** (this is the #1 cause of "device owner
  can't be set" — remove all accounts under Settings → Accounts if unsure).
- A computer with **ADB** installed (`platform-tools`).
- The signed APK (`app-release.apk`).

## Steps

1. **Build the APK**
   ```bash
   cd android
   ./gradlew assembleRelease
   # output: app/build/outputs/apk/release/app-release.apk
   ```

2. **On the tablet:** enable Developer Options (Settings → About → tap *Build
   number* 7×), then turn on **USB debugging**. Connect via USB and accept the
   debugging prompt.

3. **Install the app**
   ```bash
   adb install -r app/build/outputs/apk/release/app-release.apk
   ```

4. **Make it Device Owner** (the magic command)
   ```bash
   adb shell dpm set-device-owner com.thebilions.aogkiosk/.KioskDeviceAdminReceiver
   ```
   Expect: `Success: Device owner set to package com.thebilions.aogkiosk`.

   If it fails with *"Not allowed to set the device owner because there are
   already some accounts on the device"* → remove every account and retry, or
   factory reset and skip account setup.

5. **Launch once** (or reboot). The kiosk takes over: it pins itself, captures
   HOME, and relaunches on every boot.
   ```bash
   adb shell am start -n com.thebilions.aogkiosk/.KioskActivity
   ```

That's it. The tablet is now locked to the kiosk page.

## Updating content
You don't need to reinstall. The kiosk reloads `KIOSK_URL`
(`https://developerbilions.github.io/AOG-Kiosk-App/`) on resume and every 15 min.
Edit the page in `web/`, push, and every tablet picks it up. Change the URL or
refresh interval in `app/build.gradle` (`KIOSK_URL`, `REFRESH_INTERVAL_MS`) and
rebuild only if those need to change.

## Unlocking / decommissioning a tablet
Device Owner can't be removed by a normal user — that's the point. To release it:

```bash
# Removes device-owner + admin. App stays installed but no longer locks.
adb shell dpm remove-active-admin com.thebilions.aogkiosk/.KioskDeviceAdminReceiver
```
If ADB isn't available, a **factory reset** always clears Device Owner.

## What each piece does
- `KioskDeviceAdminReceiver` — whitelists the app for Lock Task mode and registers
  it as the persistent HOME activity.
- `KioskActivity.enterKioskMode()` — calls `startLockTask()`; unbreakable because
  of the whitelist. `setLockTaskFeatures(NONE)` hides all system UI.
- `BootReceiver` — relaunches the kiosk after a reboot/power cut.

## Tuning the lockdown
In `KioskActivity.enterKioskMode()`, `LOCK_TASK_FEATURE_NONE` is maximum lockdown.
To show, say, the system clock and notifications, OR the flags instead, e.g.:
`LOCK_TASK_FEATURE_SYSTEM_INFO | LOCK_TASK_FEATURE_NOTIFICATIONS`.
