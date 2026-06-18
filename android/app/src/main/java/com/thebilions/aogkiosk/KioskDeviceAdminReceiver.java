package com.thebilions.aogkiosk;

import android.app.admin.DeviceAdminReceiver;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;

/**
 * Device-admin component that turns this app into a true single-app kiosk.
 *
 * <p>It gains real power once the app is the device's <b>Device Owner</b>. That
 * can happen two ways:
 * <ul>
 *   <li><b>ADB</b> — {@code dpm set-device-owner ...} on a factory-reset tablet
 *       (see DEPLOY-KIOSK.md).</li>
 *   <li><b>QR provisioning</b> — scan an enrollment QR on the factory-reset
 *       welcome screen; Android downloads this APK and makes it Device Owner with
 *       no computer (see QR-PROVISIONING.md). The provisioning callbacks below
 *       finalize the kiosk policy automatically.</li>
 * </ul>
 */
public class KioskDeviceAdminReceiver extends DeviceAdminReceiver {

    /** ComponentName Android uses to reference this admin. */
    public static ComponentName getComponentName(Context context) {
        return new ComponentName(context.getApplicationContext(),
                KioskDeviceAdminReceiver.class);
    }

    /**
     * Apply the kiosk lock-task policy. Safe to call repeatedly; no-op unless the
     * app is Device Owner.
     *
     * <ul>
     *   <li>Whitelists this package for unbreakable Lock Task (kiosk) mode.</li>
     *   <li>Registers the kiosk as the persistent HOME activity, so the HOME
     *       button can never leave it and it auto-launches on boot.</li>
     * </ul>
     */
    public static void applyKioskPolicy(Context context) {
        DevicePolicyManager dpm =
                (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        if (dpm == null) return;

        String pkg = context.getPackageName();
        if (!dpm.isDeviceOwnerApp(pkg)) return;

        ComponentName admin = getComponentName(context);

        // 1. Whitelist this app so it can enter unbreakable Lock Task mode.
        dpm.setLockTaskPackages(admin, new String[]{ pkg });

        // 2. Become the persistent HOME activity.
        IntentFilter homeFilter = new IntentFilter(Intent.ACTION_MAIN);
        homeFilter.addCategory(Intent.CATEGORY_HOME);
        homeFilter.addCategory(Intent.CATEGORY_DEFAULT);
        dpm.addPersistentPreferredActivity(
                admin,
                homeFilter,
                new ComponentName(pkg, KioskActivity.class.getName()));
    }

    @Override
    public void onEnabled(Context context, Intent intent) {
        super.onEnabled(context, intent);
        applyKioskPolicy(context);
    }

    /**
     * Fired when QR/NFC device-owner provisioning completes (Android 7–10, and as
     * a follow-up on newer versions). We're Device Owner at this point, so lock
     * the kiosk policy in and hand off to the kiosk screen.
     */
    @Override
    public void onProfileProvisioningComplete(Context context, Intent intent) {
        super.onProfileProvisioningComplete(context, intent);
        applyKioskPolicy(context);

        Intent kiosk = new Intent(context, KioskActivity.class);
        kiosk.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(kiosk);
    }

    @Override
    public void onDisabled(Context context, Intent intent) {
        super.onDisabled(context, intent);
        DevicePolicyManager dpm =
                (DevicePolicyManager) context.getSystemService(Context.DEVICE_POLICY_SERVICE);
        if (dpm != null && dpm.isDeviceOwnerApp(context.getPackageName())) {
            // Release the HOME override so the device is usable again after unlock.
            dpm.clearPackagePersistentPreferredActivities(
                    getComponentName(context), context.getPackageName());
        }
    }
}
