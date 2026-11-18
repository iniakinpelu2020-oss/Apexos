/* ApexOS - shared app registry and sync channel.
 *
 * This file is identical in the Apex shell, Apex Store and Apex Settings so all
 * three agree on storage keys, cache names and message shapes. Zero
 * dependencies, no build step, safe to load standalone or from /apps/<slug>/.
 *
 *   localStorage  apex_installed_apps  - [{ id, name, url, source, installedAt }]
 *   localStorage  apex_hidden_core    - core ids the owner uninstalled on purpose
 *   localStorage  apex_os_config      - owned by Apex Settings
 *   caches        apex-app-<id>       - one bucket per installed app
 *   channel       apex-os-apps        - { type: 'APP_INSTALLED', app }
 *                                       { type: 'APP_UNINSTALLED', id }
 *   channel       apex-settings       - { type: 'apex-config-changed', config }
 */
(function (global) {
  'use strict';

  var SCHEMA = 1;
  var APPS_KEY = 'apex_installed_apps';
  var HIDDEN_CORE_KEY = 'apex_hidden_core';
  var CONFIG_KEY = 'apex_os_config';
  var APPS_CHANNEL = 'apex-os-apps';
  var SETTINGS_CHANNEL = 'apex-settings';

  /* Core system apps that are present on every ApexOS device. */
  var CORE_APPS = [
    { id: 'store', name: 'Apex Store', url: '/apps/store/' },
    { id: 'settings', name: 'Apex Settings', url: '/apps/settings/' },
    { id: 'ai', name: 'Apex AI', url: '/apps/ai/' },
    { id: 'drive', name: 'Apex Drive', url: '/apps/drive/' },
    { id: 'sec', name: 'Apex Sec', url: '/apps/sec/' },
    { id: 'shield', name: 'Apex Shield', url: '/apps/shield/' }
  ];

  /* Files every Apex app is expected to ship; missing ones are skipped. */
  var CORE_FILES = ['', 'index.html', 'styles.css', 'app.js', 'manifest.json'];

  function readJson(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      return false;
    }
  }

  /* ---------- core apps the owner removed ----------
     Seeding core apps on every boot is what makes a fresh device usable, but it
     also used to resurrect a core app the owner had just uninstalled. The ids
     they removed are kept here so merge() leaves them out until the app is
     installed again. */

  function hiddenCoreIds() {
    var list = readJson(HIDDEN_CORE_KEY, []);
    if (!Array.isArray(list)) return [];
    return list.filter(function (id, index) {
      return typeof id === 'string' && id && list.indexOf(id) === index;
    });
  }

  function writeHiddenCore(list) {
    writeJson(HIDDEN_CORE_KEY, list);
  }

  function isCoreId(id) {
    return CORE_APPS.some(function (core) { return core.id === String(id); });
  }

  function hideCore(id) {
    var list = hiddenCoreIds();
    if (list.indexOf(String(id)) !== -1) return;
    list.push(String(id));
    writeHiddenCore(list);
  }

  function showCore(id) {
    var list = hiddenCoreIds();
    if (list.indexOf(String(id)) === -1) return;
    writeHiddenCore(list.filter(function (item) { return item !== String(id); }));
  }

  function normalizeUrl(url) {
    var value = String(url || '').trim();
    if (!value) return '';
    /* Query strings and fragments are complete addresses (Play listings), so
       leave them alone instead of appending a directory slash. */
    if (value.indexOf('?') !== -1 || value.indexOf('#') !== -1) return value;
    return value.charAt(value.length - 1) === '/' ? value : value + '/';
  }

  function isExternal(url) {
    return /^https?:/i.test(String(url || ''));
  }

  function normalizeApp(app) {
    if (!app || !app.id) return null;
    return {
      id: String(app.id),
      name: String(app.name || app.id),
      url: normalizeUrl(app.url),
      source: app.source === 'core' ? 'core' : 'store',
      installedAt: app.installedAt || null
    };
  }

  function merge(list) {
    var out = [];
    var seen = {};
    var hidden = hiddenCoreIds();

    (Array.isArray(list) ? list : []).forEach(function (raw) {
      var app = normalizeApp(raw);
      if (!app || seen[app.id]) return;
      seen[app.id] = true;
      out.push(app);
    });

    CORE_APPS.forEach(function (core) {
      if (seen[core.id] || hidden.indexOf(core.id) !== -1) return;
      seen[core.id] = true;
      out.push(normalizeApp({ id: core.id, name: core.name, url: core.url, source: 'core' }));
    });

    return out;
  }

  /* ---------- installed apps ---------- */

  function all() {
    return merge(readJson(APPS_KEY, []));
  }

  function ensureSeeded() {
    var stored = readJson(APPS_KEY, null);
    var list = merge(stored);
    if (!Array.isArray(stored) || stored.length !== list.length) writeJson(APPS_KEY, list);
    return list;
  }

  function isInstalled(id) {
    return all().some(function (app) { return app.id === id; });
  }

  function save(list) {
    writeJson(APPS_KEY, merge(list));
  }

  function post(channelName, message) {
    try {
      if (!('BroadcastChannel' in global)) return false;
      var channel = new BroadcastChannel(channelName);
      channel.postMessage(message);
      channel.close();
      return true;
    } catch (err) {
      return false;
    }
  }

  function add(app) {
    var entry = normalizeApp(app);
    if (!entry) return null;
    var list = all().filter(function (item) { return item.id !== entry.id; });
    entry.installedAt = entry.installedAt || new Date().toISOString();
    list.push(entry);
    /* Installing a core app again is the owner undoing the uninstall, so the id
       has to leave the hidden list before save() merges the list. */
    if (isCoreId(entry.id)) showCore(entry.id);
    save(list);
    post(APPS_CHANNEL, { type: 'APP_INSTALLED', app: entry });
    return entry;
  }

  function remove(id) {
    var list = all().filter(function (item) { return item.id !== String(id); });
    /* Remember a deliberate core uninstall before save() merges core apps
       back in, otherwise the next ensureSeeded() restores it. */
    if (isCoreId(id)) hideCore(id);
    save(list);
    post(APPS_CHANNEL, { type: 'APP_UNINSTALLED', id: String(id) });
    return list;
  }

  /* ---------- caches ---------- */

  function cacheNameFor(app) {
    var id = typeof app === 'string' ? app : app && app.id;
    return 'apex-app-' + id;
  }

  function cacheUrlsFor(app) {
    var base = normalizeUrl(app && app.url);
    /* Only same-origin apps can be cached; pinned Play listings cannot. */
    if (!base || isExternal(base)) return [];
    return CORE_FILES.map(function (file) { return base + file; });
  }

  /* An app's manifest is its proof of identity. A static host that answers
   * unknown paths with the shell's index.html returns HTML with a 200, which
   * must never be stored as an app, so the manifest is checked before a single
   * file goes into the cache. */
  var MANIFEST_FILE = 'manifest.json';

  function manifestIdOf(data) {
    var declared = (data.meta && data.meta.id) || data.id;
    if (declared === undefined || declared === null) return '';
    return String(declared).trim().replace(/\/+$/, '');
  }

  function checkManifest(app, res) {
    if (!res || !res.ok) return Promise.resolve({ ok: false, reason: 'manifest-missing' });
    if (/html/i.test(String(res.headers.get('content-type') || ''))) {
      return Promise.resolve({ ok: false, reason: 'manifest-html' });
    }

    return res.clone().text().then(function (body) {
      /* Fallback HTML is often served as text/plain or with no type at all. */
      if (/^\s*</.test(body)) return { ok: false, reason: 'manifest-html' };

      var data;
      try {
        data = JSON.parse(body);
      } catch (err) {
        return { ok: false, reason: 'manifest-json' };
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { ok: false, reason: 'manifest-json' };
      }
      if (typeof data.name !== 'string' || !data.name.trim()) {
        return { ok: false, reason: 'manifest-name' };
      }
      if (typeof data.start_url !== 'string' && typeof data.scope !== 'string') {
        return { ok: false, reason: 'manifest-scope' };
      }

      var declared = manifestIdOf(data);
      if (declared) {
        var relative = declared.charAt(0) === '.' || declared.charAt(0) === '/';
        var dir = normalizeUrl(app.url).replace(/\/+$/, '');
        /* A bare id is the app's own slug and has to match exactly. A relative
           id ('.', './', './app/') only resolves to the directory it is in, so
           it is a match for this app and nothing else. */
        var matches = relative
          ? (declared === '.' || declared === dir)
          : declared === String(app.id);

        if (!matches) return { ok: false, reason: 'manifest-id' };
      }

      return { ok: true };
    }).catch(function () {
      return { ok: false, reason: 'manifest-unreadable' };
    });
  }

  /* Fetch + store an app's core files. Resolves with a per-file report so the
     caller can say honestly whether the app is now fully offline. `reason`
     says why an install cached nothing. */
  function cacheApp(app) {
    var report = { ok: false, cached: 0, total: 0, missing: [], reason: '' };
    if (!('caches' in global)) return Promise.resolve(report);

    var base = normalizeUrl(app && app.url);
    var urls = cacheUrlsFor(app);
    report.total = urls.length;
    if (!urls.length) return Promise.resolve(report);

    var manifestUrl = base + MANIFEST_FILE;
    var manifestResponse = null;

    return global.fetch(manifestUrl, { cache: 'reload' }).then(function (res) {
      manifestResponse = res;
      return checkManifest(app, res);
    }).catch(function () {
      return { ok: false, reason: 'manifest-missing' };
    }).then(function (check) {
      if (!check.ok) {
        report.reason = check.reason;
        return report;
      }

      return global.caches.open(cacheNameFor(app)).then(function (cache) {
        return Promise.all(urls.map(function (url) {
          var fetched = url === manifestUrl && manifestResponse
            ? Promise.resolve(manifestResponse)
            : global.fetch(url, { cache: 'reload' });

          return fetched.then(function (res) {
            if (!res || !res.ok) {
              report.missing.push(url);
              return false;
            }
            return cache.put(url, res.clone()).then(function () { return true; }).catch(function () {
              report.missing.push(url);
              return false;
            });
          }).catch(function () {
            report.missing.push(url);
            return false;
          });
        })).then(function (results) {
          report.cached = results.filter(Boolean).length;
          report.ok = report.cached > 0;
          return report;
        });
      }).catch(function () {
        return report;
      });
    });
  }

  function dropCache(app) {
    if (!('caches' in global)) return Promise.resolve(false);
    return global.caches.delete(cacheNameFor(app)).catch(function () { return false; });
  }

  /* Install = cache the files, then record it. A cache miss still installs the
     app: it stays reachable online and the store can retry later. */
  function install(app) {
    return cacheApp(app).then(function (report) {
      var entry = add(app);
      return { app: entry, report: report };
    });
  }

  function uninstall(app) {
    var id = typeof app === 'string' ? app : app && app.id;
    return dropCache(id).then(function () {
      remove(id);
      return id;
    });
  }

  /* ---------- config (read-only here; Apex Settings owns writes) ---------- */

  function config() {
    return readJson(CONFIG_KEY, null);
  }

  /* ---------- channels ---------- */

  function onMessage(channelName, handler) {
    if (!('BroadcastChannel' in global)) return function () {};
    var channel;
    try {
      channel = new BroadcastChannel(channelName);
    } catch (err) {
      return function () {};
    }
    channel.addEventListener('message', function (event) {
      handler(event.data || {});
    });
    return function off() {
      try { channel.close(); } catch (err) { /* ignore */ }
    };
  }

  global.ApexRegistry = {
    schema: SCHEMA,
    appsKey: APPS_KEY,
    configKey: CONFIG_KEY,
    appsChannel: APPS_CHANNEL,
    settingsChannel: SETTINGS_CHANNEL,
    coreApps: CORE_APPS.slice(),
    cacheNameFor: cacheNameFor,
    cacheUrlsFor: cacheUrlsFor,
    all: all,
    ensureSeeded: ensureSeeded,
    isInstalled: isInstalled,
    add: add,
    remove: remove,
    install: install,
    uninstall: uninstall,
    cacheApp: cacheApp,
    dropCache: dropCache,
    config: config,
    post: post,
    onMessage: onMessage,
    normalizeUrl: normalizeUrl
  };
})(window);
