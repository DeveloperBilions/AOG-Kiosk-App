/* Dist-link kiosk config — the THIRD weblink solution, fully separate from
   both the classic typed-login flow (../config.js) and the credential-in-link
   auto flow (../auto/config.js). This flow signs in from a signage venue/dist
   ID appended to the link at runtime (?dist=_MDD_VENUEID → ?dist=12345); the
   backend (POST /auth/login-kiosk-dist) resolves the mapped store account and
   returns the token pair, so the link never carries credentials. Session
   lives under its OWN localStorage keys so all three solutions can run side
   by side on the same origin without hijacking each other's session, logout,
   or auto-forward. Nothing under web/autodist/ is loaded by the other flows,
   and nothing here loads them. */
(function (w) {
  w.AOG_API = 'https://aogclub.api.skynbliss.co/api';

  // localStorage keys — deliberately DIFFERENT from aog_token/* (classic) and
  // aog_auto_* (auto links) so the three sessions never collide.
  w.DIST_KEYS = {
    token: 'aog_dist_token',
    refresh: 'aog_dist_refresh',
    user: 'aog_dist_user',
    /* The dist/venue ID the link carried. Survives clearDistSession on
       purpose: it belongs to the screen, not the session, and lets
       index.html sign back in after an expired session even when the
       platform reopens the page without the ?dist= param. */
    dist: 'aog_dist_id',
    /* Extra link params (?loc=... etc., everything except `dist`) captured
       by index.html as a JSON object — same contract as aog_auto_meta. */
    meta: 'aog_dist_meta'
  };

  /* Drop the dist-link session (logout / unrecoverable 401). Keeps the
     stored dist ID — see the DIST_KEYS.dist note. */
  w.clearDistSession = function () {
    try {
      localStorage.removeItem(w.DIST_KEYS.token);
      localStorage.removeItem(w.DIST_KEYS.refresh);
      localStorage.removeItem(w.DIST_KEYS.user);
    } catch (e) { /* storage unavailable */ }
  };

  /* Silent access-token renewal via POST /users/refresh-token — same
     contract as the other two flows (tries the refresh token, then the
     expired access token, as the Bearer). Single-flight so concurrent 401s
     share one attempt. Resolves true when a fresh access token was stored. */
  var refreshInFlight = null;
  function refreshDistSession() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async function () {
      var rt = null, at = null;
      try {
        rt = localStorage.getItem(w.DIST_KEYS.refresh);
        at = localStorage.getItem(w.DIST_KEYS.token);
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
              localStorage.setItem(w.DIST_KEYS.token, newTok);
              var newRt = d.refreshToken || d.refresh_token;
              if (newRt) localStorage.setItem(w.DIST_KEYS.refresh, newRt);
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

  /* Re-sign-in from the stored dist ID, REPLACING the session with whatever
     store account the backend currently maps that ID to. This is how a
     kiosk_dist_id remap in the DB reaches screens that already hold a valid
     session — session reuse alone would keep the OLD account's tokens alive
     forever via refresh. kiosk.html calls it on load and hourly.
     Resolves true when the mapped account CHANGED (caller should refetch the
     QR). Network failure keeps the current session untouched — an API blip
     must never blank a working screen. A 401 means the dist ID is no longer
     mapped/eligible: drop the session and bounce to index.html, which shows
     the "not active" message. */
  w.refreshDistIdentity = async function () {
    var dist = null, prevUser = {};
    try {
      dist = localStorage.getItem(w.DIST_KEYS.dist);
      prevUser = JSON.parse(localStorage.getItem(w.DIST_KEYS.user) || '{}');
    } catch (e) { /* storage unavailable */ }
    if (!dist) return false;
    try {
      var res = await fetch(w.AOG_API + '/auth/login-kiosk-dist', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dist: dist })
      });
      var json = await res.json().catch(function () { return {}; });
      var d = (json && json.data) || null;
      if (res.ok && json.success && d && d.accessToken) {
        try {
          localStorage.setItem(w.DIST_KEYS.token, d.accessToken);
          var rt = d.refreshToken || d.refresh_token;
          if (rt) localStorage.setItem(w.DIST_KEYS.refresh, rt);
          localStorage.setItem(w.DIST_KEYS.user, JSON.stringify(d.userData || {}));
        } catch (e) { /* storage unavailable */ }
        return !!(d.userData && d.userData.member_id &&
                  d.userData.member_id !== prevUser.member_id);
      }
      if (res.status === 401) {
        w.clearDistSession();
        if (!/index\.html$|\/$/.test(location.pathname)) location.replace('index.html');
      }
    } catch (e) { /* network error — keep the current session */ }
    return false;
  };

  /* fetch() wrapper with the dist-link Bearer token. On 401 it tries a
     silent refresh and retries once; only if that fails does it clear the
     session and bounce to index.html — which signs back in from the stored
     dist ID (no credentials needed), or shows "reopen your link" if even
     that is gone. */
  w.distFetch = async function (path, opts) {
    opts = opts || {};
    async function doFetch() {
      const token = localStorage.getItem(w.DIST_KEYS.token);
      const headers = Object.assign({}, opts.headers, token ? { Authorization: 'Bearer ' + token } : {});
      return fetch(w.AOG_API + path, Object.assign({ cache: 'no-store' }, opts, { headers }));
    }
    let res = await doFetch();
    if (res.status === 401 && await refreshDistSession()) {
      res = await doFetch();
    }
    if (res.status === 401) {
      w.clearDistSession();
      if (!/index\.html$|\/$/.test(location.pathname)) location.replace('index.html');
      throw new Error('Unauthorized');
    }
    return res;
  };
})(window);
