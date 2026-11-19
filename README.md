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
| `apex-login.js` | The one sign-in for the whole suite: full-screen gate, Firebase Auth over REST |
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

## One sign-in for the whole suite

`apex-login.js` is a single dependency-free script. It shows a full-screen
sign-in until there is a session, keeps the ID token in `localStorage` under
`apex-auth-session`, and exposes `ApexLogin.session()`, `.token()`,
`.signOut()` and `.onChange()`. The key is the same one `Apex-Auth` uses, so a
sign-in on any page covers every app on the origin.

- The shell loads it in `<head>`, so the desktop never paints before the gate.
- The workflow copies it into every `dist/apps/<slug>/` folder and adds one
  `<script>` tag to that app's `index.html`, so all 28 bundled apps sit behind
  the same door without touching their repos.
- The power menu shows the signed-in email and signs out on tap.
- If the Firebase console has email/password switched off, or the device is
  offline with no earlier session, the gate offers "Open with local data only"
  for that tab instead of locking you out. That is a convenience, not security.

This file is the canonical copy: it is served at the suite root as
`/apex-login.js`, and the workflow copies it into every app folder.

## Deploying

The workflow needs three secrets: `APEX_REPOS_TOKEN`, `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID`. It refuses to deploy a partial bundle - if any app
in the roster fails to clone, the run fails.

- `APEX_REPOS_TOKEN` must be a fine-grained PAT with **read access to every
  repo in the roster**, not just one. A token scoped to a single repo fails
  with `remote: Invalid username or token` on the rest.
- It deploys to the Pages project named in `env.PAGES_PROJECT`
  (`apexoperatingsystem`), which also serves the shell at its `pages.dev`
  address. If that project's own Git integration is left on, every push to
  this repo deploys the shell alone and can overwrite the bundled `/apps/`
  tree; turn automatic deployments off there once the workflow is green.

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
