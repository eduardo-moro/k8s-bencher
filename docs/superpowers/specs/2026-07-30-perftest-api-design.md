# Perftest API — Design

## Context

The engine (`perftest.ps1` + `modules/Perftest.psm1`, see
`docs/superpowers/specs/2026-07-29-generic-k8s-perftest-design.md`) is done
and working: point it at a manifest/script/config trio and it right-sizes a
service's CPU/memory in a disposable local `kind` cluster. The next step,
agreed on separately, is a Lovable-built frontend on top of it. Before that
frontend can exist, it needs an API to talk to.

This design covers that API: a local Node.js server that lets a developer
configure apps, trigger runs, and view results, without touching the engine
itself.

## Goals

- Full CRUD over the per-app configuration (`configs/*.yaml`,
  `manifests/*.yaml`, `loadtest/*.js`) via HTTP.
- Trigger a full perftest run and poll its progress/status.
- List and read past runs' results (`output/<app>-<timestamp>/results.csv`).
- Do all of this **without altering `perftest.ps1` or
  `modules/Perftest.psm1`** — the API only edits the config/manifest/script
  files those scripts already read, and reads the `output/` files they
  already write. Runs are triggered by spawning `perftest.ps1` as a child
  process, never by importing the PowerShell module in-process.

## Non-goals (this round)

- The frontend itself — that's a separate, later effort (Lovable-built,
  against this API).
- Authentication/authorization — this is a local, single-user dev tool, same
  trust model as running `perftest.ps1` directly. Revisit if this is ever
  exposed beyond localhost.
- Multi-run concurrency — the underlying tool only supports one fixed-name
  `kind` cluster, so only one run can meaningfully happen at a time. The API
  enforces this with a single in-memory job slot rather than a queue.
- A persistent job/run database — run history lives entirely in the
  `output/` folder structure the engine already creates; the API doesn't
  duplicate that into its own storage.
- Live streaming (SSE/WebSocket) of run progress — polling is enough for a
  first version.
- Documentation beyond this spec and the eventual `interface/API/README.md`
  — a full walkthrough isn't needed to start building.

## Architecture

`interface/API/` is a standalone Node.js + TypeScript project using
[Fastify](https://fastify.dev/) (chosen over Express for built-in JSON
schema validation and stronger TypeScript support, meaning less hand-rolled
request validation code). It runs as a local dev server (`npm start`,
default port `3001`, overridable via a `PORT` env var).

Three responsibilities, cleanly separated:

1. **Configuration** — reads/writes `configs/*.yaml` (parsed to/from JSON),
   and `manifests/*.yaml`/`loadtest/*.js` as raw text. No new data store;
   the files on disk are the only source of truth.
2. **Run** — spawns `pwsh -File perftest.ps1 -Full -Config <path>` as a
   child process and tracks its lifecycle in a single in-memory "current
   job" slot (not a database — the API process holding this state in memory
   is enough for a local single-user tool; a restart mid-run just means
   checking `output/` directly afterward instead of via the API).
3. **Results** — lists and parses `output/<app>-<timestamp>/results.csv`
   into JSON on demand; never caches or duplicates this data elsewhere.

The API never `Import-Module Perftest.psm1`s and never edits
`perftest.ps1`/`modules/Perftest.psm1`. It treats the engine as a black box
it shells out to and reads output files from — matching the "don't alter
existing code" constraint exactly.

## App identity & naming convention

An "app" is identified by its config filename stem — e.g.
`configs/httpbin-example.yaml` → app name `httpbin-example`. The API doesn't
require `manifest`/`script` paths inside that config to share the same stem
(pre-existing configs may point anywhere; the API just follows whatever
paths are in the file), but when the API **creates** a new app via `POST
/apps`, it enforces the matching convention for simplicity:
`configs/<name>.yaml`, `manifests/<name>.yaml`, `loadtest/<name>.js`.

## Configuration endpoints

| Endpoint | Behavior |
|---|---|
| `GET /apps` | Scans `configs/*.yaml`; returns an array of `{name, container, resources}` summaries |
| `GET /apps/:name` | Returns `{name, container, resources: {memory: string[], cpu: string[]}, load: {vus: number, stages: {duration: string, target: number}[]}, manifestContent: string, scriptContent: string}` |
| `POST /apps` | Body: same shape as `GET /apps/:name`'s response (minus derived fields). Writes `configs/<name>.yaml` (generated from the structured fields), `manifests/<name>.yaml` (from `manifestContent`), `loadtest/<name>.js` (from `scriptContent`). `409` if the name already exists. |
| `PUT /apps/:name` | Body: any subset of the structured config fields / `manifestContent` / `scriptContent`. Updates only the files affected by fields present in the body. |
| `DELETE /apps/:name` | Removes `configs/<name>.yaml`, and the `manifest`/`script` files it points to |
| `GET /templates/example` | Returns `{config: {...parsed...}, manifestContent, scriptContent}` from the bundled `templates/` files, so the frontend can offer "start from the httpbin example" |

`config.yaml` round-trips through structured JSON (parsed on read, generated
on write) since its schema is small and well-defined — good for a form UI.
`manifest.yaml`/`script.js` are always raw text in and out, since they're
real Kubernetes/k6 artifacts meant to be hand-edited, not templated.

## Run endpoints

| Endpoint | Behavior |
|---|---|
| `GET /check` | Wraps `pwsh -File perftest.ps1 -Check`; returns `{ready: boolean, checks: [{label, passed, hint?}]}` |
| `POST /apps/:name/runs` | Starts `pwsh -File perftest.ps1 -Full -Config configs/<name>.yaml` as a background child process. `409 Conflict` if a job is already in the current-job slot. Returns immediately with `{appName, status: "starting", startedAt}`. |
| `GET /jobs/current` | Returns the current-job slot: `{appName, status: "starting"\|"running"\|"done"\|"failed", startedAt, finishedAt?, exitCode?, logTail: string, outputDir?: string}`. `404` if no job has run yet this server session. |
| `DELETE /jobs/current` | Kills the running child process (if any) and runs `pwsh -File perftest.ps1 -Teardown` as a best-effort cleanup — an escape hatch for a stuck run. Clears the job slot regardless of teardown's success. |

**Discovering `outputDir` without touching the engine:** `perftest.ps1`
names the output folder after the config file's *internal* `name:` field
(`output/$($parsedConfig.name)-<timestamp>`), which is not necessarily the
same as the URL app-name (the config's filename stem) — e.g. the bundled
demo config is `configs/example.yaml` (URL app-name `example`) but its
internal field is `name: httpbin-example`, so its output folders are
`output/httpbin-example-<timestamp>`, not `output/example-<timestamp>`.

So at spawn time, the API parses the config file being run and reads its
internal `name` field (not the URL app-name) — call it `outputPrefix` — plus
the spawn timestamp. It then polls the `output/` directory (every ~1s) for a
new folder matching `<outputPrefix>-*` whose creation time is after the
spawn timestamp. Because only one job can be active at a time (enforced by
the job slot itself), the first such folder found is unambiguously this
run's — no dependency on parsing `perftest.ps1`'s log output or its exact
wording.

For apps created through `POST /apps`, the API always sets the config's
internal `name` field equal to the URL app-name, so this distinction
disappears going forward — it only matters for pre-existing configs (like
the bundled demo) where the two happen to differ.

**`logTail`** is the child process's combined stdout+stderr, captured as the
API reads it (kept in memory, capped at a reasonable size, e.g. last 200
lines) — this is what lets the frontend show *something* while the run is
in progress even though the run is only polled, not streamed.

## Results endpoints

| Endpoint | Behavior |
|---|---|
| `GET /apps/:name/outputs` | Reads `configs/:name.yaml`'s internal `name` field (the actual output-folder prefix, per the note above) and lists matching `output/<that-name>-*` folders, newest first, each as `{folder, timestamp}` |
| `GET /apps/:name/outputs/:folder` | Parses that run's `results.csv` into `{rows: [{memory, cpu, start_time, end_time, duration_seconds, p95_ms, p99_ms, error_rate, http_reqs_total, oom_killed, restart_count}, ...]}` — numeric columns parsed as numbers, `oom_killed` as boolean |
| `GET /apps/:name/outputs/:folder/raw` | Serves the raw `results.csv` file for download (`Content-Type: text/csv`) |

## Error handling

- **Spawn/process failures** (pwsh missing, config file gone, non-zero
  exit) surface as `status: "failed"` on `/jobs/current` with `exitCode`
  and the last captured log lines — never an unhandled server crash.
- **Request validation:** `POST`/`PUT /apps` bodies are validated against a
  Fastify JSON schema (required fields; `resources.memory`/`resources.cpu`
  as non-empty string arrays; `load.stages` as an array of
  `{duration: string, target: number}`) — invalid input gets `400` with a
  specific message before any file is touched.
- **Atomic file writes:** every config/manifest/script write goes to a temp
  file in the same directory, then an atomic rename over the real path — a
  crash mid-write never leaves a half-written file behind.
- **Not-found paths** (`GET /apps/:name` for a name with no
  `configs/<name>.yaml`, `GET /apps/:name/outputs/:folder` for a missing
  folder) return `404`, not a generic `500`.

## Project layout

```
interface/API/
  package.json
  tsconfig.json
  src/
    server.ts          # Fastify app instance + route registration
    routes/
      apps.ts            # GET/POST/PUT/DELETE /apps, /apps/:name, /templates/example
      runs.ts            # POST /apps/:name/runs, GET/DELETE /jobs/current
      outputs.ts          # GET /apps/:name/outputs[/:folder][/raw]
      check.ts            # GET /check
    lib/
      configFiles.ts       # read/write configs+manifests+loadtest; YAML<->JSON for config.yaml
      jobRunner.ts          # spawn perftest.ps1, own the current-job slot, discover outputDir
      resultsCsv.ts          # parse results.csv into typed JSON rows
```

## Validation

Manual smoke test once implemented: `POST /apps` with the bundled httpbin
example's fields, `POST /apps/httpbin-example/runs`, poll `GET
/jobs/current` until `status: "done"`, then `GET
/apps/httpbin-example/outputs` and `GET
/apps/httpbin-example/outputs/:folder` to confirm the parsed rows match what
`make full` already produces manually.
