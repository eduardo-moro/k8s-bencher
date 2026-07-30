# Resource Tuner

Build a frontend for "perftest-api" — a local dev tool that right-sizes a Kubernetes app's CPU/memory requests by running k6 load tests across a matrix of resource tiers in a disposable local kind cluster. This is a single-user, localhost-only tool (no auth, no multi-tenancy). The audience is a developer/SRE tuning resource limits before deploying to production.

## API contract

Base URL: read from an env var VITE_API_BASE_URL, defaulting to http://localhost:3001. No auth headers needed anywhere.

### Apps (config CRUD)

- GET /apps -> [{name, container, resources: {memory: string[], cpu: string[]}}]

- GET /apps/:name -> {name, container, resources: {memory: string[], cpu: string[]}, load: {vus: number, stages: [{duration: string, target: number}]}, manifestContent: string, scriptContent: string}

- POST /apps, body = same shape as GET /apps/:name response -> 201 + the created detail. 409 if name exists. 400 (Ajv shape: {statusCode, error, message}) if a required field is missing.

- PUT /apps/:name, body = any subset of the above fields -> 200 + updated detail. 404 if missing. No schema validation server-side, so validate reasonable inputs client-side.

- DELETE /apps/:name -> 204. 404 if missing.

- GET /templates/example -> same shape as an app detail, pre-filled with a bundled httpbin example. Use this to power a "start from example" button when creating a new app.

Errors from GET/PUT/DELETE and from POST's 409 case are {error: string}. POST's 400 validation case is {statusCode: number, error: string, message: string} instead — handle both shapes when showing an error toast (message ?? error).

### Runs (trigger + poll)

- POST /apps/:name/runs -> 202 + JobState. 409 if a run is already in progress anywhere (only one job exists at a time, globally, not per-app). 404 if the app doesn't exist.

- GET /jobs/current -> 200 + JobState, or 404 {error} if nothing has ever run this server session.

- DELETE /jobs/current -> always 200 {cancelled: true}. Kills the running process and tears down the cluster; use this as a "Cancel run" escape hatch.

JobState = {

  appName: string,

  status: "starting" | "running" | "done" | "failed",

  startedAt: string (ISO),

  finishedAt?: string (ISO),

  exitCode?: number,

  logTail: string,          // combined stdout+stderr, can be long, render as monospace scrollable log

  outputDir?: string        // only present once the engine creates its output folder; may lag behind status

}

Because there's only one job slot globally, treat "a run is in progress" as global app state, not per-app: poll GET /jobs/current every ~2-3s whenever the app is open, and disable every "Start Run" button anywhere in the UI while status is "starting" or "running", showing a persistent banner/indicator instead (which app is running, elapsed time, link to its live log, a Cancel button wired to DELETE /jobs/current).

### Outputs (past run results)

- GET /apps/:name/outputs -> [{folder: string, timestamp: string (ISO)}], newest first, empty array if no runs yet.

- GET /apps/:name/outputs/:folder -> {rows: ResultRow[]}. 400 if folder is malformed, 404 if unknown app/folder.

- GET /apps/:name/outputs/:folder/raw -> raw CSV text (Content-Type: text/csv) for a "Download CSV" link.

ResultRow = {

  memory: string, cpu: string,              // e.g. "256Mi", "250m" - this row's resource tier

  start_time: string, end_time: string,     // ISO

  duration_seconds: number,

  p95_ms: number | null,                    // null means this tier never became Ready - broke the app

  p99_ms: number | null,

  error_rate: number | null,                // fraction 0-1

  http_reqs_total: number | null,

  oom_killed: boolean,

  restart_count: number

}

Rows where p95_ms is null and/or oom_killed is true represent a resource tier that broke the app (OOMKilled or the pod never came up) - style these distinctly (red/warning row) in any results table, since they're often the most important finding of a sweep (the resource floor).

### Check

- GET /check -> always 200, {ready: boolean, output: string}. output is multi-line prerequisite-check text (kind/kubectl/k6/docker/powershell-yaml); render as a monospace block, ready drives a pass/fail badge.

## Screens

1. **Dashboard (`/`)** - Table/grid of apps from GET /apps (name, container, memory range, cpu range). "New App" button. Row click -> app detail. Row delete button (confirm dialog) -> DELETE /apps/:name. A small environment-status pill in the header that calls GET /check on load (and on demand) and shows ready/not-ready, expandable to the full output text. A persistent "run in progress" banner (see Runs section above) visible from every screen when applicable.

2. **New/Edit App (`/apps/new`, `/apps/:name/edit`)** - Form with: name + container (text inputs, name locked after creation), resources.memory and resources.cpu as two editable tag/chip lists (add/remove string entries like "128Mi", "250m"), load.vus (number input), load.stages as a repeatable row editor ({duration, target} pairs, add/remove/reorder), manifestContent and scriptContent as large monospace code-editor textareas (YAML and JavaScript respectively - syntax highlighting is a nice-to-have, not required). On the New screen, a "Start from httpbin example" button that calls GET /templates/example and fills the whole form. Save button does POST (new) or PUT (edit); show field-level or toast errors from the API.

3. **App detail (`/apps/:name`)** - Read view of the app's config (same fields as edit, read-only) plus a prominent "Start Run" button (disabled + tooltip if a run is already in progress globally) wired to POST /apps/:name/runs. Below that, if this app has a run in flight or just finished, show a live status panel: status badge, elapsed/duration, auto-scrolling monospace logTail (poll GET /jobs/current every ~2-3s while status is starting/running, stop polling once done/failed), and a Cancel button while active. Once outputDir appears and status is done/failed, link to that run in the results view. Also list past runs (GET /apps/:name/outputs) below, newest first, each linking to its results.

4. **Run results (`/apps/:name/outputs/:folder`)** - Table of ResultRow sorted by the order returned, columns: memory, cpu, p95_ms, p99_ms, error_rate (as %), http_reqs_total, oom_killed, restart_count, duration_seconds. Null numeric values render as "—" (not "0" or "null"). Rows with oom_killed=true or any null metric get a red/warning treatment with a short inline note ("this tier broke the app"). A "Download raw CSV" link/button hitting the /raw endpoint. Consider a simple bar/line chart of p95_ms vs. resource tier (skip null rows) to make the resource "sweet spot" visually obvious - this is the main payoff screen of the whole tool.

## Design notes

Dev-tool aesthetic: dense, functional, monospace for anything log/YAML/JS/CSV-ish, clear status colors (green=done/ready, blue=running, red=failed/oom, gray=idle/starting). Dark mode should look as good as light mode - this will mostly be used at a desk, often at night. Toast/inline errors for every failed API call - never fail silently. Empty states matter: no apps yet -> prompt to create from the example; no runs yet -> prompt to hit Start Run.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/6b08df83-c6f7-4cc6-97ee-b7fc142e7d3f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
