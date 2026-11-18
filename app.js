(() => {
  'use strict';

  const DB_NAME = 'apexos-db';
  const DB_VERSION = 1;
  const STORE_KV = 'kv';
  const STORE_NOTES = 'notes';
  const STORE_FILES = 'files';

  const DEFAULT_APPS = [
    // Core & AI
    { id: 'apex-ai', name: 'Apex AI', category: 'Core & AI', url: 'https://apex-ai-9ho.pages.dev', icon: '🧠', enabled: true },
    { id: 'apex-studio', name: 'Apex Studio', category: 'Core & AI', url: 'https://apexaicoder.pages.dev', icon: '🎛️', enabled: true },
    { id: 'apex-editor', name: 'Apex Editor', category: 'Core & AI', url: 'https://apexeditor.vercel.app', icon: '📝', enabled: true },
    { id: 'apex-browser', name: 'Apex Browser', category: 'Core & AI', url: '', icon: '🌐', enabled: true },
    { id: 'apex-ai-router', name: 'Apex AI Router', category: 'Core & AI', url: '', icon: '🔀', enabled: true },
    { id: 'apex-shell-bridge', name: 'Apex Shell Bridge', category: 'Core & AI', url: '', icon: '🔗', enabled: true },
    // Productivity & Storage
    { id: 'apex-drive', name: 'Apex Drive', category: 'Productivity & Storage', url: '', icon: '🗂️', enabled: true, builtin: 'drive' },
    { id: 'apex-docs', name: 'Apex Docs', category: 'Productivity & Storage', url: '', icon: '📄', enabled: true },
    { id: 'apex-notes', name: 'Apex Notes', category: 'Productivity & Storage', url: '', icon: '🗒️', enabled: true, builtin: 'notes' },
    { id: 'apex-planner', name: 'Apex Planner', category: 'Productivity & Storage', url: '', icon: '📅', enabled: true },
    { id: 'apex-drop', name: 'Apex Drop', category: 'Productivity & Storage', url: '', icon: '📦', enabled: true },
    { id: 'apex-gallery', name: 'Apex Gallery', category: 'Productivity & Storage', url: '', icon: '🖼️', enabled: true },
    { id: 'apex-archive', name: 'Apex Archive', category: 'Productivity & Storage', url: '', icon: '🗄️', enabled: true },
    { id: 'apex-links', name: 'Apex Links', category: 'Productivity & Storage', url: '', icon: '🔖', enabled: true },
    { id: 'apex-backup', name: 'Apex Backup', category: 'Productivity & Storage', url: '', icon: '💾', enabled: true },
    // Security, Finance & Social
    { id: 'apex-vault', name: 'Apex Vault', category: 'Security, Finance & Social', url: '', icon: '🔐', enabled: true },
    { id: 'apex-shield', name: 'Apex Shield', category: 'Security, Finance & Social', url: '', icon: '🛡️', enabled: true },
    { id: 'apex-sec', name: 'Apex Sec', category: 'Security, Finance & Social', url: '', icon: '🧯', enabled: true },
    { id: 'apex-auth', name: 'Apex Auth', category: 'Security, Finance & Social', url: '', icon: '🪪', enabled: true },
    { id: 'apex-ledger', name: 'Apex Ledger', category: 'Security, Finance & Social', url: '', icon: '📒', enabled: true },
    { id: 'apex-feed', name: 'Apex Feed', category: 'Security, Finance & Social', url: '', icon: '📰', enabled: true },
    { id: 'apex-pulse', name: 'Apex Pulse', category: 'Security, Finance & Social', url: '', icon: '📈', enabled: true },
    // System
    { id: 'apex-settings', name: 'Apex Settings', category: 'System', url: '', icon: '⚙️', enabled: true, builtin: 'settings', system: true }
  ];

  const DOCK_APP_IDS = ['apex-ai', 'apex-notes', 'apex-drive', 'apex-settings'];
  const HOME_APP_IDS = ['apex-ai', 'apex-notes', 'apex-drive', 'apex-editor', 'apex-studio', 'apex-settings', 'apex-browser', 'apex-vault'];

  const state = {
    db: null,
    apps: [],
    settings: {
      uiModeOverride: null,
      agentPrimary: { endpoint: 'https://apex-ai-router.pages.dev/v1/chat/completions', apiKey: '', model: 'openai/gpt-4o-mini' },
      agentFallback: { endpoint: 'https://api.groq.com/openai/v1/chat/completions', apiKey: '', model: 'llama-3.1-8b-instant' }
    },
    mode: 'desktop',
    z: 20,
    windows: new Map(), // appId -> {el, minimized, maximized, prevRect}
    openOrder: [],
    recents: [],
    activeMobileAppId: null,
    mobileHistory: []
  };

  // ---------- Utilities ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  const fmtBytes = (n) => {
    if (!Number.isFinite(n)) return '--';
    const units = ['B','KB','MB','GB','TB'];
    let i = 0, v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  };

  function toast(msg) {
    const c = $('#toast-container');
    if (!c) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function confirmDialog(message) {
    return new Promise(resolve => {
      const overlay = $('#confirm-overlay');
      $('#confirm-message').textContent = message;
      overlay.classList.remove('hidden');
      const cleanup = (val) => {
        overlay.classList.add('hidden');
        ok.removeEventListener('click', onOk);
        cancel.removeEventListener('click', onCancel);
        resolve(val);
      };
      const onOk = () => cleanup(true);
      const onCancel = () => cleanup(false);
      const ok = $('#confirm-ok');
      const cancel = $('#confirm-cancel');
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
    });
  }

  // ---------- IndexedDB ----------
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(STORE_NOTES)) {
          const ns = db.createObjectStore(STORE_NOTES, { keyPath: 'id' });
          ns.createIndex('title', 'title', { unique: false });
          ns.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_FILES)) {
          const fs = db.createObjectStore(STORE_FILES, { keyPath: 'id' });
          fs.createIndex('name', 'name', { unique: false });
          fs.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function dbTx(store, mode = 'readonly') {
    const tx = state.db.transaction(store, mode);
    return { tx, store: tx.objectStore(store) };
  }
  function reqToPromise(req) { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); }

  async function kvGet(key, fallback = null) {
    try {
      const { store } = dbTx(STORE_KV);
      const row = await reqToPromise(store.get(key));
      return row ? row.value : fallback;
    } catch { return fallback; }
  }
  async function kvSet(key, value) {
    const { store, tx } = dbTx(STORE_KV, 'readwrite');
    store.put({ key, value });
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }

  async function getAll(storeName) {
    const { store } = dbTx(storeName);
    return await reqToPromise(store.getAll());
  }
  async function putItem(storeName, item) {
    const { store, tx } = dbTx(storeName, 'readwrite');
    store.put(item);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }
  async function deleteItem(storeName, id) {
    const { store, tx } = dbTx(storeName, 'readwrite');
    store.delete(id);
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }

  // ---------- App Registry & Settings ----------
  function mergeApps(saved) {
    const byId = new Map((saved || []).map(a => [a.id, a]));
    const merged = DEFAULT_APPS.map(def => ({ ...def, ...(byId.get(def.id) || {}), name: def.name, category: def.category, icon: def.icon, builtin: def.builtin, system: def.system }));
    // include any custom apps saved (future-proof)
    (saved || []).forEach(a => { if (!merged.find(m => m.id === a.id)) merged.push(a); });
    return merged;
  }

  function getApp(id) { return state.apps.find(a => a.id === id); }
  function enabledApps() { return state.apps.filter(a => a.enabled !== false); }
  function categoryOrder() { return ['Core & AI', 'Productivity & Storage', 'Security, Finance & Social', 'System']; }

  async function loadState() {
    const savedApps = await kvGet('apps', null);
    const savedSettings = await kvGet('settings', null);
    const localApps = !savedApps ? tryParse(localStorage.getItem('apexos.apps')) : null;
    const localSettings = !savedSettings ? tryParse(localStorage.getItem('apexos.settings')) : null;
    state.apps = mergeApps(savedApps || localApps || DEFAULT_APPS);
    if (savedSettings || localSettings) {
      state.settings = deepMerge(structuredCloneSafe(state.settings), savedSettings || localSettings || {});
    }
    const override = state.settings.uiModeOverride || localStorage.getItem('apexos.uiModeOverride');
    if (override === 'desktop' || override === 'mobile') state.settings.uiModeOverride = override;
  }
  async function saveApps() {
    await kvSet('apps', state.apps);
    try { localStorage.setItem('apexos.apps', JSON.stringify(state.apps)); } catch {}
  }
  async function saveSettings() {
    await kvSet('settings', state.settings);
    try { localStorage.setItem('apexos.settings', JSON.stringify(state.settings)); } catch {}
  }
  function tryParse(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }
  function deepMerge(base, extra) {
    for (const k of Object.keys(extra || {})) {
      if (extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k])) base[k] = deepMerge(base[k] || {}, extra[k]);
      else base[k] = extra[k];
    }
    return base;
  }
  function structuredCloneSafe(v) { return JSON.parse(JSON.stringify(v)); }

  // ---------- Mode & Status Bar ----------
  function detectAutoMode() {
    const small = window.innerWidth <= 768;
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (small) return 'mobile';
    if (coarse && window.innerWidth <= 900) return 'mobile';
    return 'desktop';
  }
  function applyMode(mode, persist = false) {
    state.mode = mode === 'mobile' ? 'mobile' : 'desktop';
    const root = $('#os-root');
    root.classList.toggle('mode-mobile', state.mode === 'mobile');
    root.classList.toggle('mode-desktop', state.mode === 'desktop');
    $('#mode-toggle').textContent = `Mode: ${state.mode === 'mobile' ? 'Android' : 'Desktop'}`;
    if (persist) {
      state.settings.uiModeOverride = state.mode;
      saveSettings();
      try { localStorage.setItem('apexos.uiModeOverride', state.mode); } catch {}
    }
    // close overlays that don't fit
    if (state.mode === 'desktop') {
      closeAppDrawer();
      $('#recents-view').classList.add('hidden');
      $('#mobile-app-view').classList.add('hidden');
      state.activeMobileAppId = null;
    } else {
      // in mobile, keep windows concept but UI is full-screen; show active app if any
      if (state.activeMobileAppId) openMobileApp(state.activeMobileAppId);
    }
    renderAll();
  }
  function toggleMode() { applyMode(state.mode === 'desktop' ? 'mobile' : 'desktop', true); }

  function updateClock() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    $('#status-clock').textContent = `${hh}:${mm}`;
  }
  function updateNetworkBadge() {
    const el = $('#status-network');
    const online = navigator.onLine;
    el.textContent = online ? 'Online' : 'Offline';
    el.classList.toggle('online', online);
    el.classList.toggle('offline', !online);
    if (window.ApexAgent && window.ApexAgent.updateModeIndicator) window.ApexAgent.updateModeIndicator();
  }
  async function updateStorageBadge() {
    const el = $('#status-storage');
    if (!navigator.storage || !navigator.storage.estimate) { el.textContent = 'Storage: n/a'; return; }
    try {
      const est = await navigator.storage.estimate();
      const quota = est.quota || 0;
      const usage = est.usage || 0;
      const remaining = Math.max(quota - usage, 0);
      const compact = state.mode === 'mobile';
      el.textContent = compact ? `Free: ${fmtBytes(remaining)}` : `Storage: ${fmtBytes(remaining)} free`;
      el.title = `Offline storage: ${fmtBytes(usage)} used / ${fmtBytes(quota)} quota (${fmtBytes(remaining)} remaining)`;
    } catch { el.textContent = 'Storage: --'; }
  }

  // ---------- Rendering (Desktop & Mobile launchers) ----------
  function renderDesktopIcons() {
    const c = $('#desktop-icons');
    c.innerHTML = '';
    enabledApps().filter(a => a.id !== 'apex-settings').slice(0, 18).forEach(app => {
      const b = document.createElement('button');
      b.className = 'desktop-icon';
      b.innerHTML = `<div class="app-glyph">${escapeHtml(app.icon || '⬛')}</div><div class="app-label">${escapeHtml(app.name)}</div>`;
      b.onclick = () => launchApp(app.id);
      c.appendChild(b);
    });
  }
  function renderDock() {
    const dock = $('#dock');
    dock.innerHTML = '';
    const ids = [...DOCK_APP_IDS, 'apex-agent'];
    ids.forEach(id => {
      if (id === 'apex-agent') {
        const b = document.createElement('button');
        b.className = 'dock-item';
        b.title = 'Apex Agent';
        b.textContent = '🤖';
        b.onclick = () => toggleAgent(true);
        dock.appendChild(b);
        return;
      }
      const app = getApp(id);
      if (!app || app.enabled === false) return;
      const b = document.createElement('button');
      b.className = 'dock-item' + (state.windows.has(id) ? ' running' : '');
      b.title = app.name;
      b.textContent = app.icon || '⬛';
      b.onclick = () => launchApp(id);
      dock.appendChild(b);
    });
  }
  function renderMobileHome() {
    const grid = $('#mobile-home-grid');
    grid.innerHTML = '';
    const apps = enabledApps().filter(a => HOME_APP_IDS.includes(a.id));
    // ensure settings present
    if (!apps.find(a => a.id === 'apex-settings')) { const s = getApp('apex-settings'); if (s) apps.push(s); }
    apps.forEach(app => grid.appendChild(makeAppTile(app, () => launchApp(app.id))));
  }
  function renderDrawer() {
    const c = $('#drawer-content');
    c.innerHTML = '';
    const groups = {};
    enabledApps().forEach(app => { (groups[app.category || 'Other'] = groups[app.category || 'Other'] || []).push(app); });
    categoryOrder().concat(Object.keys(groups).filter(k => !categoryOrder().includes(k))).forEach(cat => {
      const list = groups[cat];
      if (!list || !list.length) return;
      const section = document.createElement('div');
      section.className = 'drawer-group';
      section.innerHTML = `<h3>${escapeHtml(cat)}</h3>`;
      const grid = document.createElement('div');
      grid.className = 'drawer-grid';
      list.forEach(app => grid.appendChild(makeAppTile(app, () => { closeAppDrawer(); launchApp(app.id); })));
      section.appendChild(grid);
      c.appendChild(section);
    });
  }
  function makeAppTile(app, onClick) {
    const b = document.createElement('button');
    b.className = 'app-tile';
    b.innerHTML = `<div class="app-glyph">${escapeHtml(app.icon || '⬛')}</div><div class="app-label">${escapeHtml(app.name)}</div>`;
    b.onclick = onClick;
    return b;
  }
  function renderAll() {
    renderDesktopIcons();
    renderDock();
    renderMobileHome();
    renderDrawer();
    renderRecents();
    updateStorageBadge();
  }

  // ---------- Window Manager (Desktop) ----------
  function bringToFront(appId) {
    const w = state.windows.get(appId);
    if (!w) return;
    state.z += 1;
    w.el.style.zIndex = state.z;
    $$('.window').forEach(el => el.classList.remove('focused'));
    w.el.classList.add('focused');
  }
  function createWindow(app) {
    const layer = $('#windows-layer');
    const el = document.createElement('section');
    el.className = 'window';
    const offset = (state.windows.size % 8) * 26;
    el.style.left = (60 + offset) + 'px';
    el.style.top = (40 + offset) + 'px';
    el.style.width = Math.min(860, window.innerWidth - 120) + 'px';
    el.style.height = Math.min(560, window.innerHeight - 220) + 'px';
    el.style.zIndex = (++state.z);
    el.dataset.appId = app.id;
    el.innerHTML = `
      <div class="window-titlebar">
        <div class="window-title">${escapeHtml(app.icon || '')} ${escapeHtml(app.name)}</div>
        <div class="window-controls">
          <button class="win-btn min" title="Minimize">—</button>
          <button class="win-btn max" title="Maximize">▢</button>
          <button class="win-btn close" title="Close">✕</button>
        </div>
      </div>
      <div class="window-body"></div>
      <div class="window-resize" title="Resize"></div>`;
    layer.appendChild(el);

    const info = { el, minimized: false, maximized: false, prevRect: null, appId: app.id };
    state.windows.set(app.id, info);

    el.addEventListener('mousedown', () => bringToFront(app.id));
    $('.win-btn.close', el).onclick = (e) => { e.stopPropagation(); closeApp(app.id); };
    $('.win-btn.min', el).onclick = (e) => { e.stopPropagation(); minimizeApp(app.id); };
    $('.win-btn.max', el).onclick = (e) => { e.stopPropagation(); toggleMaximize(app.id); };

    makeDraggable(el, $('.window-titlebar', el), app.id);
    makeResizable(el, $('.window-resize', el), app.id);

    renderWindowContent(app, $('.window-body', el));
    bringToFront(app.id);
    renderDock();
    return info;
  }

  function minimizeApp(appId) {
    const w = state.windows.get(appId);
    if (!w) return;
    w.minimized = true;
    w.el.classList.add('minimized');
  }
  function restoreApp(appId) {
    const w = state.windows.get(appId);
    if (!w) return;
    w.minimized = false;
    w.el.classList.remove('minimized');
    bringToFront(appId);
  }
  function toggleMaximize(appId) {
    const w = state.windows.get(appId); if (!w) return;
    if (!w.maximized) {
      w.prevRect = { left: w.el.style.left, top: w.el.style.top, width: w.el.style.width, height: w.el.style.height };
      w.el.classList.add('maximized');
      w.maximized = true;
    } else {
      w.el.classList.remove('maximized');
      w.maximized = false;
      if (w.prevRect) Object.assign(w.el.style, w.prevRect);
    }
  }

  function makeDraggable(winEl, handle, appId) {
    let start = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.window-controls')) return;
      const w = state.windows.get(appId);
      if (!w || w.maximized) return;
      bringToFront(appId);
      start = { x: e.clientX, y: e.clientY, left: winEl.offsetLeft, top: winEl.offsetTop };
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      const maxLeft = window.innerWidth - 80;
      const maxTop = window.innerHeight - 120;
      winEl.style.left = Math.max(0, Math.min(maxLeft, start.left + dx)) + 'px';
      winEl.style.top = Math.max(0, Math.min(maxTop, start.top + dy)) + 'px';
    });
    handle.addEventListener('pointerup', () => start = null);
    handle.addEventListener('pointercancel', () => start = null);
  }
  function makeResizable(winEl, handle, appId) {
    let start = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const w = state.windows.get(appId);
      if (!w || w.maximized) return;
      bringToFront(appId);
      start = { x: e.clientX, y: e.clientY, w: winEl.offsetWidth, h: winEl.offsetHeight };
      handle.setPointerCapture(e.pointerId);
      e.stopPropagation();
    });
    handle.addEventListener('pointermove', (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      winEl.style.width = Math.max(280, start.w + dx) + 'px';
      winEl.style.height = Math.max(180, start.h + dy) + 'px';
    });
    handle.addEventListener('pointerup', () => start = null);
    handle.addEventListener('pointercancel', () => start = null);
  }

  // ---------- App content / loading ----------
  function markRecent(appId) {
    state.recents = [appId, ...state.recents.filter(id => id !== appId)].slice(0, 12);
  }

  function renderWindowContent(app, container) {
    container.innerHTML = '';
    if (app.builtin === 'notes') { renderNotesApp(container); return; }
    if (app.builtin === 'drive') { renderDriveApp(container); return; }
    if (app.builtin === 'settings') { renderSettingsApp(container); return; }
    renderExternalOrCard(app, container);
  }

  function renderExternalOrCard(app, container, opts = {}) {
    const url = (app.url || '').trim();
    if (!url) {
      container.innerHTML = offlineSetupCardHtml(app, 'not-configured');
      bindOfflineCard(container, app);
      return;
    }
    if (!navigator.onLine) {
      container.innerHTML = offlineSetupCardHtml(app, 'offline');
      bindOfflineCard(container, app);
      return;
    }
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;inset:0;';
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.title = app.name;
    iframe.setAttribute('loading', 'eager');
    iframe.referrerPolicy = 'no-referrer';
    // sandbox relaxed enough for apps but still safer; allow-same-origin+scripts needed for most
    iframe.sandbox = 'allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-same-origin';
    let settled = false;
    const fallbackTimer = setTimeout(() => {
      if (settled) return;
      // Can't reliably detect cross-origin failure; show a non-destructive notice overlay option? Keep iframe but also allow user to see setup
      // However requirement states "fails to load when offline, display..." - offline handled. For slow loads keep iframe.
    }, 12000);
    iframe.addEventListener('load', () => { settled = true; clearTimeout(fallbackTimer); });
    iframe.addEventListener('error', () => {
      settled = true; clearTimeout(fallbackTimer);
      container.innerHTML = offlineSetupCardHtml(app, 'error');
      bindOfflineCard(container, app);
    });
    wrap.appendChild(iframe);
    container.appendChild(wrap);
    // Add a small corner setup link
    const corner = document.createElement('button');
    corner.className = 'secondary-btn';
    corner.textContent = '⚙ URL';
    corner.title = 'Configure app URL';
    corner.style.cssText = 'position:absolute;top:8px;right:8px;z-index:2;padding:4px 8px;font-size:12px;opacity:.85';
    corner.onclick = () => openSettingsForApp(app.id);
    container.appendChild(corner);
  }

  function offlineSetupCardHtml(app, reason) {
    const titles = {
      'not-configured': 'App URL not configured yet',
      'offline': 'You are offline',
      'error': 'Could not load this app'
    };
    const msgs = {
      'not-configured': `${escapeHtml(app.name)} does not have a deployed URL configured. Set it in Apex Settings to launch it in ApexOS.`,
      'offline': `${escapeHtml(app.name)} needs a network connection and no offline fallback is available. Reconnect or configure a local/built-in alternative in Apex Settings.`,
      'error': `${escapeHtml(app.name)} could not be loaded right now. Check its URL in Apex Settings or try again when online.`
    };
    return `<div class="offline-card-wrap"><div class="card offline-card">
      <div class="big">${escapeHtml(app.icon || '📦')}</div>
      <h3>${titles[reason] || 'Unavailable'}</h3>
      <p>${msgs[reason] || ''}</p>
      <div class="row" style="justify-content:center;margin-top:12px;">
        <button class="primary-btn" data-action="open-settings">Set deployed URL in Apex Settings</button>
        ${app.url ? `<button class="secondary-btn" data-action="retry">Retry</button>` : ''}
      </div>
      ${app.url ? `<p class="muted" style="margin-top:10px;font-size:12px;word-break:break-all;">Configured URL: ${escapeHtml(app.url)}</p>` : ''}
    </div></div>`;
  }
  function bindOfflineCard(container, app) {
    const settingsBtn = $('[data-action="open-settings"]', container);
    if (settingsBtn) settingsBtn.onclick = () => openSettingsForApp(app.id);
    const retry = $('[data-action="retry"]', container);
    if (retry) retry.onclick = () => {
      container.innerHTML = '';
      renderExternalOrCard(getApp(app.id) || app, container);
    };
  }

  function openSettingsForApp(appId) {
    launchApp('apex-settings');
    // focus app in settings after render
    setTimeout(() => {
      const input = document.querySelector(`[data-settings-app="${CSS.escape(appId)}"] input[data-field="url"]`);
      if (input) { input.focus(); input.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    }, 60);
  }

  // ---------- Built-in Notes ----------
  async function renderNotesApp(container) {
    container.innerHTML = `<div class="app-surface" id="notes-app">
      <div class="row" style="justify-content:space-between; margin-bottom:10px;">
        <h3 style="margin:0;">Apex Notes</h3>
        <button class="primary-btn" id="notes-new">New Note</button>
      </div>
      <div class="card stack" id="notes-editor">
        <input type="hidden" id="note-id">
        <div><label>Title</label><input id="note-title" type="text" placeholder="Note title"></div>
        <div><label>Body</label><textarea id="note-body" placeholder="Write your note..."></textarea></div>
        <div class="row"><button class="primary-btn" id="note-save">Save Note</button><button class="secondary-btn" id="note-clear">Clear</button></div>
      </div>
      <div class="list" id="notes-list"></div>
    </div>`;
    const refresh = async () => {
      const notes = (await getAll(STORE_NOTES)).sort((a,b) => (b.updatedAt||0)-(a.updatedAt||0));
      const list = $('#notes-list', container);
      if (!notes.length) { list.innerHTML = `<div class="empty">No notes yet. Create one above (stored offline in IndexedDB).</div>`; return; }
      list.innerHTML = notes.map(n => `<div class="list-item">
        <div style="min-width:0">
          <div style="font-weight:600;">${escapeHtml(n.title || 'Untitled')}</div>
          <div class="muted" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px;">${escapeHtml((n.body||'').slice(0,120))}</div>
        </div>
        <div class="row">
          <button class="secondary-btn" data-edit="${n.id}">Edit</button>
          <button class="danger-btn" data-del="${n.id}">Delete</button>
        </div></div>`).join('');
      $$('[data-edit]', list).forEach(b => b.onclick = async () => {
        const note = notes.find(x => x.id === b.dataset.edit); if (!note) return;
        $('#note-id', container).value = note.id;
        $('#note-title', container).value = note.title || '';
        $('#note-body', container).value = note.body || '';
      });
      $$('[data-del]', list).forEach(b => b.onclick = async () => {
        if (!(await confirmDialog('Delete this note?'))) return;
        await deleteItem(STORE_NOTES, b.dataset.del);
        toast('Note deleted');
        await refresh();
        await updateStorageBadge();
      });
    };
    $('#note-save', container).onclick = async () => {
      const title = $('#note-title', container).value.trim();
      const body = $('#note-body', container).value;
      if (!title && !body.trim()) { toast('Note is empty'); return; }
      const id = $('#note-id', container).value || uid();
      await putItem(STORE_NOTES, { id, title: title || 'Untitled', body, updatedAt: Date.now(), createdAt: Date.now() });
      $('#note-id', container).value = id;
      toast('Note saved offline');
      await refresh();
      await updateStorageBadge();
    };
    $('#note-clear', container).onclick = () => { $('#note-id', container).value=''; $('#note-title', container).value=''; $('#note-body', container).value=''; };
    $('#notes-new', container).onclick = () => $('#note-clear', container).click();
    await refresh();
  }

  async function saveNote(title, body) {
    title = String(title || '').trim() || 'Untitled';
    body = String(body || '');
    const notes = await getAll(STORE_NOTES);
    let existing = notes.find(n => (n.title || '').toLowerCase() === title.toLowerCase());
    const item = existing ? { ...existing, title, body, updatedAt: Date.now() } : { id: uid(), title, body, createdAt: Date.now(), updatedAt: Date.now() };
    await putItem(STORE_NOTES, item);
    refreshBuiltinViews();
    await updateStorageBadge();
    return { id: item.id, title: item.title, updated: !!existing };
  }

  // ---------- Built-in Drive ----------
  async function renderDriveApp(container) {
    container.innerHTML = `<div class="app-surface" id="drive-app">
      <div class="row" style="justify-content:space-between; margin-bottom:10px;">
        <h3 style="margin:0;">Apex Drive</h3>
        <span class="pill">Offline local file manager</span>
      </div>
      <div class="card stack">
        <h4 style="margin:0;">Add file</h4>
        <input id="drive-file-input" type="file" multiple>
        <div><label>Or create text file</label><input id="drive-text-name" type="text" placeholder="filename.txt"></div>
        <textarea id="drive-text-content" placeholder="Text content..." style="min-height:90px;"></textarea>
        <div><button class="primary-btn" id="drive-save-text">Save Text File</button></div>
      </div>
      <div class="card">
        <h4 style="margin:0 0 8px;">Stored files & notes</h4>
        <div class="list" id="drive-list"></div>
      </div>
    </div>`;
    const refresh = async () => {
      const list = $('#drive-list', container);
      const items = await listFiles();
      if (!items.length) { list.innerHTML = `<div class="empty">No files or notes stored yet. Add files above or save notes in Apex Notes.</div>`; return; }
      list.innerHTML = items.map(f => `<div class="list-item">
        <div style="min-width:0">
          <div style="font-weight:600;">${escapeHtml(f.name)} <span class="pill">${escapeHtml(f.kind)}</span></div>
          <div class="muted" style="font-size:12px;">${escapeHtml(f.sizeLabel || '')} ${f.updatedAt ? '· ' + new Date(f.updatedAt).toLocaleString() : ''}</div>
        </div>
        <div class="row">
          ${f.kind === 'file' ? `<button class="secondary-btn" data-dl="${f.id}">Download</button>` : ''}
          ${f.kind === 'note' ? `<button class="secondary-btn" data-open-note="${f.id}">Open</button>` : ''}
          <button class="danger-btn" data-del="${f.id}" data-kind="${f.kind}">Delete</button>
        </div></div>`).join('');
      $$('[data-dl]', list).forEach(b => b.onclick = async () => downloadFile(b.dataset.dl));
      $$('[data-open-note]', list).forEach(b => b.onclick = () => launchApp('apex-notes'));
      $$('[data-del]', list).forEach(b => b.onclick = async () => {
        const ok = await confirmDialog(`Delete this ${b.dataset.kind}?`);
        if (!ok) return;
        await deleteStoredItem(b.dataset.id, b.dataset.kind);
        toast('Deleted');
        await refresh();
        await updateStorageBadge();
      });
    };

    $('#drive-file-input', container).onchange = async (e) => {
      const files = Array.from(e.target.files || []);
      for (const f of files) {
        const dataUrl = await readAsDataURL(f);
        await putItem(STORE_FILES, { id: uid(), name: f.name, type: f.type || 'application/octet-stream', size: f.size, dataUrl, createdAt: Date.now(), updatedAt: Date.now() });
      }
      if (files.length) toast(`${files.length} file(s) saved offline`);
      e.target.value = '';
      await refresh();
      await updateStorageBadge();
    };
    $('#drive-save-text', container).onclick = async () => {
      const name = ($('#drive-text-name', container).value || '').trim() || `text-${Date.now()}.txt`;
      const content = $('#drive-text-content', container).value || '';
      const blob = new Blob([content], { type: 'text/plain' });
      await putItem(STORE_FILES, { id: uid(), name, type: 'text/plain', size: blob.size, text: content, createdAt: Date.now(), updatedAt: Date.now() });
      $('#drive-text-name', container).value = '';
      $('#drive-text-content', container).value = '';
      toast('Text file saved offline');
      await refresh();
      await updateStorageBadge();
    };
    await refresh();
  }

  function readAsDataURL(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  }
  async function downloadFile(id) {
    const files = await getAll(STORE_FILES);
    const f = files.find(x => x.id === id); if (!f) return;
    const a = document.createElement('a');
    a.download = f.name || 'file';
    if (f.dataUrl) a.href = f.dataUrl;
    else a.href = URL.createObjectURL(new Blob([f.text || ''], { type: f.type || 'text/plain' }));
    a.click();
    setTimeout(() => { if (a.href.startsWith('blob:')) URL.revokeObjectURL(a.href); }, 1000);
  }
  async function deleteStoredItem(id, kind) {
    if (kind === 'note') await deleteItem(STORE_NOTES, id);
    else await deleteItem(STORE_FILES, id);
  }
  async function listFiles() {
    const files = (await getAll(STORE_FILES)).map(f => ({ id: f.id, name: f.name, kind: 'file', size: f.size, sizeLabel: fmtBytes(f.size || 0), updatedAt: f.updatedAt, type: f.type }));
    const notes = (await getAll(STORE_NOTES)).map(n => ({ id: n.id, name: n.title || 'Untitled', kind: 'note', size: (n.body||'').length, sizeLabel: `${(n.body||'').length} chars`, updatedAt: n.updatedAt }));
    return [...files, ...notes].sort((a,b) => (b.updatedAt||0)-(a.updatedAt||0));
  }

  // ---------- Settings ----------
  async function renderSettingsApp(container, focusAppId = null) {
    const categories = {};
    state.apps.forEach(a => { (categories[a.category || 'Other'] = categories[a.category || 'Other'] || []).push(a); });
    container.innerHTML = `<div class="app-surface" id="settings-app">
      <h3 style="margin:0 0 10px;">Apex Settings</h3>
      <div class="card stack">
        <h4 style="margin:0;">Agent (Online / OpenAI-compatible)</h4>
        <div class="muted" style="font-size:13px;">Configure primary and fallback providers. On HTTP 429 the agent tries the fallback; when offline it uses the local deterministic parser.</div>
        <div class="stack" style="margin-top:6px;">
          <div><label>Primary endpoint</label><input id="agent-primary-endpoint" type="url" value="${escapeHtml(state.settings.agentPrimary.endpoint || '')}" placeholder="https://.../v1/chat/completions"></div>
          <div><label>Primary API key</label><input id="agent-primary-key" type="password" value="${escapeHtml(state.settings.agentPrimary.apiKey || '')}" placeholder="API key (stored locally)"></div>
          <div><label>Primary model</label><input id="agent-primary-model" type="text" value="${escapeHtml(state.settings.agentPrimary.model || '')}" placeholder="model id"></div>
          <hr class="sep">
          <div><label>Fallback endpoint</label><input id="agent-fallback-endpoint" type="url" value="${escapeHtml(state.settings.agentFallback.endpoint || '')}" placeholder="https://api.groq.com/openai/v1/chat/completions"></div>
          <div><label>Fallback API key</label><input id="agent-fallback-key" type="password" value="${escapeHtml(state.settings.agentFallback.apiKey || '')}" placeholder="Fallback API key"></div>
          <div><label>Fallback model</label><input id="agent-fallback-model" type="text" value="${escapeHtml(state.settings.agentFallback.model || '')}" placeholder="fallback model"></div>
          <div><button class="primary-btn" id="save-agent-settings">Save Agent Settings</button></div>
        </div>
      </div>
      <div class="card">
        <h4 style="margin:0 0 8px;">Apex Ecosystem App Registry</h4>
        <div class="muted" style="font-size:13px; margin-bottom:8px;">Edit deployed URLs and toggle apps. Saved to IndexedDB/localStorage.</div>
        <div id="settings-app-registry"></div>
        <div style="margin-top:10px;"><button class="primary-btn" id="save-registry">Save App Registry</button></div>
      </div>
    </div>`;

    const reg = $('#settings-app-registry', container);
    categoryOrder().concat(Object.keys(categories).filter(k => !categoryOrder().includes(k))).forEach(cat => {
      const list = categories[cat]; if (!list) return;
      const wrap = document.createElement('div');
      wrap.className = 'stack';
      wrap.style.marginBottom = '14px';
      wrap.innerHTML = `<h4 style="margin:4px 0 6px; color:var(--muted);">${escapeHtml(cat)}</h4>`;
      list.forEach(app => {
        const row = document.createElement('div');
        row.className = 'card';
        row.style.margin = '0';
        row.dataset.settingsApp = app.id;
        row.innerHTML = `<div class="row" style="justify-content:space-between; margin-bottom:6px;">
            <div style="font-weight:600;">${escapeHtml(app.icon || '')} ${escapeHtml(app.name)} <span class="pill">${escapeHtml(app.id)}</span></div>
            <label style="display:flex;align-items:center;gap:6px;margin:0;color:var(--text);"><input type="checkbox" data-field="enabled" ${app.enabled !== false ? 'checked' : ''}> Enabled</label>
          </div>
          ${app.builtin ? `<div class="muted" style="font-size:12px;margin-bottom:6px;">Built-in offline app${app.url ? ' (external URL optional)' : ''}</div>` : ''}
          <label>Deployed URL</label>
          <input type="url" data-field="url" value="${escapeHtml(app.url || '')}" placeholder="https://...">`;
        wrap.appendChild(row);
      });
      reg.appendChild(wrap);
    });

    $('#save-agent-settings', container).onclick = async () => {
      state.settings.agentPrimary = {
        endpoint: $('#agent-primary-endpoint', container).value.trim(),
        apiKey: $('#agent-primary-key', container).value,
        model: $('#agent-primary-model', container).value.trim()
      };
      state.settings.agentFallback = {
        endpoint: $('#agent-fallback-endpoint', container).value.trim(),
        apiKey: $('#agent-fallback-key', container).value,
        model: $('#agent-fallback-model', container).value.trim()
      };
      await saveSettings();
      toast('Agent settings saved');
      if (window.ApexAgent && window.ApexAgent.updateModeIndicator) window.ApexAgent.updateModeIndicator();
    };
    $('#save-registry', container).onclick = async () => {
      $$('[data-settings-app]', container).forEach(row => {
        const app = getApp(row.dataset.settingsApp); if (!app) return;
        app.url = $('[data-field="url"]', row).value.trim();
        app.enabled = $('[data-field="enabled"]', row).checked;
      });
      await saveApps();
      renderAll();
      toast('App registry saved');
    };

    if (focusAppId) {
      const target = container.querySelector(`[data-settings-app="${CSS.escape(focusAppId)}"]`);
      if (target) target.scrollIntoView({ block: 'center' });
    }
  }

  function refreshBuiltinViews() {
    // re-render open builtin windows/mobile content if visible
    state.windows.forEach((w, id) => {
      const app = getApp(id);
      if (app && app.builtin) renderWindowContent(app, $('.window-body', w.el));
    });
    if (state.mode === 'mobile' && state.activeMobileAppId) {
      const app = getApp(state.activeMobileAppId);
      if (app && app.builtin) renderWindowContent(app, $('#mobile-app-content'));
    }
  }

  // ---------- Launch / Close (Desktop & Mobile) ----------
  function launchApp(appId) {
    const app = getApp(appId);
    if (!app) { toast(`Unknown app: ${appId}`); return false; }
    if (app.enabled === false && !app.system) { toast(`${app.name} is disabled in Apex Settings`); return false; }
    markRecent(appId);
    if (state.mode === 'mobile') openMobileApp(appId);
    else openDesktopApp(appId);
    renderDock();
    renderRecents();
    return true;
  }

  function openDesktopApp(appId) {
    const app = getApp(appId);
    const existing = state.windows.get(appId);
    if (existing) {
      restoreApp(appId);
      // refresh external content state? keep as-is except builtins
      bringToFront(appId);
      return;
    }
    createWindow(app);
  }

  function openMobileApp(appId) {
    const app = getApp(appId);
    state.activeMobileAppId = appId;
    state.mobileHistory.push(appId);
    $('#mobile-app-title').textContent = app.name;
    const content = $('#mobile-app-content');
    content.innerHTML = '';
    renderWindowContent(app, content);
    $('#mobile-app-view').classList.remove('hidden');
    closeAppDrawer();
    $('#recents-view').classList.add('hidden');
  }

  function closeApp(appId) {
    const w = state.windows.get(appId);
    if (w) {
      w.el.remove();
      state.windows.delete(appId);
    }
    if (state.activeMobileAppId === appId) {
      state.activeMobileAppId = null;
      $('#mobile-app-view').classList.add('hidden');
      state.mobileHistory = state.mobileHistory.filter(id => id !== appId);
    }
    renderDock();
    renderRecents();
    return true;
  }

  function closeActiveMobileApp() {
    if (state.activeMobileAppId) closeApp(state.activeMobileAppId);
    else $('#recents-view').classList.add('hidden');
  }

  // ---------- Mobile drawer / recents / nav ----------
  function openAppDrawer() { const d = $('#app-drawer'); d.classList.add('open'); d.setAttribute('aria-hidden', 'false'); }
  function closeAppDrawer() { const d = $('#app-drawer'); d.classList.remove('open'); d.setAttribute('aria-hidden', 'true'); }
  function toggleAppDrawer() { $('#app-drawer').classList.contains('open') ? closeAppDrawer() : openAppDrawer(); }

  function renderRecents() {
    const list = $('#recents-list'); if (!list) return;
    const items = state.recents.map(id => getApp(id)).filter(Boolean);
    if (!items.length) { list.innerHTML = `<div class="empty">No recent apps yet.</div>`; return; }
    list.innerHTML = items.map(app => `<div class="recent-card">
      <div class="meta"><div class="app-glyph" style="width:36px;height:36px;font-size:18px;">${escapeHtml(app.icon || '⬛')}</div><div><div style="font-weight:600;">${escapeHtml(app.name)}</div><div class="muted" style="font-size:12px;">${escapeHtml(app.category || '')}</div></div></div>
      <div class="row"><button class="secondary-btn" data-open="${app.id}">Open</button><button class="danger-btn" data-close="${app.id}">Close</button></div>
    </div>`).join('');
    $$('[data-open]', list).forEach(b => b.onclick = () => { $('#recents-view').classList.add('hidden'); launchApp(b.dataset.open); });
    $$('[data-close]', list).forEach(b => b.onclick = () => { closeApp(b.dataset.close); renderRecents(); });
  }
  function showRecents() { renderRecents(); $('#recents-view').classList.remove('hidden'); closeAppDrawer(); }
  function hideRecents() { $('#recents-view').classList.add('hidden'); }

  // Swipe-up detection (mobile home)
  function setupSwipeDrawer() {
    const home = $('#mobile-home');
    let startY = null, startT = 0;
    home.addEventListener('touchstart', (e) => { if (e.touches.length !== 1) return; startY = e.touches[0].clientY; startT = Date.now(); }, { passive: true });
    home.addEventListener('touchend', (e) => {
      if (startY == null) return;
      const endY = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientY : startY;
      const dy = startY - endY;
      const dt = Date.now() - startT;
      if (dy > 60 && dt < 600 && startY > window.innerHeight - 180) openAppDrawer();
      startY = null;
    }, { passive: true });
  }

  // ---------- Agent UI helpers ----------
  function toggleAgent(open) {
    const d = $('#agent-drawer');
    const shouldOpen = open == null ? d.classList.contains('hidden') : !!open;
    d.classList.toggle('hidden', !shouldOpen);
    d.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
    if (shouldOpen) $('#agent-input').focus();
  }

  // ---------- Public API for Agent ----------
  async function deleteFileWithConfirm(id) {
    // find in files or notes
    const files = await getAll(STORE_FILES);
    const notes = await getAll(STORE_NOTES);
    let kind = null, name = id;
    if (files.find(f => f.id === id)) { kind = 'file'; name = files.find(f => f.id === id).name; }
    else if (notes.find(n => n.id === id)) { kind = 'note'; name = notes.find(n => n.id === id).title || 'Untitled'; }
    else {
      // try by name match
      const f = files.find(x => x.name === id); if (f) { id = f.id; kind = 'file'; name = f.name; }
      const n = notes.find(x => (x.title||'').toLowerCase() === String(id).toLowerCase());
      if (!kind && n) { id = n.id; kind = 'note'; name = n.title; }
    }
    if (!kind) return { ok: false, error: 'File/note not found', id };
    const approved = await confirmDialog(`Apex Agent requests to delete ${kind} "${name}" (${id}). Allow this?`);
    if (!approved) return { ok: false, cancelled: true, id, kind };
    await deleteStoredItem(id, kind);
    refreshBuiltinViews();
    await updateStorageBadge();
    return { ok: true, id, kind, name };
  }

  window.ApexOS = {
    getState: () => state,
    getApps: () => state.apps.slice(),
    getApp,
    launchApp: (id) => launchApp(id),
    closeApp: (id) => closeApp(id),
    setUIMode: (mode) => { applyMode(mode, true); return state.mode; },
    saveNote: (title, body) => saveNote(title, body),
    listFiles: () => listFiles(),
    deleteFile: (id) => deleteFileWithConfirm(id),
    openSettingsForApp: (id) => openSettingsForApp(id),
    toast,
    confirmDialog,
    refreshBuiltinViews,
    updateStorageBadge
  };

  // ---------- SW & Storage persistence ----------
  async function setupPWA() {
    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('/sw.js'); }
      catch (e) { console.warn('SW registration failed', e); }
    }
    if (navigator.storage && navigator.storage.persist) {
      try { await navigator.storage.persist(); } catch {}
    }
    await updateStorageBadge();
  }

  // ---------- Events & boot ----------
  function bindEvents() {
    $('#mode-toggle').onclick = toggleMode;
    $('#status-agent-btn').onclick = () => toggleAgent();
    $('#open-drawer-btn').onclick = openAppDrawer;
    $('#close-drawer-btn').onclick = closeAppDrawer;
    $('#nav-back').onclick = () => { hideRecents(); if ($('#app-drawer').classList.contains('open')) closeAppDrawer(); else closeActiveMobileApp(); };
    $('#nav-home').onclick = () => { closeAppDrawer(); hideRecents(); state.activeMobileAppId = null; $('#mobile-app-view').classList.add('hidden'); };
    $('#nav-recents').onclick = () => { if ($('#recents-view').classList.contains('hidden')) showRecents(); else hideRecents(); };
    $('#close-recents-btn').onclick = hideRecents;
    $('#agent-close-btn').onclick = () => toggleAgent(false);
    $('#agent-drawer').addEventListener('click', (e) => { if (e.target.id === 'agent-drawer') toggleAgent(false); });
    window.addEventListener('online', () => { updateNetworkBadge(); toast('Back online'); renderAll(); });
    window.addEventListener('offline', () => { updateNetworkBadge(); toast('You are offline. Local apps still work.'); });
    window.addEventListener('resize', () => {
      if (!state.settings.uiModeOverride) applyMode(detectAutoMode(), false);
    });
    setupSwipeDrawer();
  }

  async function boot() {
    try { state.db = await openDB(); }
    catch (e) { console.error('DB open failed', e); toast('Local storage unavailable'); }
    await loadState();
    bindEvents();
    const initialMode = (state.settings.uiModeOverride === 'mobile' || state.settings.uiModeOverride === 'desktop') ? state.settings.uiModeOverride : detectAutoMode();
    applyMode(initialMode, false);
    updateClock(); setInterval(updateClock, 1000 * 15);
    updateNetworkBadge();
    renderAll();
    await setupPWA();
    // refresh storage periodically
    setInterval(updateStorageBadge, 30000);
    console.log('ApexOS booted');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();