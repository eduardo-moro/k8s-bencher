# Electron packaging: engine root vs. data root, desktop app, installer

## Context

`k8s-perftest` today is three things run by hand: the PowerShell engine
(`perftest.ps1` + `modules/Perftest.psm1`), a Fastify API
(`interface/API/`) that spawns the engine as a child process, and a
TanStack Start frontend (`interface/frontend/`) that talks to the API.
`make interface` starts the API and frontend dev servers together, but
distributing this to someone else still means "clone the repo, install
Node/npm, run make interface" — not a real desktop app.

This design covers packaging the whole thing as a single-file Windows
installer using Electron, wrapping the existing API and frontend rather
than rewriting them (rejected alternatives: a Docker image, because `kind`
needs the *host's* real Docker daemon and containerizing the tool itself
means Docker-in-Docker or a mounted host socket, both fragile; a native
WinForms rewrite, because it would discard the wizard/translation/routing
work already built to reimplement the same logic in C#).

## Goals

- A single downloadable `.exe` that installs the app with a Start Menu
  entry, no manual Node/npm setup required by the end user.
- A Settings screen inside the app to choose where config/manifest/
  script/output data lives on disk, changeable after install.
- The app's own API server always listens on the same fixed port,
  invisible to the user (no port picking, no "which port is it on").
- Prerequisite verification (kind/kubectl/k6/docker/pwsh) happens as
  part of first launch, before the user can do anything else — reusing
  the engine's own existing check (`Test-PerftestPrerequisites` /
  `perftest.ps1 -Check`), not a reimplementation.
- Local development (`make interface`, `npm run dev`) keeps working
  exactly as it does today — none of this changes the dev workflow.

## Non-goals

- macOS/Linux packaging. The engine already assumes `pwsh` + Docker
  Desktop + `kind` on Windows; this round is Windows-only, matching the
  rest of the project.
- Auto-update. A single downloadable installer for now; wiring up
  electron-updater is a separate future round if this proves worth
  maintaining.
- Changing anything about what the engine or API actually *does* —
  this is purely a packaging/runtime-location change.

## The core architectural split: engine root vs. data root

Today, one path (`$PSScriptRoot` in PowerShell, `repoRoot` in the API)
serves two different purposes that a packaged app must separate:

- **Engine root** — `perftest.ps1`, `modules/Perftest.psm1`,
  `manifests/kind-config.yaml`, `manifests/k6-job-template.yaml`,
  `templates/*` (the bundled httpbin example). Read-only, ships inside
  the installed app, identical for every user, never user-edited.
- **Data root** — `configs/*.yaml`, `manifests/<app>.yaml`,
  `loadtest/<app>.js`, `output/*`. Writable, grows over time, and is
  exactly what the user should be able to point at a folder of their
  choosing (external drive, synced folder, wherever).

**PowerShell side:** `perftest.ps1` gains an optional `-DataRoot`
parameter (default: `$PSScriptRoot`, so the existing git-checkout dev
flow is unaffected). It's threaded into `Get-PerftestConfig -RepoRoot`
(which already resolves a config's `manifest`/`script` paths against
whatever root it's given — that's exactly the data-root concept, no
change needed there beyond passing the right value) and into the
`output/` folder path (currently `Join-Path $PSScriptRoot "output/..."`,
becomes `Join-Path $DataRoot "output/..."`). Everything else
(`kind-config.yaml`, `k6-job-template.yaml`, module import, `templates/`)
stays `$PSScriptRoot`-relative — those are engine files, unaffected.

**API side:** `ConfigFiles` and `JobRunner` currently each take one
`repoRoot` constructor argument. Both gain a second: `engineRoot`
(where `perftest.ps1` lives — used to spawn it, and for `templates/`,
which are bundled engine assets) and `dataRoot` (used for
`configs/`, `manifests/`, `loadtest/`, `output/`). In the normal git
dev flow both values are identical (today's `repoRoot`), so
`buildServer()`'s default keeps working unchanged. `JobRunner.startRun`
passes `-DataRoot <dataRoot>` to the spawned `perftest.ps1` process.

**Electron side:** owns the actual settings value (the chosen data-root
path), persisted as a small JSON file in `app.getPath('userData')`. It
is the single source of truth — the API doesn't persist its own copy of
this setting. When Electron spawns the API child process, it passes
`ENGINE_ROOT`, `DATA_ROOT`, and `PORT` as environment variables read
once at `buildServer()` call time. Changing the data folder in Settings
means Electron kills and respawns the API child process with the new
`DATA_ROOT` — simpler than making the setting mutable at runtime inside
Fastify.

## Electron app structure

```
electron/
  main.ts           # app lifecycle, spawns API child process, owns settings.json, IPC handlers
  preload.ts         # contextBridge: exposes a minimal window.electronAPI to the renderer
  settings.ts          # read/write settings.json in app.getPath('userData')
  requirements.ts       # spawn `pwsh -File <engineRoot>/perftest.ps1 -Check`, parse pass/fail
```

**Startup sequence:**
1. Load `settings.json` (data root path, or absent on first run).
2. If absent: show the first-run screen (a folder picker, no default —
   the user explicitly chose this over defaulting to Documents or
   AppData) before anything else loads. Persist the chosen path.
3. Run the prerequisite check (`requirements.ts`) and show a
   pass/fail screen if anything's missing, with the same hints
   `Test-PerftestPrerequisites` already produces — blocking further
   use until the user fixes it and re-runs the check (a manual
   "verificar novamente" button, not silent polling).
4. Spawn the API (`ENGINE_ROOT=<app resources path>`,
   `DATA_ROOT=<persisted path>`, `PORT=8026` — reusing the port
   already established as this project's convention this session,
   fixed and non-configurable so the user never has to think about
   it) as a child process via Electron running itself as plain Node
   (`ELECTRON_RUN_AS_NODE=1`), pointed at the API's bundled/compiled
   entry point. If the spawn fails or exits early (port conflict,
   crash), show a plain error screen with the captured stderr rather
   than a blank window.
5. Load `http://localhost:8026` (the API also serves the frontend's
   built static files — see below) into the main `BrowserWindow`.

**Why steps 2-3 can't be the React app:** `ConfigFiles`/`JobRunner`
require a data root at construction, so the API can't even start until
step 4 — and the React frontend is served *by* that API (step 5). The
first-run folder-picker and requirements screens therefore can't be
React pages reached through the normal app; they're small standalone
HTML/JS pages Electron loads directly into the `BrowserWindow` before
the API exists (plain DOM, no build pipeline, calling `window.electronAPI`
methods backed by `main.ts` IPC handlers — `pickDataFolder()`,
`runRequirementsCheck()`). Once both pass, Electron proceeds to step 4
and swaps the window's content over to the real app.

**Settings popup, at runtime (not just first-run):** a modal in the
existing React frontend (not a separate native window), gated behind
`window.electronAPI` being present (feature-detected — outside
Electron, e.g. plain `make interface` dev mode, the Settings entry is
simply absent, since there's no folder-picker/restart concept in a
browser tab). It calls `electronAPI.pickDataFolder()` (native OS folder
dialog via `preload.ts` → `main.ts`'s `dialog.showOpenDialog`), then
`electronAPI.setDataRoot(path)`, which persists the new value and
triggers Electron to kill+respawn the API child process; the frontend
shows a brief "reiniciando…" state and retries `/health` until the new
process is up.

## Frontend: static SPA build for packaging

The frontend's current Nitro build target defaults to `cloudflare`
(per `vite.config.ts`'s own comment), which isn't directly runnable as
a local Node server — and a packaged desktop app gets no benefit from
SSR (no SEO, no first-paint-over-slow-network concern; everything's
local). Rather than fight the Cloudflare-targeted build or add a second
Node server process just for the frontend, the Electron production
build switches to a plain client-rendered SPA: `vite build` with
TanStack Start's SSR disabled, producing static `dist/` files the API
serves directly (`@fastify/static` on a wildcard route, falling back to
`index.html` for client-side routing). **Local dev is unaffected** —
`npm run dev`/`make interface` keep using the existing SSR dev server
exactly as today; this only changes what `npm run build` produces for
the Electron package specifically (a separate build script/mode, not a
replacement for the existing one).

## Installer

`electron-builder`, Windows target `nsis` (its default), which already
produces a single `.exe` installer file — no extra configuration needed
for "one shareable file". Build output: app code + Node + Chromium +
the bundled engine (`perftest.ps1`, `modules/`, `manifests/`,
`templates/`) as `extraResources`, plus the API's compiled JS and the
frontend's static SPA build.

"Verifies requirements on setup" is implemented as the app's own
first-launch requirements screen (above), not NSIS-script-level
verification — reimplementing the kind/kubectl/k6/docker/pwsh checks in
NSIS's scripting language would duplicate `Test-PerftestPrerequisites`
in a second, harder-to-maintain form for no real benefit, since the
check needs `pwsh` to run anyway (same as the real check), and the
installer can't meaningfully block installation on missing *runtime*
tools the user might install *after* installing this app.

## Testing

Same situation as the frontend work: no existing test framework in
`interface/frontend/` or `electron/`, and this is fundamentally an
integration/packaging change (does the installer produce a working app)
that unit tests wouldn't meaningfully cover anyway. Verification is
manual: build the installer, install it on this machine, walk through
first-run (folder picker → requirements check → main window loads →
create an app via the wizard → trigger a real run), confirm Settings'
folder-change-and-restart works, confirm `make interface` still works
unchanged in the source checkout.

## Rollout

New branch (`electron-packaging`, already created), not touching
`master` until this is verified working end-to-end.
