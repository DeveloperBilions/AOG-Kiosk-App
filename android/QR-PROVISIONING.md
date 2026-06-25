# AOG Kiosk — QR provisioning (kiosk lockdown with NO ADB)

This makes a tablet an unbreakable single-app kiosk by **scanning a QR code** on
the factory-reset welcome screen. No computer is attached to the tablet, no ADB.

You do the prep work **once** (build + host the APK, generate one QR). After that,
every new tablet is: factory reset → tap 6 times → scan → done.

> Requires the tablet to be Android 7+ (QR enrollment). Android 9+ recommended.

---

## One-time prep (on your Mac)

### 1. Build a SIGNED release APK
Device-owner QR enrollment only accepts a signed APK whose certificate matches the
QR. Make sure `android/keystore.properties` is set up, then:
```bash
cd android
./gradlew assembleRelease
# -> app/build/outputs/apk/release/app-release.apk
```

### 2. Host the APK at an HTTPS URL
The tablet downloads the APK from a URL during setup, so it must be publicly
reachable over HTTPS **without auth** (the tablet has no account yet when it
fetches it).

#### Option A — AWS S3 (current setup)
A dedicated, least-privilege bucket already hosts the APK:
`aog-kiosk-apk-309524473584-us-east-2` (region `us-east-2`, AWS account
`309524473584`). Only objects under `v1.1/*` are public-read; bucket ACLs stay
blocked. The current download URL is:

```
https://aog-kiosk-apk-309524473584-us-east-2.s3.us-east-2.amazonaws.com/v1.1/app-release.apk
```

To (re)upload a freshly built signed APK to that URL:
```bash
cd android
aws s3 cp app/build/outputs/apk/release/app-release.apk \
  s3://aog-kiosk-apk-309524473584-us-east-2/v1.1/app-release.apk \
  --content-type application/vnd.android.package-archive
# Verify it's publicly downloadable (expect HTTP/1.1 200 OK):
curl -sI "https://aog-kiosk-apk-309524473584-us-east-2.s3.us-east-2.amazonaws.com/v1.1/app-release.apk" \
  | grep -iE "HTTP/|content-type|content-length"
```

For a **new app version**, upload under a new prefix (e.g. `v1.2/app-release.apk`)
so old QRs keep working, then regenerate the QR against the new URL. If you ever
need to recreate the bucket from scratch, the one-time setup was:
```bash
BUCKET=aog-kiosk-apk-309524473584-us-east-2
aws s3api create-bucket --bucket "$BUCKET" --region us-east-2 \
  --create-bucket-configuration LocationConstraint=us-east-2
# Allow a public bucket policy, but keep ACL-based exposure off:
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false"
# Public-read scoped to the APK prefix ONLY (not the whole bucket):
aws s3api put-bucket-policy --bucket "$BUCKET" --policy '{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadKioskApk", "Effect": "Allow", "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::aog-kiosk-apk-309524473584-us-east-2/v1.1/*"
  }]
}'
```
> The S3 object is intentionally world-readable — it must be, for the tablet to
> download it during setup. It contains only the APK (no secrets), but anyone
> with the URL can fetch it.

#### Option B — GitHub Release (alternative)
- Go to your repo → Releases → Draft a new release → upload `app-release.apk`.
- Copy the asset URL, e.g.
  `https://github.com/<you>/AOG-Kiosk-App/releases/download/v1.1/app-release.apk`

(GitHub Pages also works if you commit the APK to the `web/` folder, but Releases
is cleaner and doesn't bloat the Pages site.)

### 3. Generate the enrollment QR
```bash
pip install "qrcode[pil]"

cd android/tools
python3 make-enrollment-qr.py \
  --apk ../app/build/outputs/apk/release/app-release.apk \
  --url https://aog-kiosk-apk-309524473584-us-east-2.s3.us-east-2.amazonaws.com/v1.1/app-release.apk \
  --wifi-ssid "ShopWiFi" --wifi-pass "yourpassword" \
  --out enrollment-qr.png
```
This prints the provisioning payload and writes `enrollment-qr.png`. Print it or
keep it on a second screen to scan. The `--wifi-*` flags let the tablet get online
during setup; omit them if you'll connect Wi-Fi manually on the welcome screen.

> The script reads your APK's **signing-certificate checksum** automatically (via
> `apksigner`, falling back to `keytool`). If neither is on PATH, see "Getting the
> checksum by hand" below and pass `--checksum`.

---

## Per-tablet enrollment (no computer)

1. **Factory reset** the tablet (Settings → System → Reset, or recovery menu).
2. On the very first **welcome screen**, tap the screen **6 times** in the same
   spot. A QR scanner opens ("Set up your device via QR code").
3. Connect Wi-Fi if prompted (or it uses the Wi-Fi baked into the QR).
4. **Scan `enrollment-qr.png`.** Android downloads the APK, verifies the
   signature, and sets it as Device Owner.
5. The kiosk launches itself and locks down. Nothing else to do.

---

## Updating content and the app
- **Content**: unchanged — the kiosk reloads `KIOSK_URL` on resume and every
  15 min. Edit `web/`, push, done. No re-enrollment.
- **New app version**: upload the new signed APK and push it however you manage
  updates; Device Owner persists across reinstalls signed with the same key. You
  only regenerate the QR if the **signing key** changes (it shouldn't).

## Releasing a tablet
Device Owner survives normal use by design. To clear it, **factory reset** the
tablet (always works), or if you have ADB handy:
```bash
adb shell dpm remove-active-admin com.thebilions.aogkiosk/.KioskDeviceAdminReceiver
```

---

## Getting the checksum by hand (only if the script can't)
The QR needs the SHA-256 of your **signing certificate**, base64url-encoded.
```bash
# Option A: from the signed APK
apksigner verify --print-certs app-release.apk
#  -> "...certificate SHA-256 digest: <HEX>"

# Option B: from the keystore
keytool -list -v -keystore your.keystore -alias your-alias
#  -> "SHA256: AA:BB:CC:..."
```
`--checksum` expects the **base64url** form, not the raw hex above — so the
simplest path is always to run the script with `--apk`, which reads the hex and
converts it for you. Only convert by hand (hex bytes → base64url, no padding) if
you genuinely can't point the script at the APK.

## How it works (the moving parts)
- `KioskDeviceAdminReceiver.onProfileProvisioningComplete` — fires when QR
  enrollment finishes (Android 7–10); applies the kiosk policy and launches it.
- `ProvisioningActivity` — answers the Android 11+ provisioning handshake
  (`GET_PROVISIONING_MODE` → fully managed; `ADMIN_POLICY_COMPLIANCE` → apply
  policy, launch kiosk).
- `make-enrollment-qr.py` — turns your signed APK + download URL into the QR.
