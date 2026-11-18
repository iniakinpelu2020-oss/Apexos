/* ApexOS shell - renders the desktop and app drawer from apex_installed_apps
 * and stays in sync with Apex Store and Apex Settings over BroadcastChannel.
 *
 * No manual link list: what you install in the Store appears here, what you
 * uninstall disappears, and theme changes from Settings apply immediately.
 */
(function (global) {
  'use strict';

  var VERSION = 2;
  var R = global.ApexRegistry || null;

  /* Permissions an app window may request from the shell. Camera, microphone
     and clipboard are gated on the frame, so they have to be named here. */
  var APP_FRAME_ALLOW = 'camera; microphone; geolocation; clipboard-read; clipboard-write; fullscreen';

  /* The bundled catalogue. Paths match .github/workflows/bundle-apex.yml. */
  var CATALOG = [
    { id: 'ai',         name: 'Apex AI',       cat: 'AI',           repo: 'The-Apex-Ai',   path: '/apps/ai/' },
    { id: 'studio',     name: 'Apex Studio',   cat: 'Media',        repo: 'Apex-Studio',   path: '/apps/studio/' },
    { id: 'editor',     name: 'Apex Editor',   cat: 'Productivity', repo: 'Apex-Editor',   path: '/apps/editor/' },
    { id: 'browser',    name: 'Apex Browser',  cat: 'Utilities',    repo: 'Apex-Browser',  path: '/apps/browser/' },
    { id: 'search',     name: 'Apex Search',   cat: 'Utilities',    repo: 'Apex-Search',   path: '/apps/search/' },
    { id: 'notrack',    name: 'Apex NoTrack',  cat: 'Utilities',    repo: 'Apex-Notrack',  path: '/apps/notrack/' },
    { id: 'drive',      name: 'Apex Drive',    cat: 'Files',        repo: 'Apex-Drive',    path: '/apps/drive/' },
    { id: 'docs',       name: 'Apex Docs',     cat: 'Knowledge',    repo: 'Apex-Docs',     path: '/apps/docs/' },
    { id: 'notes',      name: 'Apex Notes',    cat: 'Knowledge',    repo: 'Apex-Notes',    path: '/apps/notes/' },
    { id: 'planner',    name: 'Apex Planner',  cat: 'Productivity', repo: 'Apex-Planner',  path: '/apps/planner/' },
    { id: 'drop',       name: 'Apex Drop',     cat: 'Files',        repo: 'Apex-Drop',     path: '/apps/drop/' },
    { id: 'gallery',    name: 'Apex Gallery',  cat: 'Media',        repo: 'Apex-Gallery',  path: '/apps/gallery/' },
    { id: 'camera',     name: 'Apex Camera',   cat: 'Media',        repo: 'Apex-Camera',   path: '/apps/camera/' },
    { id: 'voice',      name: 'Apex Voice',    cat: 'Media',        repo: 'Apex-Voice',    path: '/apps/voice/' },
    { id: 'video',      name: 'Apex Video',    cat: 'Media',        repo: 'Apex-Video',    path: '/apps/video/' },
    { id: 'archive',    name: 'Apex Archive',  cat: 'Knowledge',    repo: 'Apex-Archive',  path: '/apps/archive/' },
    { id: 'links',      name: 'Apex Links',    cat: 'Utilities',    repo: 'Apex-Links',    path: '/apps/links/' },
    { id: 'backup',     name: 'Apex Backup',   cat: 'System',       repo: 'Apex-Backup',   path: '/apps/backup/' },
    { id: 'vault',      name: 'Apex Vault',    cat: 'Security',     repo: 'Apex-Vault',    path: '/apps/vault/' },
    { id: 'shield',     name: 'Apex Shield',   cat: 'Security',     repo: 'Apex-Shield',   path: '/apps/shield/' },
    { id: 'sec',        name: 'Apex Sec',      cat: 'Security',     repo: 'Apex-Sec',      path: '/apps/sec/' },
    { id: 'auth',       name: 'Apex Auth',     cat: 'Security',     repo: 'Apex-Auth',     path: '/apps/auth/' },
    { id: 'ledger',     name: 'Apex Ledger',   cat: 'Productivity', repo: 'Apex-Ledger',   path: '/apps/ledger/' },
    { id: 'feed',       name: 'Apex Feed',     cat: 'Media',        repo: 'Apex-Feed',     path: '/apps/feed/' },
    { id: 'pulse',      name: 'Apex Pulse',    cat: 'System',       repo: 'Apex-Pulse',    path: '/apps/pulse/' },
    { id: 'automation', name: 'Automation',    cat: 'Automation',   repo: 'Automation',    path: '/apps/automation/' },
    { id: 'store',      name: 'Apex Store',    cat: 'System',       repo: 'Apex-Store',    path: '/apps/store/' },
    { id: 'settings',   name: 'Apex Settings', cat: 'System',       repo: 'Apex-Settings', path: '/apps/settings/' }
  ];

  var byId = {};
  CATALOG.forEach(function (app) { byId[app.id] = app; });

  /* ---------- public catalogue API (used by the store and tooling) ---------- */

  function all() { return CATALOG.slice(); }
  function get(id) { return byId[id] || null; }
  function url(id) { return byId[id] ? byId[id].path : null; }
  function categories() {
    return CATALOG.reduce(function (list, app) {
      if (list.indexOf(app.cat) === -1) list.push(app.cat);
      return list;
    }, []);
  }

  global.ApexApps = {
    version: VERSION,
    all: all,
    get: get,
    url: url,
    categories: categories
  };

  /* ---------- shell ---------- */

  var els = {};
  var latestNew = '';
  var lastIcon = null;

  function initials(name) {
    var words = String(name || '').split(/\s+/).filter(function (word) {
      return word && !/^(apex|the|and)$/i.test(word);
    });
    if (!words.length) words = [String(name || '?')];
    if (words.length > 1) {
      return words.slice(0, 2).map(function (word) { return word.charAt(0); }).join('').toUpperCase();
    }
    return words[0].slice(0, 2).toUpperCase();
  }

  function hue(id) {
    var sum = 0;
    String(id).split('').forEach(function (ch) { sum = (sum * 31 + ch.charCodeAt(0)) % 360; });
    return sum;
  }

  function iconNode(app) {
    var link = document.createElement('a');
    link.className = 'icon';
    link.href = app.url;
    link.dataset.id = app.id;
    link.dataset.core = app.source === 'core' ? 'true' : 'false';

    /* Pinned Play Store shortcuts are external - never replace ApexOS itself. */
    if (/^https?:/i.test(app.url)) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }

    if (app.id === latestNew) link.classList.add('is-new');

    /* Same-origin apps open in the shell's app window so permission-gated
       features reach the frame. Modifier clicks still open a real tab. */
    if (!/^https?:/i.test(app.url)) {
      link.addEventListener('click', function (event) {
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        openApp(app, link);
      });
    }

    var glyph = document.createElement('span');
    glyph.className = 'glyph';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.style.setProperty('--hue', String(hue(app.id)));
    glyph.textContent = initials(app.name);

    var label = document.createElement('span');
    label.className = 'label';
    label.textContent = app.name;

    link.appendChild(glyph);
    link.appendChild(label);
    return link;
  }

  /* Prefer the shared registry; degrade to localStorage, then to the catalogue. */
  function installedApps() {
    if (R) return R.ensureSeeded();
    var list = [];
    try {
      list = JSON.parse(global.localStorage.getItem('apex_installed_apps') || '[]');
    } catch (err) {
      list = [];
    }
    if (!Array.isArray(list) || !list.length) {
      return CATALOG.filter(function (app) {
        return ['store', 'settings', 'ai', 'drive', 'sec', 'shield'].indexOf(app.id) !== -1;
      }).map(function (app) {
        return { id: app.id, name: app.name, url: app.path, source: 'core' };
      });
    }
    return list;
  }

  function render(highlightId) {
    latestNew = highlightId || '';
    var list = installedApps().slice().sort(function (a, b) {
      if (a.source === b.source) return a.name.localeCompare(b.name);
      return a.source === 'core' ? -1 : 1;
    });

    [els.desktopGrid, els.drawerGrid].forEach(function (grid) {
      grid.innerHTML = '';
      list.forEach(function (app) { grid.appendChild(iconNode(app)); });
    });

    if (els.desktopEmpty) els.desktopEmpty.hidden = list.length > 0;
    if (els.drawerCount) {
      els.drawerCount.textContent = list.length + (list.length === 1 ? ' app installed' : ' apps installed');
    }
    latestNew = '';
  }

  /* ---------- theme ---------- */

  function resolveLayout(mode) {
    if (mode === 'desktop' || mode === 'mobile') return mode;
    var narrow = global.matchMedia ? global.matchMedia('(max-width: 720px)').matches : false;
    return narrow ? 'mobile' : 'desktop';
  }

  function applyConfig(config) {
    var appearance = (config && config.appearance) || {};
    var body = global.document.body;

    body.dataset.wall = appearance.wallpaper || 'aurora';
    body.dataset.layout = resolveLayout(appearance.mode);

    var accent = /^#[0-9a-fA-F]{6}$/.test(appearance.accent || '') ? appearance.accent : '#7c8cff';
    var scale = Number(appearance.scale);
    if (!isFinite(scale)) scale = 100;

    document.documentElement.style.setProperty('--accent', accent);
    document.documentElement.style.setProperty('--scale', String(Math.min(140, Math.max(80, scale)) / 100));
  }

  function readConfig() {
    if (R && typeof R.config === 'function') {
      var fromRegistry = R.config();
      if (fromRegistry) return fromRegistry;
    }
    try {
      return JSON.parse(global.localStorage.getItem('apex_os_config') || 'null');
    } catch (err) {
      return null;
    }
  }

  /* ---------- chrome ---------- */

  var toastTimer = 0;

  function toast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.hidden = false;
    global.clearTimeout(toastTimer);
    toastTimer = global.setTimeout(function () { els.toast.hidden = true; }, 2600);
  }

  function tickClock() {
    if (!els.clock) return;
    var now = new Date();
    var hh = String(now.getHours()).padStart(2, '0');
    var mm = String(now.getMinutes()).padStart(2, '0');
    els.clock.textContent = hh + ':' + mm;
    els.clock.setAttribute('datetime', now.toISOString());
  }

  function paintNetwork() {
    if (!els.netChip) return;
    var online = global.navigator.onLine !== false;
    els.netChip.textContent = online ? 'Online' : 'Offline';
    els.netChip.classList.toggle('is-offline', !online);
  }

  function openDrawer(open) {
    if (!els.drawer) return;
    els.drawer.hidden = !open;
    if (els.drawerBtn) els.drawerBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && els.drawerDone) els.drawerDone.focus();
    if (!open && els.drawerBtn) els.drawerBtn.focus();
  }

  /* ---------- app window ---------- */

  function openApp(app, source) {
    if (!els.appWindow || !els.appFrame) {
      global.location.href = app.url;
      return;
    }

    lastIcon = source || null;
    if (els.drawer && !els.drawer.hidden) openDrawer(false);

    els.appFrame.setAttribute('allow', APP_FRAME_ALLOW);
    els.appFrame.title = app.name + ' app window';
    if (els.windowTitle) els.windowTitle.textContent = app.name;
    if (els.windowOpen) els.windowOpen.href = app.url;

    els.appWindow.hidden = false;
    document.body.dataset.window = 'open';
    els.appFrame.src = app.url;
    if (els.windowClose) els.windowClose.focus();
  }

  function closeApp() {
    if (!els.appWindow || els.appWindow.hidden) return;
    els.appWindow.hidden = true;
    document.body.removeAttribute('data-window');
    if (els.windowTitle) els.windowTitle.textContent = '';
    /* Blank the frame: this is what releases the camera and the microphone. */
    if (els.appFrame) els.appFrame.src = 'about:blank';
    if (lastIcon) lastIcon.focus();
  }

  /* ---------- power menu ---------- */

  var restarting = false;

  function setPowerMenu(open) {
    if (!els.powerMenu) return;
    els.powerMenu.hidden = !open;
    if (els.powerBtn) els.powerBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && els.restartOs) els.restartOs.focus();
  }

  /* Restart OS: ask every worker on the origin for a fresh copy, then reload so
     the new build is the one that renders. Storage is untouched - localStorage,
     IndexedDB and the installed app list all survive. */
  function restartOs() {
    if (restarting) return;
    restarting = true;
    if (els.restartOs) els.restartOs.disabled = true;
    setPowerMenu(false);
    toast('Updating ApexOS\u2026');

    var reload = function () { global.location.reload(true); };

    if (!(global.navigator.serviceWorker && global.navigator.serviceWorker.getRegistrations)) {
      reload();
      return;
    }

    global.navigator.serviceWorker.getRegistrations()
      .then(function (regs) {
        return Promise.all(regs.map(function (reg) {
          /* One unreachable worker must not block the reload. */
          return reg.update().catch(function () { return null; });
        }));
      })
      .catch(function () { /* offline, or no worker yet - a plain reload still helps */ })
      .then(reload);
  }

  function bindChrome() {
    els.drawerBtn.addEventListener('click', function () {
      openDrawer(els.drawer.hidden);
    });
    els.drawerDone.addEventListener('click', function () { openDrawer(false); });

    if (els.windowClose) els.windowClose.addEventListener('click', closeApp);

    if (els.powerBtn) {
      els.powerBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        setPowerMenu(els.powerMenu.hidden);
      });
    }
    if (els.restartOs) els.restartOs.addEventListener('click', restartOs);

    /* Click anywhere else, or press Escape, and the menu folds away. */
    global.document.addEventListener('click', function (event) {
      if (!els.powerMenu || els.powerMenu.hidden) return;
      if (event.target.closest && event.target.closest('.power')) return;
      setPowerMenu(false);
    });

    /* The dock shortcuts open in the app window too, so they behave like icons. */
    Array.prototype.forEach.call(document.querySelectorAll('[data-app]'), function (link) {
      link.addEventListener('click', function (event) {
        var app = byId[link.dataset.app];
        if (!app || event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        openApp({ id: app.id, name: app.name, url: app.path }, link);
      });
    });

    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      if (els.appWindow && !els.appWindow.hidden) {
        closeApp();
        return;
      }
      if (els.powerMenu && !els.powerMenu.hidden) {
        setPowerMenu(false);
        if (els.powerBtn) els.powerBtn.focus();
        return;
      }
      if (!els.drawer.hidden) openDrawer(false);
    });

    global.addEventListener('online', paintNetwork);
    global.addEventListener('offline', paintNetwork);

    global.addEventListener('resize', function () {
      var config = readConfig();
      var mode = config && config.appearance ? config.appearance.mode : 'auto';
      if (!mode || mode === 'auto') global.document.body.dataset.layout = resolveLayout('auto');
    });

    /* Another tab installed or uninstalled something. */
    global.addEventListener('storage', function (event) {
      if (event.key === 'apex_installed_apps') render();
      if (event.key === 'apex_os_config') applyConfig(readConfig());
    });
  }

  function subscribe() {
    if (!R) return;

    R.onMessage(R.appsChannel, function (message) {
      if (message.type === 'APP_INSTALLED' && message.app) {
        render(message.app.id === 'store' || message.app.id === 'settings' ? '' : message.app.id);
        toast(message.app.name + ' installed');
      } else if (message.type === 'APP_UNINSTALLED') {
        render();
        var gone = byId[message.id];
        toast((gone ? gone.name : 'App') + ' uninstalled');
      }
    });

    R.onMessage(R.settingsChannel, function (message) {
      if (message && message.config) applyConfig(message.config);
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in global.navigator)) return;
    global.navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function () {
      /* shell still works online without the offline cache */
    });
  }

  function boot() {
    els.desktopGrid = document.getElementById('desktopGrid');
    els.drawerGrid = document.getElementById('drawerGrid');
    els.desktopEmpty = document.getElementById('desktopEmpty');
    els.drawerCount = document.getElementById('drawerCount');
    els.drawer = document.getElementById('drawer');
    els.drawerBtn = document.getElementById('drawerBtn');
    els.drawerDone = document.getElementById('drawerDone');
    els.appWindow = document.getElementById('appWindow');
    els.appFrame = document.getElementById('appFrame');
    els.windowTitle = document.getElementById('windowTitle');
    els.windowOpen = document.getElementById('windowOpen');
    els.windowClose = document.getElementById('windowClose');
    els.powerBtn = document.getElementById('powerBtn');
    els.powerMenu = document.getElementById('powerMenu');
    els.restartOs = document.getElementById('restartOs');
    els.clock = document.getElementById('clock');
    els.netChip = document.getElementById('netChip');
    els.toast = document.getElementById('toast');

    if (!els.desktopGrid || !els.drawerGrid) return;

    /* Nothing overlays the desktop until it is asked for: a restored tab, a
       bfcache hit or a half-written attribute must not boot with the drawer or
       the power menu already open. */
    openDrawer(false);
    setPowerMenu(false);

    applyConfig(readConfig());
    render();
    bindChrome();
    subscribe();
    paintNetwork();
    tickClock();
    global.setInterval(tickClock, 15000);
    registerServiceWorker();
  }

  if (document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
