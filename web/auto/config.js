/* Auto-link kiosk config — the SECOND weblink solution, fully separate from
   the classic typed-login flow in ../config.js. This flow signs in from
   credentials carried inside the link itself (see index.html) and keeps its
   session under its OWN localStorage keys, so the two solutions can run side
   by side on the same origin without either one hijacking the other's
   session, logout, or auto-forward. Nothing under web/auto/ is loaded by the
   classic pages, and nothing here loads them. */
(function (w) {
  w.AOG_API = 'https://aogclub.api.skynbliss.co/api';

  // localStorage keys — deliberately DIFFERENT from the classic flow's
  // aog_token/aog_refresh/aog_user so the two sessions never collide.
  w.AUTO_KEYS = {
    token: 'aog_auto_token',
    refresh: 'aog_auto_refresh',
    user: 'aog_auto_user',
    /* Extra link params (?loc=...&scr=... etc., everything except the
       credential `c`) captured by index.html as a JSON object. Not shown in
       any UI yet — held for a later backend integration. Survives
       clearAutoSession on purpose: it belongs to the link, not the session. */
    meta: 'aog_auto_meta'
  };

  /* Drop the auto-link session (logout / unrecoverable 401). */
  w.clearAutoSession = function () {
    try {
      localStorage.removeItem(w.AUTO_KEYS.token);
      localStorage.removeItem(w.AUTO_KEYS.refresh);
      localStorage.removeItem(w.AUTO_KEYS.user);
    } catch (e) { /* storage unavailable */ }
  };

  /* Silent access-token renewal via POST /users/refresh-token — same
     contract as the classic flow (tries the refresh token, then the expired
     access token, as the Bearer). Single-flight so concurrent 401s share one
     attempt. Resolves true when a fresh access token was stored. */
  var refreshInFlight = null;
  function refreshAutoSession() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async function () {
      var rt = null, at = null;
      try {
        rt = localStorage.getItem(w.AUTO_KEYS.refresh);
        at = localStorage.getItem(w.AUTO_KEYS.token);
      } catch (e) { /* storage unavailable */ }
      if (!rt) return false;
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
              localStorage.setItem(w.AUTO_KEYS.token, newTok);
              var newRt = d.refreshToken || d.refresh_token;
              if (newRt) localStorage.setItem(w.AUTO_KEYS.refresh, newRt);
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

  /* fetch() wrapper with the auto-link Bearer token. On 401 it tries a
     silent refresh and retries once; only if that fails does it clear the
     session and bounce to index.html — which, having no credentials in its
     URL at that point, shows the "reopen your link" screen (the auto flow
     never shows a typed login form). */
  w.autoFetch = async function (path, opts) {
    opts = opts || {};
    async function doFetch() {
      const token = localStorage.getItem(w.AUTO_KEYS.token);
      const headers = Object.assign({}, opts.headers, token ? { Authorization: 'Bearer ' + token } : {});
      return fetch(w.AOG_API + path, Object.assign({ cache: 'no-store' }, opts, { headers }));
    }
    let res = await doFetch();
    if (res.status === 401 && await refreshAutoSession()) {
      res = await doFetch();
    }
    if (res.status === 401) {
      w.clearAutoSession();
      if (!/index\.html$|\/$/.test(location.pathname)) location.replace('index.html');
      throw new Error('Unauthorized');
    }
    return res;
  };
})(window);
