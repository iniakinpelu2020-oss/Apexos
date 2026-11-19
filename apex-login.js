/* apex-login.js - one sign-in gate for every Apex app.
 *
 * Firebase Auth over REST. No SDK, no build step, no server of ours: the email
 * and password go to Google's identity endpoint, and the ID token stays in
 * localStorage on this device.
 *
 * Drop it in before </body>:
 *
 *   <script src="./apex-login.js"></script>
 *
 * The page then shows a full-screen sign-in until there is a session.
 * ApexLogin.session() hands app code { uid, email, idToken, refreshToken,
 * expiresAt }. The storage key matches js/apex-auth.js in Apex-Auth, so one
 * sign-in covers every app on the origin - standalone or inside ApexOS.
 *
 * Not a server-side check. It keeps the apps behind one door for the person
 * holding the device; it is not an access control for data you share.
 */
(function (global) {
  'use strict';

  var CONFIG = {
    apiKey: 'AIzaSyAXSWi7f3tCMF_2cimrjnLo9j8BZb7Ckr0',
    projectId: 'apexaiautomation',
    storageKey: 'apex-auth-session',
    knownKey: 'apex-auth-known',
    bypassKey: 'apex-login-bypass',
    adminOnly: false
  };

  var override = global.APEX_LOGIN_CONFIG;
  if (override && typeof override === 'object') {
    for (var key in override) {
      if (Object.prototype.hasOwnProperty.call(override, key)) CONFIG[key] = override[key];
    }
  }

  var IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts:';
  var TOKEN_URL = 'https://securetoken.googleapis.com/v1/token?key=';

  var FRIENDLY = {
    EMAIL_EXISTS: 'That email already has an account. Sign in instead.',
    EMAIL_NOT_FOUND: 'No account uses that email.',
    INVALID_PASSWORD: 'Wrong password.',
    INVALID_LOGIN_CREDENTIALS: 'Wrong email or password.',
    INVALID_EMAIL: 'That does not look like an email address.',
    MISSING_PASSWORD: 'Enter a password.',
    WEAK_PASSWORD: 'Use at least 6 characters.',
    PASSWORD_LOGIN_DISABLED: 'Email and password sign-in is switched off in the Firebase console.',
    OPERATION_NOT_ALLOWED: 'Email and password sign-in is switched off in the Firebase console.',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts. Wait a few minutes and try again.',
    USER_DISABLED: 'That account has been disabled.',
    MISSING_EMAIL: 'Enter your email address.'
  };

  var OFFLINE = /^(Failed to fetch|NetworkError|Load failed|fetch failed)/i;

  function friendly(code, fallback) {
    return FRIENDLY[code] || code || fallback || 'Sign-in failed.';
  }

  /* ---------- session ---------- */

  var listeners = new Set();

  function readSession() {
    try {
      var raw = global.localStorage.getItem(CONFIG.storageKey);
      if (!raw) return null;
      var value = JSON.parse(raw);
      return value && value.idToken ? value : null;
    } catch (err) {
      return null;
    }
  }

  function writeSession(next) {
    try {
      if (next) global.localStorage.setItem(CONFIG.storageKey, JSON.stringify(next));
      else global.localStorage.removeItem(CONFIG.storageKey);
    } catch (err) {}
    var session = next;
    listeners.forEach(function (fn) {
      try { fn(session); } catch (err) {}
    });
    return session;
  }

  function shape(data) {
    return {
      uid: data.localId || data.user_id || '',
      email: data.email || '',
      idToken: data.idToken || data.id_token || data.access_token || '',
      refreshToken: data.refreshToken || data.refresh_token || '',
      expiresAt: Date.now() + Number(data.expiresIn || data.expires_in || 3600) * 1000
    };
  }

  function post(url, body, form) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json'
      },
      body: form ? new URLSearchParams(body) : JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var raw = (data && data.error && data.error.message) || '';
          var err = new Error(friendly(String(raw).split(' ')[0], raw));
          err.code = String(raw).split(' ')[0];
          throw err;
        }
        return data;
      });
    });
  }

  var ApexLogin = {
    config: CONFIG,

    session: readSession,
    isSignedIn: function () { return Boolean(readSession()); },
    userId: function () { var s = readSession(); return s ? s.uid : null; },
    email: function () { var s = readSession(); return s ? s.email : ''; },

    signIn: function (email, password) {
      return post(IDENTITY + 'signInWithPassword?key=' + CONFIG.apiKey, {
        email: String(email || '').trim(),
        password: password,
        returnSecureToken: true
      }).then(function (data) {
        try { global.localStorage.setItem(CONFIG.knownKey, '1'); } catch (err) {}
        var session = writeSession(shape(data));
        announce('apex:signin', session);
        paintChrome();
        return session;
      });
    },

    signUp: function (email, password) {
      return post(IDENTITY + 'signUp?key=' + CONFIG.apiKey, {
        email: String(email || '').trim(),
        password: password,
        returnSecureToken: true
      }).then(function (data) {
        try { global.localStorage.setItem(CONFIG.knownKey, '1'); } catch (err) {}
        var session = writeSession(shape(data));
        announce('apex:signin', session);
        paintChrome();
        return session;
      });
    },

    resetPassword: function (email) {
      return post(IDENTITY + 'sendOobCode?key=' + CONFIG.apiKey, {
        requestType: 'PASSWORD_RESET',
        email: String(email || '').trim()
      });
    },

    refresh: function () {
      var current = readSession();
      if (!current || !current.refreshToken) return Promise.reject(new Error('No session to refresh.'));
      return post(TOKEN_URL + CONFIG.apiKey, {
        grant_type: 'refresh_token',
        refresh_token: current.refreshToken
      }, true).then(function (data) {
        var next = shape(data);
        next.email = data.email || current.email;
        return writeSession(next);
      });
    },

    /* A fresh ID token for an API call, refreshed only when it is near expiry. */
    token: function (force) {
      var current = readSession();
      if (!current) return Promise.resolve(null);
      if (!force && current.expiresAt - Date.now() > 60000) return Promise.resolve(current.idToken);
      return ApexLogin.refresh().then(function (next) { return next.idToken; })
        .catch(function (err) { writeSession(null); throw err; });
    },

    signOut: function (reload) {
      writeSession(null);
      announce('apex:signout', null);
      if (reload !== false && global.location) global.location.reload();
    },

    onChange: function (fn) {
      listeners.add(fn);
      try { fn(readSession()); } catch (err) {}
      return function () { listeners.delete(fn); };
    },

    gate: function () { showGate(''); }
  };

  function announce(name, detail) {
    try {
      global.document.dispatchEvent(new CustomEvent(name, { detail: detail }));
    } catch (err) {}
  }

  /* ---------- chrome hooks ---------- */

  /* Any element marked data-apex-account shows the signed-in email;
     any element marked data-apex-signout signs out when tapped. */
  function paintChrome() {
    var session = readSession();
    document.querySelectorAll('[data-apex-account]').forEach(function (el) {
      el.textContent = session && session.email ? session.email : 'Signed in';
    });
    document.querySelectorAll('[data-apex-signout]').forEach(function (el) {
      if (el.dataset.apexBound === '1') return;
      el.dataset.apexBound = '1';
      el.addEventListener('click', function (event) {
        event.preventDefault();
        ApexLogin.signOut();
      });
    });
  }

  /* ---------- the gate itself ---------- */

  var CSS = [
    '.apex-gate{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;',
    'padding:24px 18px;background:radial-gradient(900px 520px at 18% -10%,#241a46 0%,#0b0d17 58%,#080a10 100%);',
    'color:#e7edf5;font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:auto}',
    '.apex-gate *{box-sizing:border-box}',
    '.apex-gate-card{width:100%;max-width:400px;background:#11151dcc;border:1px solid #242c37;border-radius:18px;',
    'padding:24px;backdrop-filter:blur(14px);box-shadow:0 30px 80px #000a}',
    '.apex-gate-brand{display:flex;align-items:center;gap:10px;margin-bottom:18px}',
    '.apex-gate-mark{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;font-weight:800;',
    'background:linear-gradient(145deg,#a78bfa,#6d4ed8);color:#150e2b}',
    '.apex-gate-word{font-size:16px;letter-spacing:.3px;font-weight:600}',
    '.apex-gate-word b{color:#a78bfa}',
    '.apex-gate h1{font-size:19px;margin:0 0 4px;font-weight:650}',
    '.apex-gate-sub{margin:0 0 18px;font-size:13px;color:#8b98a9}',
    '.apex-gate-label{display:block;font-size:12px;color:#8b98a9;margin:0 0 6px}',
    '.apex-gate-input{width:100%;background:#171d25;border:1px solid #242c37;border-radius:10px;color:#e7edf5;',
    'padding:11px 13px;font:inherit;outline:none;margin-bottom:14px}',
    '.apex-gate-input:focus{border-color:#4c3f7a;box-shadow:0 0 0 3px #a78bfa1f}',
    '.apex-gate-btn{font:inherit;font-size:14px;border-radius:10px;border:1px solid #2b3542;background:#171d25;',
    'color:#e7edf5;padding:11px 14px;cursor:pointer;width:100%}',
    '.apex-gate-btn:hover{border-color:#3a4655}',
    '.apex-gate-btn:disabled{opacity:.6;cursor:progress}',
    '.apex-gate-primary{background:linear-gradient(145deg,#a78bfa,#7c5cf0);border-color:transparent;color:#140d28;',
    'font-weight:700;margin-bottom:10px}',
    '.apex-gate-row{display:flex;gap:10px}',
    '.apex-gate-row .apex-gate-btn{flex:1;font-size:13px}',
    '.apex-gate-msg{min-height:20px;font-size:13px;margin:12px 0 0;color:#8b98a9}',
    '.apex-gate-msg.bad{color:#f87171}',
    '.apex-gate-msg.ok{color:#a78bfa}',
    '.apex-gate-escape{margin:12px 0 0;font-size:12.5px}',
    '.apex-gate-escape button{background:none;border:0;color:#8b98a9;text-decoration:underline;cursor:pointer;',
    'font:inherit;padding:0}',
    '.apex-gate-foot{margin:16px 0 0;font-size:11.5px;color:#5f6b7a;text-align:center}',
    '.apex-gate-banner{position:fixed;left:0;right:0;bottom:0;z-index:2147482999;background:#3a2a12;color:#f5d9a8;',
    'font:12.5px/1.4 ui-sans-serif,system-ui,sans-serif;padding:8px 14px;text-align:center}',
    '[hidden]{display:none !important}'
  ].join('');

  function injectCss() {
    if (document.getElementById('apex-gate-style')) return;
    var style = document.createElement('style');
    style.id = 'apex-gate-style';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  var MARKUP = [
    '<form class="apex-gate-card" novalidate>',
    '<div class="apex-gate-brand"><span class="apex-gate-mark">A</span>',
    '<span class="apex-gate-word">Apex<b>ID</b></span></div>',
    '<h1>Sign in to Apex</h1>',
    '<p class="apex-gate-sub">One account for every app in the suite.</p>',
    '<label class="apex-gate-label" for="apexGateEmail">Email</label>',
    '<input class="apex-gate-input" id="apexGateEmail" type="email" autocomplete="email" spellcheck="false" placeholder="you@example.com">',
    '<label class="apex-gate-label" for="apexGatePassword">Password</label>',
    '<input class="apex-gate-input" id="apexGatePassword" type="password" autocomplete="current-password" placeholder="at least 6 characters">',
    '<button class="apex-gate-btn apex-gate-primary" type="submit">Sign in</button>',
    '<div class="apex-gate-row">',
    '<button class="apex-gate-btn" type="button" data-act="up">Create account</button>',
    '<button class="apex-gate-btn" type="button" data-act="reset">Forgot password</button>',
    '</div>',
    '<p class="apex-gate-msg" role="status" aria-live="polite"></p>',
    '<p class="apex-gate-escape" hidden><button type="button" data-act="escape">Open with local data only</button></p>',
    '<p class="apex-gate-foot">Firebase Auth &middot; project <span data-live="project"></span></p>',
    '</form>'
  ].join('');

  function showGate(reason) {
    if (document.getElementById('apexGate')) return;
    injectCss();
    document.documentElement.style.visibility = '';

    var host = document.createElement('div');
    host.className = 'apex-gate';
    host.id = 'apexGate';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.innerHTML = MARKUP;

    var form = host.querySelector('form');
    var emailInput = host.querySelector('#apexGateEmail');
    var passwordInput = host.querySelector('#apexGatePassword');
    var submit = host.querySelector('button[type="submit"]');
    var msg = host.querySelector('.apex-gate-msg');
    var escapeBox = host.querySelector('.apex-gate-escape');
    var escapeBtn = host.querySelector('[data-act="escape"]');

    host.querySelector('[data-live="project"]').textContent = CONFIG.projectId;
    document.body.appendChild(host);
    emailInput.focus();

    function say(text, kind) {
      msg.textContent = text || '';
      msg.className = 'apex-gate-msg' + (kind ? ' ' + kind : '');
    }

    function busy(on) {
      [submit].concat(Array.prototype.slice.call(host.querySelectorAll('[data-act]')))
        .forEach(function (btn) { btn.disabled = on; });
    }

    function offlineKnown() {
      try { return global.localStorage.getItem(CONFIG.knownKey) === '1'; } catch (err) { return false; }
    }

    /* A real lockout is worse than a soft gate: if the console is misconfigured
       or the device is offline on first run, offer local use for this tab. */
    function offerEscape(err) {
      var code = (err && err.code) || '';
      var blocked = code === 'OPERATION_NOT_ALLOWED' || code === 'PASSWORD_LOGIN_DISABLED';
      if (blocked || OFFLINE.test(String((err && err.message) || '')) || !global.navigator.onLine) {
        escapeBox.hidden = false;
      }
    }

    function finish() {
      host.remove();
      document.documentElement.style.visibility = '';
      paintChrome();
      announce('apex:ready', readSession());
    }

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var email = emailInput.value.trim();
      var password = passwordInput.value;
      if (!email) { say('Enter your email address.', 'bad'); return; }
      if (!password) { say('Enter a password.', 'bad'); return; }
      busy(true);
      say('Checking\u2026');
      ApexLogin.signIn(email, password).then(finish).catch(function (err) {
        busy(false);
        say(err.message || 'Sign-in failed.', 'bad');
        offerEscape(err);
      });
    });

    host.querySelector('[data-act="up"]').addEventListener('click', function () {
      var email = emailInput.value.trim();
      var password = passwordInput.value;
      if (!email) { say('Enter your email address.', 'bad'); return; }
      if (password.length < 6) { say('Use at least 6 characters for the password.', 'bad'); return; }
      busy(true);
      say('Creating the account\u2026');
      ApexLogin.signUp(email, password).then(finish).catch(function (err) {
        busy(false);
        say(err.message || 'Could not create the account.', 'bad');
        offerEscape(err);
      });
    });

    host.querySelector('[data-act="reset"]').addEventListener('click', function () {
      var email = emailInput.value.trim();
      if (!email) { say('Type your email above, then press Forgot password again.', 'bad'); return; }
      busy(true);
      ApexLogin.resetPassword(email).then(function () {
        busy(false);
        say('Sent. Check ' + email + ' for the reset link.', 'ok');
      }).catch(function (err) {
        busy(false);
        say(err.message || 'Could not send the reset email.', 'bad');
        offerEscape(err);
      });
    });

    escapeBtn.addEventListener('click', function () {
      try { global.sessionStorage.setItem(CONFIG.bypassKey, '1'); } catch (err) {}
      var banner = document.createElement('div');
      banner.className = 'apex-gate-banner';
      banner.textContent = 'Apex sign-in is unavailable here, so this tab is running on local data only.';
      document.body.appendChild(banner);
      finish();
    });

    if (reason) say(reason, 'bad');
  }

  /* ---------- boot ---------- */

  function bypassed() {
    try { return global.sessionStorage.getItem(CONFIG.bypassKey) === '1'; } catch (err) { return false; }
  }

  function boot() {
    if (readSession() || bypassed()) {
      paintChrome();
      return;
    }
    /* Keep the page invisible until the gate is up, so nothing shows first. */
    document.documentElement.style.visibility = 'hidden';
    showGate('');
    paintChrome();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  global.ApexLogin = ApexLogin;
})(typeof globalThis !== 'undefined' ? globalThis : window);
