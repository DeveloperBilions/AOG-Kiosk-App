#!/usr/bin/env python3
"""
Generate an Android Enterprise enrollment QR for the AOG Kiosk app.

Scanning this QR on a FACTORY-RESET tablet's welcome screen (tap the screen
6 times to open the scanner) makes the app the device's Device Owner over the
air -- no ADB, no computer attached to the tablet.

What you need first:
  1. A SIGNED release APK (signed with your keystore).
  2. That APK hosted at an HTTPS URL the tablet can reach during setup
     (e.g. a GitHub Release asset, or any web host). This is the --url value.

Usage:
  python3 make-enrollment-qr.py \
      --apk ../app/build/outputs/apk/release/app-release.apk \
      --url https://github.com/<you>/AOG-Kiosk-App/releases/download/v1.1/app-release.apk \
      --wifi-ssid "ShopWiFi" --wifi-pass "hunter2" \
      --out enrollment-qr.png

If you can't point the script at the APK, pass the signing-cert checksum
manually with --checksum (see "Getting the checksum by hand" below).

Requires:  pip install "qrcode[pil]"
"""

import argparse
import base64
import hashlib
import json
import re
import shutil
import subprocess
import sys
import zipfile

PACKAGE = "com.thebilions.aogkiosk"
ADMIN_COMPONENT = PACKAGE + "/.KioskDeviceAdminReceiver"


def hex_to_base64url(hex_str: str) -> str:
    """Convert a hex SHA-256 digest to the base64url (no padding) form the
    provisioning extra expects."""
    raw = bytes.fromhex(hex_str.replace(":", "").strip())
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def checksum_via_apksigner(apk_path: str):
    """Try to read the signing-certificate SHA-256 using apksigner (preferred)."""
    apksigner = shutil.which("apksigner")
    if not apksigner:
        return None
    try:
        out = subprocess.run(
            [apksigner, "verify", "--print-certs", apk_path],
            capture_output=True, text=True, check=True,
        ).stdout
    except subprocess.CalledProcessError:
        return None
    m = re.search(r"certificate SHA-256 digest:\s*([0-9a-fA-F]+)", out)
    return hex_to_base64url(m.group(1)) if m else None


def checksum_via_keytool(apk_path: str):
    """Fallback: extract the signer cert from the APK and hash it ourselves.
    Uses keytool, which ships with the JDK you already build with."""
    keytool = shutil.which("keytool")
    if not keytool:
        return None
    try:
        out = subprocess.run(
            [keytool, "-printcert", "-jarfile", apk_path],
            capture_output=True, text=True, check=True,
        ).stdout
    except subprocess.CalledProcessError:
        return None
    m = re.search(r"SHA256:\s*([0-9A-Fa-f:]+)", out)
    return hex_to_base64url(m.group(1)) if m else None


def main():
    p = argparse.ArgumentParser(description="Build an AOG Kiosk enrollment QR.")
    p.add_argument("--url", required=True,
                   help="HTTPS URL where the SIGNED APK is hosted (tablet downloads it).")
    p.add_argument("--apk", help="Path to the signed APK (to auto-compute the checksum).")
    p.add_argument("--checksum",
                   help="Signing-cert SHA-256 as base64url, if you can't pass --apk.")
    p.add_argument("--wifi-ssid", help="Wi-Fi network to join during setup (optional).")
    p.add_argument("--wifi-pass", help="Wi-Fi password (optional).")
    p.add_argument("--wifi-security", default="WPA",
                   choices=["WPA", "WEP", "NONE"], help="Wi-Fi security type.")
    p.add_argument("--out", default="enrollment-qr.png", help="Output PNG path.")
    args = p.parse_args()

    # --- Resolve the signing checksum --------------------------------------
    checksum = args.checksum
    if not checksum and args.apk:
        checksum = checksum_via_apksigner(args.apk) or checksum_via_keytool(args.apk)
    if not checksum:
        sys.exit(
            "ERROR: couldn't determine the signing checksum.\n"
            "Pass --apk <signed apk> (needs apksigner or keytool on PATH), or\n"
            "compute it by hand and pass --checksum. See header for how.")

    # --- Build the provisioning payload ------------------------------------
    payload = {
        "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME": ADMIN_COMPONENT,
        "android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM": checksum,
        "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION": args.url,
        # Keep the stock Settings/system apps available (you'll want Settings).
        "android.app.extra.PROVISIONING_LEAVE_ALL_SYSTEM_APPS_ENABLED": True,
        # Skip the forced full-disk encryption prompt for a faster setup.
        "android.app.extra.PROVISIONING_SKIP_ENCRYPTION": True,
    }
    if args.wifi_ssid:
        payload["android.app.extra.PROVISIONING_WIFI_SSID"] = args.wifi_ssid
        payload["android.app.extra.PROVISIONING_WIFI_SECURITY_TYPE"] = args.wifi_security
        if args.wifi_pass:
            payload["android.app.extra.PROVISIONING_WIFI_PASSWORD"] = args.wifi_pass

    qr_text = json.dumps(payload)

    # --- Render the QR ------------------------------------------------------
    try:
        import qrcode
    except ImportError:
        sys.exit('ERROR: qrcode not installed. Run:  pip install "qrcode[pil]"')

    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=8, border=2)
    qr.add_data(qr_text)
    qr.make(fit=True)
    qr.make_image(fill_color="black", back_color="white").save(args.out)

    print("Provisioning payload:")
    print(json.dumps(payload, indent=2))
    print(f"\nQR written to: {args.out}")
    print("\nNext: factory reset the tablet, and on the very first welcome")
    print("screen tap 6 times to open the QR scanner, then scan this image.")


if __name__ == "__main__":
    main()
