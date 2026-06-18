package com.thebilions.aogkiosk;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Relaunches the kiosk automatically after the tablet reboots.
 *
 * <p>When the app is Device Owner it is also the persistent HOME activity, so the
 * launcher would relaunch it anyway — but this receiver guarantees the kiosk comes
 * straight back up on every boot (e.g. after a power cut) without anyone touching
 * the screen, which is exactly what an unattended kiosk needs.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)) {
            Intent launch = new Intent(context, KioskActivity.class);
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(launch);
        }
    }
}
