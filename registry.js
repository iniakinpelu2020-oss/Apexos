/* ApexOS - shared app registry and sync channel.
 *
 * This file is identical in the Apex shell, Apex Store and Apex Settings so all
 * three agree on storage keys, cache names and message shapes. Zero
 * dependencies, no build step, safe to load standalone or from /apps/<slug>/.
 *
 *   localStorage  apex_installed_apps  - [{ id, name, url, source, installedAt }]
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

    (Array.isArray(list) ? list : []).forEach(function (raw) {
      var app = normalizeApp(raw);
      if (!app || seen[app.id]) return;
      seen[app.id] = true;
      out.push(app);
    });

    CORE_APPS.forEach(function (core) {
      if (seen[core.id]) return;
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
    save(list);
    post(APPS_CHANNEL, { type: 'APP_INSTALLED', app: entry });
    return entry;
  }

  function remove(id) {
    var list = all().filter(function (item) { return item.id !== id; });
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

  /* Fetch + store an app's core files. Resolves with a per-file report so the
     caller can say honestly whether the app is now fully offline. */
  function cacheApp(app) {
    var report = { ok: false, cached: 0, total: 0, missing: [] };
    if (!('caches' in global)) return Promise.resolve(report);

    var urls = cacheUrlsFor(app);
    report.total = urls.length;
    if (!urls.length) return Promise.resolve(report);

    return global.caches.open(cacheNameFor(app)).then(function (cache) {
      return Promise.all(urls.map(function (url) {
        return global.fetch(url, { cache: 'reload' }).then(function (res) {
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
