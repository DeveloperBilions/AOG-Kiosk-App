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
})(window);
