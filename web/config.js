/* Shared kiosk config — single source of truth for the API base URL and the
   localStorage keys the login screen and the kiosk page exchange. Loaded by
   both web/index.html (login) and web/kiosk.html (QR display). */
(function (w) {
  w.AOG_API = 'https://aogclub.api.skynbliss.co/api';

  // localStorage keys
  w.AOG_KEYS = {
    token: 'aog_token',      // JWT access token from login
    user: 'aog_user',        // JSON of userData (id, member_id, firstname, ...)
    remember: 'rememberMe',  // 'true' when Remember me was checked
    accounts: 'accounts'     // [{ user }] — remembered usernames (no passwords)
  };

  /* fetch() wrapper that attaches the Bearer token. On 401 (expired/invalid
     token) it clears the session and sends the user back to the login screen,
     then rejects so callers stop. */
  w.authFetch = async function (path, opts) {
    opts = opts || {};
    const token = localStorage.getItem(w.AOG_KEYS.token);
    const headers = Object.assign({}, opts.headers, token ? { Authorization: 'Bearer ' + token } : {});
    // no-store so a kiosk WebView never serves a stale referral QR / token list.
    const res = await fetch(w.AOG_API + path, Object.assign({ cache: 'no-store' }, opts, { headers }));
    if (res.status === 401) {
      try {
        localStorage.removeItem(w.AOG_KEYS.token);
        localStorage.removeItem(w.AOG_KEYS.user);
      } catch (e) { /* storage unavailable */ }
      if (!/index\.html$|\/$/.test(location.pathname)) location.href = 'index.html';
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
  w.authorizeDevice = async function () {
    const info = w.aogDeviceInfo();
    if (!info || !info.deviceId) return false;          // not in the kiosk app
    const token = localStorage.getItem(w.AOG_KEYS.token);
    if (!token) return false;                            // no session yet
    const shortId = info.deviceId.slice(-8);
    const model = info.model || 'Unknown';
    try {
      const res = await w.authFetch('/users/authorize-device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_type: 'kiosk',
          device_name: model + ' · ' + shortId,
          device_serial_number: info.deviceId,
          model_name: model
        })
      });
      return res.ok;
    } catch (e) {
      return false;   // network error / 401 already handled by authFetch
    }
  };
})(window);
