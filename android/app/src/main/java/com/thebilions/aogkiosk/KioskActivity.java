package com.thebilions.aogkiosk;

import android.annotation.SuppressLint;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.appcompat.app.AppCompatActivity;

/**
 * Full-screen Android TV kiosk.
 *
 * Behaviour:
 *  - Loads the hosted page ({@link BuildConfig#KIOSK_URL}) full-screen, no chrome.
 *  - If the network is down or the remote fails, falls back to a copy of the page
 *    bundled in assets/web/ so a freshly-sideloaded (or offline) TV still works.
 *  - Silently reloads from the host every {@link BuildConfig#REFRESH_INTERVAL_MS}
 *    and again whenever the app resumes, so content edits on the host propagate
 *    to every TV automatically — no reinstall.
 *  - Keeps the screen on (a kiosk must never sleep).
 */
public class KioskActivity extends AppCompatActivity {

    private static final String OFFLINE_URL = "file:///android_asset/web/index.html";

    private WebView webView;
    private boolean showingOffline = false;
    /** elapsedRealtime() of the last loadRemote(); 0 until the first load. */
    private long lastLoadAt = 0L;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable refreshTask = new Runnable() {
        @Override public void run() {
            loadRemote();
            handler.postDelayed(this, BuildConfig.REFRESH_INTERVAL_MS);
        }
    };

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Never let the TV sleep while the kiosk is foreground.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        // Prefer fresh content from the network; assets are the offline fallback.
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        // Enter single-app kiosk lockdown. Unbreakable when the app is Device
        // Owner; falls back to escapable screen-pinning otherwise.
        enterKioskMode();

        webView.setBackgroundColor(0xFF000000);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Keep navigation inside the kiosk; never hand off to a browser.
                view.loadUrl(request.getUrl().toString());
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                // Only react to failures of the main page, not sub-resources.
                if (request.isForMainFrame() && !showingOffline) {
                    showingOffline = true;
                    view.loadUrl(OFFLINE_URL);
                }
            }
        });

        loadRemote();
    }

    /**
     * Lock the device to this single app.
     *
     * <p>If the app is Device Owner we first configure the lock-task policy
     * (whitelist + which system features stay visible), which makes the lock
     * <i>unbreakable</i>: no HOME, no recents, no notification shade, no exit.
     * If the app is NOT Device Owner, {@code startLockTask()} still pins the
     * app but the user can escape by holding Back+Recents — acceptable only for
     * trusted internal use.
     */
    private void enterKioskMode() {
        DevicePolicyManager dpm =
                (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);

        if (dpm != null && dpm.isDeviceOwnerApp(getPackageName())) {
            ComponentName admin = KioskDeviceAdminReceiver.getComponentName(this);
            dpm.setLockTaskPackages(admin, new String[]{ getPackageName() });

            // Choose which system affordances remain during lock-task. NONE =
            // maximum lockdown (no home, no overview, no notifications, no system
            // info, no global actions). Loosen here if you want e.g. the clock.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                dpm.setLockTaskFeatures(admin, DevicePolicyManager.LOCK_TASK_FEATURE_NONE);
            }
        }

        // Safe to call on API 21+. Only actually locks (vs. pins) when the
        // package is lock-task-whitelisted above.
        try {
            startLockTask();
        } catch (Exception ignored) {
            // Some non-owner devices throw if pinning is disabled in Settings;
            // the immersive fullscreen + BACK swallow still apply.
        }
    }

    /** Attempt the hosted page; the error handler swaps to offline on failure. */
    private void loadRemote() {
        showingOffline = false;
        lastLoadAt = SystemClock.elapsedRealtime();
        webView.loadUrl(BuildConfig.KIOSK_URL);
    }

    @Override
    protected void onResume() {
        super.onResume();
        applyImmersive();
        enterKioskMode();                   // re-assert the lock if it ever dropped

        // Refresh on resume, but only once content is actually stale. Without
        // this guard a transient focus loss (e.g. a system dialog flashing) would
        // trigger an immediate reload AND restart the timer on every resume,
        // flickering the page. We reload only if it's been at least one refresh
        // interval since the last load; otherwise we just keep the timer running.
        handler.removeCallbacks(refreshTask);
        long sinceLastLoad = SystemClock.elapsedRealtime() - lastLoadAt;
        if (lastLoadAt == 0L || sinceLastLoad >= BuildConfig.REFRESH_INTERVAL_MS) {
            loadRemote();
            handler.postDelayed(refreshTask, BuildConfig.REFRESH_INTERVAL_MS);
        } else {
            // Resume the timer for the remainder of the current interval.
            handler.postDelayed(refreshTask, BuildConfig.REFRESH_INTERVAL_MS - sinceLastLoad);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        handler.removeCallbacks(refreshTask);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) applyImmersive();
    }

    /** Hide system bars for an edge-to-edge kiosk presentation. */
    private void applyImmersive() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // Swallow the TV remote BACK so the kiosk can't be exited accidentally.
        // (HOME is handled by the OS and cannot be intercepted.)
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacks(refreshTask);
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
