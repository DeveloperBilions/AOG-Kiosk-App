/* Shared kiosk config — single source of truth for the API base URL and the
   localStorage keys the login screen and the kiosk page exchange. Loaded by
   both web/index.html (login) and web/kiosk.html (QR display). */
(function (w) {
  w.AOG_API = 'https://aogclub.api.skynbliss.co/api';

  // localStorage keys
  w.AOG_KEYS = {
    token: 'aog_token',      // JWT access token from login
    refresh: 'aog_refresh',  // refresh token from login (when the API returns one)
    user: 'aog_user',        // JSON of userData (id, member_id, firstname, ...)
    remember: 'rememberMe',  // 'true' when Remember me was checked
    accounts: 'accounts'     // [{ user }] — remembered usernames (no passwords)
  };

  /* Drop every session key (used on logout and on an unrecoverable 401). */
  w.clearSession = function () {
    try {
      localStorage.removeItem(w.AOG_KEYS.token);
      localStorage.removeItem(w.AOG_KEYS.refresh);
      localStorage.removeItem(w.AOG_KEYS.user);
    } catch (e) { /* storage unavailable */ }
  };

  /* Canonical hosted origin — where the TV fleet loads the kiosk from. */
  w.AOG_HOSTED = 'https://developerbilions.github.io/AOG-Kiosk-App/';

  /* Navigate between kiosk pages.

     On an https origin (github.io or the CloudFront mirror) this is a plain
     relative navigation — same behaviour as before, and it never hops origins
     (which would strand the localStorage session on the old origin).

     On file:// we are the APK's bundled OFFLINE fallback. Relative navigation
     would keep the device trapped on the stale bundled copy — with its own
     separate file-origin localStorage session — even after the network
     recovers. So from file:// we first probe the hosted site and jump to the
     absolute hosted URL when it's reachable; only while genuinely offline do
     we stay on the bundled copy. The probe (not a blind absolute jump) matters:
     a failed main-frame load would otherwise leave the WebView on an error
     page until the next 15-min refresh, since KioskActivity only swaps in the
     offline copy once per cycle.

     Note: sessions are per-origin, so leaving file:// lands on whatever
     session the hosted origin holds (possibly signed in, possibly the login
     form) — the stale bundled session is left behind by design. */
  w.kioskNav = function (page, replace) {
    function go(url) {
      try { if (replace) { location.replace(url); return; } } catch (e) {}
      location.href = url;
    }
    if (location.protocol !== 'file:') { go(page); return; }
    var reachable = fetch(w.AOG_HOSTED + 'config.js',
                          { method: 'HEAD', cache: 'no-store', mode: 'no-cors' })
      .then(function () { return true; }, function () { return false; });
    var timeout = new Promise(function (r) { setTimeout(function () { r(false); }, 4000); });
    Promise.race([reachable, timeout]).then(function (ok) {
      go(ok ? w.AOG_HOSTED + page : page);
    });
  };

  /* Exchange the stored refresh token for a fresh access token via
     POST /users/refresh-token, so a long-running kiosk survives access-token
     expiry without anyone re-typing credentials. Single-flight: concurrent
     401s (QR poll + device check-in) share one refresh attempt. Resolves true
     when a new access token was stored, false otherwise (no refresh token
     saved, endpoint rejected it, or network error) — callers then fall back
     to the old clear-session-and-relogin behaviour, so a device that logged
     in before refresh tokens were stored behaves exactly as it does today. */
  var refreshInFlight = null;
  function refreshSession() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async function () {
      var rt = null, at = null;
      try {
        rt = localStorage.getItem(w.AOG_KEYS.refresh);
        at = localStorage.getItem(w.AOG_KEYS.token);
      } catch (e) { /* storage unavailable */ }
      if (!rt) return false;
      // The endpoint requires a Bearer header; the contract doesn't document
      // whether it wants the refresh token or the (expired) access token
      // there, so try the refresh token first, then the access token. The
      // refresh token also rides in the body for APIs that read it there.
      var bearers = at && at !== rt ? [rt, at] : [rt];
      for (var i = 0; i < bearers.length; i++) {
        try {
          var res = await fetch(w.AOG_API + '/users/refresh-token', {
            method: 'POST',
            cache: 'no-store',
            headers: { 'Content-Type': 'application/json',
                       Authorization: 'Bearer ' + bearers[i] },
            body: JSON.stringify({ refreshToken: rt })
          });
          var json = await res.json().catch(function () { return {}; });
          var d = (json && json.data) || {};
          var newTok = d.accessToken || d.access_token || d.token;
          if (res.ok && newTok) {
            try {
              localStorage.setItem(w.AOG_KEYS.token, newTok);
              var newRt = d.refreshToken || d.refresh_token;
              if (newRt) localStorage.setItem(w.AOG_KEYS.refresh, newRt);
            } catch (e) { /* storage unavailable */ }
            return true;
          }
        } catch (e) { /* network error — try next bearer / give up */ }
      }
      return false;
    })().then(
      function (ok) { refreshInFlight = null; return ok; },
      function ()   { refreshInFlight = null; return false; }
    );
    return refreshInFlight;
  }

  /* One-time migration for sessions created BEFORE refresh tokens were
     stored: while the current access token is still valid, ask the API for a
     fresh token pair and store the refresh token, so an already-signed-in
     device never has to see the login screen again. No-ops when a refresh
     token is already stored, when signed out, or when the endpoint declines —
     safe to fire-and-forget on every kiosk load. Uses raw fetch (not
     authFetch) so a rejection here can never trigger the logout path. */
  w.ensureRefreshToken = async function () {
    var at = null, rt = null;
    try {
      at = localStorage.getItem(w.AOG_KEYS.token);
      rt = localStorage.getItem(w.AOG_KEYS.refresh);
    } catch (e) { return false; }
    if (!at || rt) return false;
    try {
      var res = await fetch(w.AOG_API + '/users/refresh-token', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json',
                   Authorization: 'Bearer ' + at },
        body: JSON.stringify({})
      });
      var json = await res.json().catch(function () { return {}; });
      var d = (json && json.data) || {};
      var newAt = d.accessToken || d.access_token || d.token;
      var newRt = d.refreshToken || d.refresh_token;
      if (!res.ok || !newRt) return false;
      try {
        localStorage.setItem(w.AOG_KEYS.refresh, newRt);
        if (newAt) localStorage.setItem(w.AOG_KEYS.token, newAt);
      } catch (e) { /* storage unavailable */ }
      return true;
    } catch (e) { return false; }
  };

  /* fetch() wrapper that attaches the Bearer token. On 401 it first tries to
     refresh the session silently and retries the request once; only if that
     fails does it clear the session and send the user back to the login
     screen, then reject so callers stop. */
  w.authFetch = async function (path, opts) {
    opts = opts || {};
    async function doFetch() {
      const token = localStorage.getItem(w.AOG_KEYS.token);
      const headers = Object.assign({}, opts.headers, token ? { Authorization: 'Bearer ' + token } : {});
      // no-store so a kiosk WebView never serves a stale referral QR / token list.
      return fetch(w.AOG_API + path, Object.assign({ cache: 'no-store' }, opts, { headers }));
    }
    let res = await doFetch();
    if (res.status === 401 && await refreshSession()) {
      res = await doFetch();
    }
    if (res.status === 401) {
      w.clearSession();
      if (!/index\.html$|\/$/.test(location.pathname)) w.kioskNav('index.html');
      throw new Error('Unauthorized');
    }
    return res;
  };

  /* Read the physical-device identity exposed by the native kiosk app
     (KioskActivity's window.AOGKiosk bridge). Returns null when running in a
     plain browser (no bridge) so callers can no-op outside the kiosk app. */
  w.aogDeviceInfo = function () {
    try {
      if (w.AOGKiosk && typeof w.AOGKiosk.getDeviceInfo === 'function') {
        return JSON.parse(w.AOGKiosk.getDeviceInfo());
      }
    } catch (e) { /* bridge missing or returned junk */ }
    return null;
  };

  /* Register/authorize this kiosk device with the API. Best-effort: it needs
     the native bridge AND a valid token, and it never throws — a failure here
     must not block login or the kiosk. Returns true on a 2xx, false otherwise.

     Maps the bridge fields onto the authorize-device contract:
       device_serial_number <- ANDROID_ID (stable, unique per device)
       model_name           <- Build.MODEL
       device_name          <- "<model> · <short id>" (human-readable in a list)
       device_type          <- "kiosk" */
  /* Record the last registration attempt so it can be read back WITHOUT a
     JS console — the v1.3 WebView doesn't route console.log to logcat. Writes
     to localStorage['aog_device_diag'] and also console.log (for chrome://inspect
     and future builds that route console). Read it on-device via ADB:
       adb shell run-as com.thebilions.aogkiosk cat \
         /data/data/com.thebilions.aogkiosk/app_webview/Default/Local\ Storage/...
     or expose it on screen from the page during debugging. */
  w.AOG_DIAG_KEY = 'aog_device_diag';
  function diag(step, extra) {
    var line = '[AOGKiosk][authorize] ' + step + (extra != null ? ' ' + extra : '');
    try { console.log(line); } catch (e) {}
    try {
      localStorage.setItem(w.AOG_DIAG_KEY,
        JSON.stringify({ step: step, extra: extra == null ? '' : String(extra) }));
    } catch (e) { /* storage unavailable */ }
  }

  w.authorizeDevice = async function () {
    diag('start; bridge=' + !!w.AOGKiosk);
    const info = w.aogDeviceInfo();
    diag('deviceInfo', JSON.stringify(info));
    if (!info || !info.deviceId) {
      diag('ABORT: no bridge / empty deviceId');
      return false;                                     // not in the kiosk app
    }
    const token = localStorage.getItem(w.AOG_KEYS.token);
    if (!token) {
      diag('ABORT: no token');
      return false;                                     // no session yet
    }
    const shortId = info.deviceId.slice(-8);
    const model = info.model || 'Unknown';
    // The API rejects 'kiosk' — it only accepts: mobile, tablet, desktop,
    // web_browser, tv. Use the class the native bridge detected (tv/tablet/
    // mobile), all of which are valid; fall back to 'mobile' for anything else.
    const ALLOWED = { tv: 'tv', tablet: 'tablet', mobile: 'mobile' };
    const detected = (info.deviceType || '').toLowerCase();
    const payload = {
      device_type: ALLOWED[detected] || 'mobile',
      device_name: model + ' · ' + shortId,
      device_serial_number: info.deviceId,
      model_name: model
    };
    diag('POST', JSON.stringify(payload));
    try {
      const res = await w.authFetch('/users/authorize-device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var bodyText = '';
      try { bodyText = await res.clone().text(); } catch (e) {}
      diag('response ' + res.status + (res.ok ? ' OK' : ' FAIL'), bodyText);
      return res.ok;
    } catch (e) {
      diag('ERROR (network / 401)', e && e.message);
      return false;   // network error / 401 already handled by authFetch
    }
  };
})(window);
