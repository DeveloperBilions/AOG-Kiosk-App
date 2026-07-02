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
import android.provider.Settings;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONException;
import org.json.JSONObject;

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

        buildWebView();

        // Enter single-app kiosk lockdown. Unbreakable when the app is Device
        // Owner; falls back to escapable screen-pinning otherwise. On Fire OS,
        // which lacks the Device-Owner framework, this gracefully no-ops.
        enterKioskMode();

        loadRemote();
    }

    /**
     * Create and configure the kiosk WebView, install it as the content view,
     * and wire up the WebViewClient. Factored out so the render-crash recovery
     * path can rebuild the view from scratch with identical settings.
     */
    @SuppressLint("SetJavaScriptEnabled")
    private void buildWebView() {
        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        // Always fetch the hosted page from the network so content/config edits
        // propagate on the next refresh instead of being served stale from the
        // WebView's HTTP cache (GitHub Pages sends max-age=600, which otherwise
        // delays updates by up to 10 min per resource). If the network is down,
        // onReceivedError() swaps in the bundled offline copy, so LOAD_NO_CACHE
        // does not break offline use. Static assets re-download each load, but
        // they're small — a worthwhile trade for reliable over-the-air updates.
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        // ---- Fire TV / older-WebView compatibility ---------------------------
        // Fire OS ships an older Chromium than stock Android TV. These settings
        // keep the hosted page rendering correctly on those engines:
        //  - Allow mixed content: the offline fallback (file://) and some hosted
        //    sub-resources can otherwise be blocked by stricter old defaults.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }
        // file:// asset pages need these to read their own bundled JS/CSS on
        // older WebViews where they default to false.
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        // A modern-ish UA string nudges hosts that sniff for old Chromium into
        // serving the standard (non-degraded) page to the Fire TV WebView.
        s.setUserAgentString(s.getUserAgentString() + " AOGKiosk/" + BuildConfig.VERSION_NAME);
        // ---------------------------------------------------------------------

        // Expose a small native bridge to the hosted page so it can identify the
        // physical device. Reachable from JS as window.AOGKiosk.* (see the
        // KioskBridge methods below for what's available).
        webView.addJavascriptInterface(new KioskBridge(), "AOGKiosk");

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

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // Fire OS's older WebView can crash the render process on a heavy
                // page, leaving a permanently black kiosk. Rebuild the WebView and
                // reload so the kiosk self-heals instead of needing a power-cycle.
                if (view == webView) {
                    rebuildWebViewAndReload();
                }
                return true; // we handled it; don't let the system kill the app
            }
        });
    }

    /**
     * Recover from a WebView render-process crash (seen on Fire OS's older
     * WebView under memory pressure). The crashed WebView is unusable, so we
     * destroy it, build a fresh one, and reload the kiosk page.
     */
    private void rebuildWebViewAndReload() {
        WebView dead = webView;
        webView = null;
        if (dead != null) {
            dead.destroy();
        }
        buildWebView();
        loadRemote();
    }

    /**
     * Native bridge exposed to the hosted page as {@code window.AOGKiosk}.
     *
     * <p>Lets the web content identify which physical kiosk it is running on —
     * e.g. to register the device, scope content, or show it in a fleet
     * dashboard. All methods return strings (JS-friendly) and are safe to call
     * from any device, including Fire TV.
     *
     * <p>Usage from the page:
     * <pre>
     *   if (window.AOGKiosk) {
     *     const id   = AOGKiosk.getDeviceId();          // stable per-device id
     *     const info = JSON.parse(AOGKiosk.getDeviceInfo());
     *     // info = { deviceId, model, manufacturer, device, product, fireOs }
     *   }
     * </pre>
     */
    private final class KioskBridge {

        /**
         * Stable per-device identifier: {@code Settings.Secure.ANDROID_ID}.
         *
         * <p>64-bit hex string, unique to the (device + app-signing-key) pair.
         * Requires no permission and works on Fire OS. Survives reboots and app
         * reinstalls (same signing key); it only changes on a factory reset —
         * which is effectively a new deployment. Returns "" if unavailable.
         */
        @JavascriptInterface
        public String getDeviceId() {
            try {
                String id = Settings.Secure.getString(
                        getContentResolver(), Settings.Secure.ANDROID_ID);
                return id != null ? id : "";
            } catch (Exception e) {
                return "";
            }
        }

        /** Marketing model, e.g. "AFTKA" (Fire TV Stick 4K) or "AFTT". */
        @JavascriptInterface
        public String getModel() {
            return safe(Build.MODEL);
        }

        /** Device hardware name, e.g. the Fire TV codename. */
        @JavascriptInterface
        public String getDeviceName() {
            return safe(Build.DEVICE);
        }

        /** True when running on Amazon Fire OS (vs. stock Android TV). */
        @JavascriptInterface
        public boolean isFireOs() {
            String mfr = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER;
            return mfr.toLowerCase().contains("amazon");
        }

        /**
         * True only in a debug build ({@code BuildConfig.DEBUG}). The hosted page
         * uses this to decide whether to show the on-screen device-registration
         * diagnostic — so a sideloaded DEBUG APK reveals it, while the signed
         * release APK (and any plain browser, which has no bridge) never does.
         */
        @JavascriptInterface
        public boolean isDiagnostic() {
            return BuildConfig.DEBUG;
        }

        /**
         * Everything above plus a couple of extras, as a JSON string the page
         * can {@code JSON.parse()}. Single call = one round-trip for the page's
         * device-registration logic.
         */
        @JavascriptInterface
        public String getDeviceInfo() {
            JSONObject o = new JSONObject();
            try {
                o.put("deviceId", getDeviceId());
                o.put("model", safe(Build.MODEL));
                o.put("manufacturer", safe(Build.MANUFACTURER));
                o.put("device", safe(Build.DEVICE));
                o.put("product", safe(Build.PRODUCT));
                o.put("fireOs", isFireOs());
                o.put("appVersion", BuildConfig.VERSION_NAME);
            } catch (JSONException ignored) {
                // A well-formed object can't actually throw here; return what we have.
            }
            return o.toString();
        }

        private String safe(String v) {
            return v != null ? v : "";
        }
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
