# ApexOS

The shell every Apex app runs inside. One static origin, one service worker,
and `/apps/<slug>/` for each bundled app - so the suite installs once and works
offline.

## What is in here

| File | What it does |
| --- | --- |
| `index.html` | Status bar, icon grid, dock, app drawer, app window, power menu |
| `app.js` | Renders installed apps from `apex_installed_apps`; holds the 28-app catalogue |
| `registry.js` | Shared contract for Apex Store and Apex Settings: storage keys, cache names, BroadcastChannel messages |
| `styles.css` | Shell styling, wallpapers, layout modes |
| `sw.js` | Caches the shell only; `/apps/` keeps its own worker and cache |
| `manifest.json`, `icon-*.png` | Install identity for the OS itself |
| `.github/workflows/bundle-apex.yml` | Clones every app repo into `dist/apps/<slug>/` and deploys to Cloudflare Pages |

There is no build step and no dependency. Open `index.html` on any static
server; the shell asks the browser for a service worker and degrades to
online-only if it refuses.

## How the pieces agree

- `registry.js` is byte-identical in the shell, `Apex-Store` and `Apex-Settings`.
- Installing in the Store writes `apex_installed_apps` and broadcasts
  `APP_INSTALLED` on `apex-os-apps`; this shell re-renders without a reload.
- Theme and layout changes arrive on `apex-settings` and apply immediately.
- Every app path in `app.js` matches a repo in the workflow roster; adding an
  app means editing both.

## Deploying

The workflow needs three secrets: `APEX_REPOS_TOKEN` (read access to the app
repos), `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. It refuses to deploy
a partial bundle - if any app in the roster fails to clone, the run fails.

## Where the plan lives

`Apex` holds the map: what exists, what is missing, the free-tier limits and the
copilot contract. It holds documents only.

## Previously

Before this repo took the shell, it carried an earlier window-manager shell
(`app.js` with dock/windows/recents, plus `agent.js`). Those files are intact in
Git history at commit `feec2f1`:

```bash
git show feec2f1:app.js > /tmp/old-shell.js
git show feec2f1:agent.js > /tmp/old-agent.js
```
