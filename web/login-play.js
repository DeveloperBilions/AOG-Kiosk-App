/* QR "Login & Play" — shared by every kiosk page (classic, auto/*, autodist/*).

   Load it at the end of <body>, after the page's config.js, naming the
   localStorage key that holds THAT page's store-account token:

     <script src="login-play.js" data-token-key="aog_token"></script>

   What it does:
     - Asks the API whether Login & Play is enabled for this store account
       (feature flag) and, only then, adds the Login & Play button under the
       sign-up steps. The sign-up QR and everything else on the page is left
       exactly as it was.
     - Login & Play opens a full-screen QR screen. The QR is single-use and
       expires in 2 minutes; the player scans it and approves on their phone.
       There is deliberately no email/password form on the kiosk.
     - On approval the kiosk collects a one-time player token and opens the
       AOG site in this same window. The site hard-logs-out after 1 minute idle and
       comes back here.
     - Every load of this page ends whatever Login & Play session this kiosk
       last started (aog_lp_open). That is the safety net that kills the player
       token server-side even when the site's own logout never reached the API
       (network drop, the app's 15-minute reload mid-game, a crash).

   The store session (the referral QR) is never touched: this file only reads
   the store token and keeps its own aog_lp_* keys. */
(function () {
  var script = document.currentScript;
  var TOKEN_KEY = script && script.getAttribute('data-token-key');
  var API = window.AOG_API;
  var OPEN_KEY = 'aog_lp_open';
  var IDLE_MS = 60000;
  var POLL_MS = 1500;
  var NET_FAIL_MS = 15000;

  // The bundled offline copy (file://) can't log anyone in, and a page without
  // a configured token key isn't a kiosk page.
  if (location.protocol === 'file:' || !API || !TOKEN_KEY) return;

  function ls(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { return null; }
  }
  function storeToken() { return ls(TOKEN_KEY); }

  function api(method, path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (opts.auth) headers.Authorization = 'Bearer ' + storeToken();
    if (opts.secret) headers['x-kiosk-secret'] = opts.secret;
    // A hung request must surface as a network error, never an endless spinner.
    var timeout = new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error('timeout')); }, 15000);
    });
    return Promise.race([fetch(API + path, {
      method: method, cache: 'no-store', headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }), timeout]).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        return { status: res.status, ok: res.ok, data: (j && j.data) || {} };
      });
    });
  }

  /* ---- safety net: end the last session this kiosk started ---- */
  function closeOpen(reason) {
    var open = null;
    try { open = JSON.parse(ls(OPEN_KEY) || 'null'); } catch (e) {}
    if (!open || !open.id || !open.s) return Promise.resolve();
    return api('POST', '/kiosk-login/requests/' + open.id + '/close',
               { secret: open.s, body: { reason: reason } })
      .then(function (r) { if (r.ok || r.status === 404) ls(OPEN_KEY, null); })
      .catch(function () { /* offline: retried on the next load */ });
  }
  closeOpen('kiosk_home');

  /* ---- styles ---- */
  var css = ''
    + '.lp-wrap{width:100%;display:flex;flex-direction:column;align-items:center;margin-top:.7em}'
    + '.lp-or{display:flex;align-items:center;gap:.75em;width:100%;margin:0 0 .6em;font-size:.7em;letter-spacing:.25em;color:var(--mut,#8d9870);text-transform:uppercase}'
    + '.lp-or:before,.lp-or:after{content:"";flex:1;height:1px;background:var(--line,rgba(165,255,8,.16))}'
    + '.lp-btnwrap{position:relative;width:100%}'
    + '.lp-btn{width:100%;height:3.9em;border:0;border-radius:.75em;background:#A5FF08;color:#000;font-family:Anton,sans-serif;font-size:1em;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;'
    + 'box-shadow:0 0 0 2px rgba(165,255,8,.25),0 0 34px rgba(165,255,8,.35);display:flex;align-items:center;justify-content:center;gap:.6em}'
    + '.lp-btn span{font-size:1.9em}'
    + '.lp-new{position:absolute;top:-.55em;right:-.4em;background:#fff;color:#000;font:700 .7em Inter,sans-serif;letter-spacing:.06em;padding:.3em .6em;border-radius:1.4em}'
    + '.lp-sub{font-size:.75em;color:var(--mut,#8d9870);letter-spacing:.06em;margin-top:.5em;text-transform:uppercase}'
    /* full-screen login screen */
    + '#lp{position:fixed;inset:0;z-index:2147483000;display:none;flex-direction:column;background:radial-gradient(70% 60% at 50% 0%,rgba(165,255,8,.07),transparent 60%),#000;color:#e9ffce;font-family:"Chakra Petch",sans-serif;font-size:min(2.2vh,2.6vw)}'
    + '#lp.on{display:flex}'
    + '#lp .lp-bar{flex:0 0 auto;height:4.4em;display:flex;align-items:center;justify-content:space-between;padding:0 1.8em;border-bottom:1px solid rgba(165,255,8,.16);background:linear-gradient(180deg,rgba(165,255,8,.06),transparent)}'
    + '#lp .lp-logo{font-family:Anton,sans-serif;font-size:2em;letter-spacing:1px;color:#A5FF08;text-shadow:0 0 22px rgba(165,255,8,.5);line-height:1}#lp .lp-logo i{font-style:normal;color:#fff}'
    + '#lp .lp-tag{font-size:.75em;letter-spacing:.25em;color:#8d9870;text-transform:uppercase;margin-top:.2em}'
    + '#lp .lp-live{display:flex;align-items:center;gap:.6em;font-size:.8em;letter-spacing:.15em;color:#8d9870;text-transform:uppercase}'
    + '#lp .lp-dot{width:.6em;height:.6em;border-radius:50%;background:#A5FF08;box-shadow:0 0 12px #A5FF08;animation:lppulse 1.8s infinite;display:inline-block}'
    + '@keyframes lppulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.8)}}'
    + '#lp .lp-back{position:absolute;left:1.8em;top:5.6em;background:transparent;border:1px solid rgba(165,255,8,.16);color:#e9ffce;border-radius:.7em;padding:.7em 1.25em;font:inherit;font-size:.95em;letter-spacing:.15em;text-transform:uppercase;cursor:pointer}'
    + '#lp .lp-body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1em 1.5em;text-align:center}'
    + '#lp .lp-h{font-family:Anton,sans-serif;font-size:3em;color:#fff;letter-spacing:.02em;line-height:1;text-transform:uppercase}#lp .lp-h em{font-style:normal;color:#A5FF08}'
    + '#lp .lp-s{font-size:1.05em;opacity:.75;margin-top:.55em}'
    + '#lp .lp-qr{position:relative;margin-top:1.5em;width:17em;height:17em;border-radius:1.3em;background:#fff;display:grid;place-items:center;box-shadow:0 0 0 2px #A5FF08,0 0 40px rgba(165,255,8,.35);overflow:hidden}'
    + '#lp .lp-qr img{width:88%;height:88%;object-fit:contain;display:block}'
    + '#lp .lp-spin{display:none;width:4em;height:4em;border-radius:50%;border:.35em solid rgba(0,0,0,.08);border-top-color:#7db300;animation:lpspin .8s linear infinite}'
    + '@keyframes lpspin{to{transform:rotate(360deg)}}'
    + '#lp.loading .lp-qr img{display:none}#lp.loading .lp-spin{display:block}'
    + '#lp.loading .lp-code,#lp.loading .lp-exp{visibility:hidden}'
    + '#lp .lp-c{position:absolute;width:1.5em;height:1.5em;border:3px solid #A5FF08}'
    + '#lp .c1{top:.5em;left:.5em;border-right:0;border-bottom:0;border-radius:.4em 0 0 0}#lp .c2{top:.5em;right:.5em;border-left:0;border-bottom:0;border-radius:0 .4em 0 0}'
    + '#lp .c3{bottom:.5em;left:.5em;border-right:0;border-top:0;border-radius:0 0 0 .4em}#lp .c4{bottom:.5em;right:.5em;border-left:0;border-top:0;border-radius:0 0 .4em 0}'
    + '#lp .lp-code{margin-top:.9em;font-family:"Space Mono",monospace;font-size:2em;letter-spacing:.2em;color:#A5FF08;font-weight:700}'
    + '#lp .lp-exp{font-size:.8em;letter-spacing:.15em;color:#8d9870;text-transform:uppercase;margin-top:.25em}'
    + '#lp .lp-wait{display:flex;align-items:center;gap:.55em;margin-top:.7em;font-size:.9em;letter-spacing:.15em;text-transform:uppercase}#lp .lp-wait.ok{color:#A5FF08}'
    + '#lp .lp-err{display:none;flex-direction:column;align-items:center;margin-top:1.5em;max-width:30em}'
    + '#lp .lp-err p{font-family:Inter,sans-serif;font-size:1.35em;font-weight:600;color:#ff5a5a;line-height:1.4}'
    + '#lp .lp-row{display:flex;gap:.8em;margin-top:1.2em}'
    + '#lp .lp-k{height:3.6em;padding:0 1.8em;border:0;border-radius:.75em;background:#A5FF08;color:#000;font-family:Anton,sans-serif;font-size:1.15em;letter-spacing:.06em;text-transform:uppercase;cursor:pointer}'
    + '#lp .lp-k.alt{background:#1a1f2a;color:#fff}'
    + '#lp .lp-live-only{display:flex;flex-direction:column;align-items:center}'
    + '#lp.err .lp-err{display:flex}#lp.err .lp-live-only{display:none}'
    + '#lp .lp-hint{font-size:.85em;color:#8d9870;letter-spacing:.06em;padding:0 1em .8em;text-align:center}#lp .lp-hint b{color:#7db300}'
    + '#lp .lp-foot{flex:0 0 auto;height:2.7em;display:flex;align-items:center;justify-content:center;gap:1.2em;border-top:1px solid rgba(165,255,8,.16);background:#050603;font-size:.7em;letter-spacing:.1em;color:#8d9870;text-transform:uppercase}'
    + '#lp .lp-foot b{color:#7db300}#lp .lp-sep{width:4px;height:4px;border-radius:50%;background:#8d9870;opacity:.5}'
    + '.lp-toast{position:fixed;left:50%;top:6%;transform:translateX(-50%);z-index:2147483001;background:#fff;color:#000;font:600 min(2.2vh,2.6vw) Inter,sans-serif;padding:.75em 1.4em;border-radius:.75em;box-shadow:0 10px 40px rgba(0,0,0,.5);transition:opacity .3s;pointer-events:none}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  function el(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstChild; }
  function $(sel) { return document.querySelector(sel); }

  function toast(msg) {
    var t = el('<div class="lp-toast"></div>');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; }, 3500);
    setTimeout(function () { t.remove(); }, 4000);
  }

  /* ---- back from the AOG site: say why ---- */
  (function () {
    var m = /[#&]lp_out=([a-z_]+)/.exec(location.hash || '');
    if (!m) return;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    toast({
      idle: 'Logged out after 1 minute of inactivity',
      logout: 'You have been logged out',
      auth_error: 'Your kiosk session has expired. Please log in again.'
    }[m[1]] || 'You have been logged out');
  })();

  /* ---- login screen ---- */
  var screen = el(
    '<div id="lp" role="dialog" aria-label="Login and Play">'
    + '<div class="lp-bar"><div><div class="lp-logo">AOG<i>.</i></div><div class="lp-tag">Login &amp; Play</div></div>'
    + '<div class="lp-live"><span class="lp-dot"></span> In-Store Live</div></div>'
    + '<button type="button" class="lp-back" data-lp="back">&lsaquo; Back</button>'
    + '<div class="lp-body">'
    + '<div class="lp-h">Log in with <em>your phone</em></div>'
    + '<div class="lp-s">Scan with your phone camera. Already logged in? It\'s instant.</div>'
    + '<div class="lp-live-only">'
    + '<div class="lp-qr"><div class="lp-c c1"></div><div class="lp-c c2"></div><div class="lp-c c3"></div><div class="lp-c c4"></div><div class="lp-spin"></div><img alt="" data-lp="qr" /></div>'
    + '<div class="lp-code" data-lp="code">———</div>'
    + '<div class="lp-exp" data-lp="exp"></div>'
    + '<div class="lp-wait" data-lp="wait"><span class="lp-dot" style="width:.5em;height:.5em"></span><span data-lp="waittxt">Waiting for your phone…</span></div>'
    + '</div>'
    + '<div class="lp-err"><p data-lp="errtxt"></p><div class="lp-row">'
    + '<button type="button" class="lp-k" data-lp="retry">Try again</button>'
    + '<button type="button" class="lp-k alt" data-lp="home">Back</button></div></div>'
    + '</div>'
    + '<div class="lp-hint">New to AOG? Go <b>Back</b> and scan <b>SCAN TO JOIN</b> to sign up</div>'
    + '<div class="lp-foot"><span><b>21+</b> only</span><span class="lp-sep"></span><span>Your session ends automatically after 1 minute of inactivity</span></div>'
    + '</div>');
  function part(n) { return screen.querySelector('[data-lp="' + n + '"]'); }

  var req = null;         // { id, secret, code, url, deadline }
  var pollTimer = null, tickTimer = null, lastTouch = Date.now(), netFailSince = 0, busy = false;

  function stopTimers() { clearTimeout(pollTimer); clearInterval(tickTimer); pollTimer = tickTimer = null; }

  function fmt(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  function setWait(txt, ok) {
    part('waittxt').textContent = txt;
    part('wait').classList.toggle('ok', !!ok);
  }

  function showError(msg) {
    stopTimers();
    if (req) closeOpen('cancelled');   // nothing pending may outlive the error
    req = null;
    part('errtxt').textContent = msg;
    screen.classList.remove('loading');
    screen.classList.add('err');
    lastTouch = Date.now();
    // Any failure may mean the feature was switched off since the last check:
    // ask now, so Back never returns to a button that can no longer work.
    checkEnabled(true);
    // Nobody acting on the error: back to the home screen for the next visitor.
    tickTimer = setInterval(function () { if (Date.now() - lastTouch > IDLE_MS) goHome(); }, 1000);
  }

  function goHome() {
    stopTimers();
    if (req) closeOpen('cancelled');
    req = null;
    screen.classList.remove('on', 'err', 'loading');
  }

  function start() {
    if (busy) return;
    busy = true;
    stopTimers();
    screen.classList.remove('err');
    screen.classList.add('on', 'loading');
    part('qr').removeAttribute('src');
    part('code').textContent = '———';
    part('exp').textContent = '';
    setWait('Getting your code…');
    // A new attempt always invalidates the previous one first.
    closeOpen('cancelled').then(function () {
      return api('POST', '/kiosk-login/requests', { auth: true });
    }).then(function (r) {
      busy = false;
      if (!screen.classList.contains('on')) {         // Back pressed meanwhile
        if (r.ok && r.data.id) {
          api('POST', '/kiosk-login/requests/' + r.data.id + '/close',
              { secret: r.data.secret, body: { reason: 'cancelled' } }).catch(function () {});
        }
        return;
      }
      if (r.status === 403) {
        // Switched off since this page last checked: drop the button now
        // rather than waiting for the next 15-minute check.
        unmountButton();
        toast('Login & Play is not available on this kiosk right now.');
        return;
      }
      if (!r.ok || !r.data.id) {
        showError(r.status === 401
          ? 'This kiosk is signed out. Please ask a staff member for help.'
          : 'Couldn\'t start Login & Play. Please try again.');
        return;
      }
      var d = r.data;
      req = { id: d.id, secret: d.secret, url: d.url, deadline: Date.now() + d.secondsLeft * 1000 };
      ls(OPEN_KEY, JSON.stringify({ id: d.id, s: d.secret }));
      try { console.info('[Login & Play] QR link:', d.url); } catch (e) {}
      part('qr').onload = function () { screen.classList.remove('loading'); };
      part('qr').src = d.qr;
      part('code').textContent = d.code;
      setWait('Waiting for your phone…');
      netFailSince = 0;
      tickTimer = setInterval(tick, 250);
      tick();
      poll();
    }, function () {
      busy = false;
      if (screen.classList.contains('on')) showError('Network problem. Check the kiosk\'s internet connection and try again.');
    });
  }

  function tick() {
    if (!req) return;
    var left = req.deadline - Date.now();
    part('exp').textContent = 'Code expires in ' + fmt(left);
    if (left <= 0) showError('This code has expired. Get a new code to try again.');
  }

  var MESSAGES = {
    expired: 'This code has expired. Get a new code to try again.',
    rejected: 'Login was cancelled on the phone.',
    cancelled: 'This login request was cancelled.',
    failed: 'We couldn\'t log you in. Please try again.'
  };

  function poll() {
    if (!req) return;
    var mine = req;
    api('GET', '/kiosk-login/requests/' + mine.id + '/status', { secret: mine.secret }).then(function (r) {
      if (req !== mine) return;
      netFailSince = 0;
      var d = r.data;
      if (!r.ok) return showError(MESSAGES.failed);
      if (d.status === 'scanned') setWait('Phone scanned. Confirm on your phone…');
      if (d.status === 'approved' && d.token) return enterSite(mine, d);
      if (d.status === 'approved') return showError(MESSAGES.failed);  // already claimed elsewhere
      if (MESSAGES[d.status]) return showError(MESSAGES[d.status]);
      pollTimer = setTimeout(poll, POLL_MS);
    }, function () {
      if (req !== mine) return;
      if (!netFailSince) netFailSince = Date.now();
      if (Date.now() - netFailSince > NET_FAIL_MS) {
        return showError('Network problem. Check the kiosk\'s internet connection and try again.');
      }
      setWait('Connection problem. Retrying…');
      pollTimer = setTimeout(poll, POLL_MS);
    });
  }

  function enterSite(mine, d) {
    stopTimers();
    setWait('Approved! Logging you in…', true);
    // The token rides in the fragment (never sent to any server) and the site
    // strips it from history on arrival. The secret goes with it so the site
    // can end this session on logout even after the token itself is dead.
    var site;
    try { site = new URL(mine.url).origin; } catch (e) { return showError(MESSAGES.failed); }
    var back = location.origin + location.pathname + location.search;
    var frag = 't=' + encodeURIComponent(d.token) + '&id=' + mine.id
      + '&s=' + encodeURIComponent(mine.secret) + '&r=' + encodeURIComponent(back);
    req = null;   // keep aog_lp_open: this page ends the session on its next load
    setTimeout(function () { location.href = site + '/kiosk-play#' + frag; }, 700);
  }

  screen.addEventListener('click', function (e) {
    var b = e.target.closest('[data-lp]');
    if (!b) return;
    var a = b.getAttribute('data-lp');
    if (a === 'back' || a === 'home') goHome();
    if (a === 'retry') start();
  });
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    screen.addEventListener(ev, function () { lastTouch = Date.now(); }, { passive: true });
  });

  /* ---- the Login & Play button ---- */
  var mounted = null, joinEl = null;

  // Size the button block off the panel it sits in, so it scales the same
  // way the rest of each layout does (TV, portrait signage, phone).
  function overflowing() {
    var foot = $('.foot');
    var limit = innerHeight - (foot ? foot.offsetHeight : 0)
      - (parseFloat(getComputedStyle(joinEl).paddingBottom) || 0);
    return mounted.getBoundingClientRect().bottom > limit + 1;
  }
  function sizeBlock() {
    if (!mounted) return;
    var join = joinEl;
    var qr = join.querySelector('.qrbox'), head = join.querySelector('.stephead');
    if (qr) qr.style.width = qr.style.height = '';
    if (head) head.style.display = '';
    mounted.style.fontSize = Math.max(11, Math.min(join.clientWidth / 26, innerHeight / 46)) + 'px';
    // The panel was laid out without the button. If it no longer fits on
    // screen, take the room back the way the approved design does: drop the
    // "Follow the steps" heading, then shrink the sign-up QR (never below 55%).
    if (head && overflowing()) head.style.display = 'none';
    if (!qr) return;
    var base = qr.getBoundingClientRect().width, size = base;
    while (overflowing() && size > base * 0.55) {
      size -= base * 0.05;
      qr.style.width = qr.style.height = size + 'px';
    }
  }

  function mountButton() {
    if (mounted) return;
    var join = joinEl = $('.join');
    if (!join) return;
    mounted = el('<div class="lp-wrap">'
      + '<div class="lp-or">Have an account?</div>'
      + '<div class="lp-btnwrap"><button type="button" class="lp-btn"><span>&#9654; Login &amp; Play</span></button><span class="lp-new">NEW</span></div>'
      + '<div class="lp-sub">Play on this screen</div></div>');
    var steps = join.querySelector('.steps');
    if (steps) steps.parentNode.insertBefore(mounted, steps.nextSibling);
    else join.appendChild(mounted);
    mounted.querySelector('.lp-btn').addEventListener('click', start);
    document.body.appendChild(screen);
    sizeBlock();
    addEventListener('resize', sizeBlock);
  }

  function unmountButton() {
    if (!mounted) return;
    goHome();
    mounted.remove();
    mounted = null;
    var qr = $('.join .qrbox'), head = $('.join .stephead');
    if (qr) qr.style.width = qr.style.height = '';
    if (head) head.style.display = '';
  }

  // notify: say why the button vanished (used when a visitor is mid-attempt).
  function checkEnabled(notify) {
    if (!storeToken()) return;
    api('GET', '/kiosk-login/enabled', { auth: true }).then(function (r) {
      if (r.ok && r.data.enabled) return mountButton();
      if (!r.ok || !mounted) return;
      unmountButton();
      if (notify) toast('Login & Play is not available on this kiosk right now.');
    }, function () { /* offline: keep whatever is showing */ });
  }
  checkEnabled();
  // CloudFront screens can run for days without a reload; pick up the flag.
  setInterval(checkEnabled, 15 * 60 * 1000);
})();
