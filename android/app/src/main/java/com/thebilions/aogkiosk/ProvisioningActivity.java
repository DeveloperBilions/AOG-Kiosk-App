package com.thebilions.aogkiosk;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

/**
 * Handles the Android 11+ (API 29+) fully-managed-device provisioning handshake.
 *
 * <p>Modern Android requires the Device Owner app to answer two system intents
 * during QR enrollment:
 * <ul>
 *   <li>{@code GET_PROVISIONING_MODE} — we declare we want a fully managed device.</li>
 *   <li>{@code ADMIN_POLICY_COMPLIANCE} — we apply our kiosk policy and signal we're
 *       compliant, which lets setup finish.</li>
 * </ul>
 * On Android 7–10 these intents aren't sent; provisioning is finalized in
 * {@link KioskDeviceAdminReceiver#onProfileProvisioningComplete} instead.
 *
 * <p>String literals (not DevicePolicyManager constants) are used so the class
 * compiles cleanly against {@code minSdk 21}; the activity is only ever invoked
 * on API 29+ anyway.
 */
public class ProvisioningActivity extends Activity {

    private static final String ACTION_GET_PROVISIONING_MODE =
            "android.app.action.GET_PROVISIONING_MODE";
    private static final String ACTION_ADMIN_POLICY_COMPLIANCE =
            "android.app.action.ADMIN_POLICY_COMPLIANCE";
    private static final String EXTRA_PROVISIONING_MODE =
            "android.app.extra.PROVISIONING_MODE";
    /** DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE */
    private static final int PROVISIONING_MODE_FULLY_MANAGED_DEVICE = 1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String action = getIntent() != null ? getIntent().getAction() : null;

        if (ACTION_GET_PROVISIONING_MODE.equals(action)) {
            Intent result = new Intent();
            result.putExtra(EXTRA_PROVISIONING_MODE, PROVISIONING_MODE_FULLY_MANAGED_DEVICE);
            setResult(RESULT_OK, result);
            finish();
            return;
        }

        if (ACTION_ADMIN_POLICY_COMPLIANCE.equals(action)) {
            // We are Device Owner now — lock in the kiosk policy.
            KioskDeviceAdminReceiver.applyKioskPolicy(this);
            setResult(RESULT_OK);
            finish();
            // Hand straight off to the kiosk so the tablet lands on content.
            Intent kiosk = new Intent(this, KioskActivity.class);
            kiosk.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(kiosk);
            return;
        }

        finish();
    }
}
