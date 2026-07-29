# Generic, Reusable Kubernetes Resource-Sizing Tool — Design

## Context

This repo (`k8s-perftest`) was built as a one-off to find the minimum viable
CPU/memory for the `site-outline` deployment, using a disposable local `kind`
cluster and a k6-driven load matrix (see prior, now-deleted, Outline-specific
scripts and results). The approach worked well enough that it's worth
generalizing: any dev should be able to point this tool at a docker image and
a set of requests, run a configurable resource matrix against it, and get back
a data table showing how much CPU/memory their application actually needs.

This design covers the **engine**: config format, cluster/deploy/load-test
automation, and the Windows-native CLI. A frontend (to be built separately in
Lovable) will eventually sit on top of this engine via an API — that API is
explicitly out of scope for this round and will be designed later, once the
engine's shape is settled.

## Goals

- Remove all Outline-specific code, manifests, results, and docs from the repo.
- Let a dev test **any single containerized service** by giving an image name,
  a health check, env vars, and a list of requests to use as load — no
  dependency on that service's own repo or manifests.
- Make the resource matrix (which memory/CPU combinations get tested) and the
  load shape (VUs, ramp stages, requests) fully configurable per app, instead
  of hardcoded.
- Go fully Windows-native: PowerShell as the primary runtime, no WSL
  requirement.
- Structure the core logic so a future thin API can call into it directly
  (for the planned Lovable frontend), without redesigning the engine.

## Non-goals (this round)

- Building the frontend itself — only an empty `frontend/` placeholder folder.
- Designing the future API surface.
- Multi-service test topologies (DB/cache sidecars owned by the tool) — the
  service under test is deployed alone; any dependencies it needs must already
  be running and reachable (e.g. via env vars pointing at `host.docker.internal`
  or an existing external endpoint). This is a deliberate scope cut: the tool
  validates **one service's** resource floor at a time.
- Automatic recommendation/report generation (e.g. safety-margin logic, HTML
  reports, bisecting search). Output is raw per-run data
  (`results.csv` + k6 JSON + `kubectl top` logs); turning that into a
  narrative recommendation is a manual/future step.
- A declarative (non-JS) load-request format. `loadtest/<app>.js` is always a
  real k6 script — hand-written now, possibly form-generated later by the
  frontend — so there's no separate declarative schema to keep in sync with
  generated JS, and no restriction on chaining requests (e.g. "list documents,
  then fetch a random one from the response") since it's just k6 JS.

## Repo structure

```
k8s-perftest/
  perftest.ps1                  # CLI entrypoint: parses args, calls module functions
  Makefile                      # thin wrapper for Git Bash users: make test CONFIG=... -> pwsh
  modules/
    Perftest.psm1               # core logic: cluster, deploy, matrix, results
  manifests/
    kind-config.yaml            # generic kind cluster config (committed, infra-level, not per-app)
    k6-job-template.yaml        # generic k6 Job wrapper (committed, infra-level: runs whatever script+VUs/stages it's given)
    <app>.yaml                  # gitignored; real per-app Deployment+Service, one file per app under test
  loadtest/
    <app>.js                    # gitignored; real per-app k6 script, one file per app under test
  configs/
    <app>.yaml                  # gitignored; per-app test parameters (matrix, load shape, file pointers)
  templates/
    config.example.yaml         # committed starting point to copy into configs/
    manifest.example.yaml       # committed starting point to copy into manifests/
    loadtest.example.js         # committed starting point to copy into loadtest/
  frontend/
    README.md                   # placeholder; reserved for the Lovable-built app, API spec to follow later
  output/                       # gitignored; each run creates output/<app-name>-<timestamp>/
  README.md                     # rewritten: generic purpose, prerequisites, quickstart, config schema
```

`manifests/`, `loadtest/`, and `configs/` hold each dev's real, per-app
artifacts — gitignored, local-only, the same way `output/` already is. This
keeps the repo itself a pure reusable tool that never accumulates every
team's app definitions; `templates/` ships the one example of each file type
(a small public test image manifest, matching k6 script, and config) that a
dev copies as their starting point. This also directly supports the planned
Lovable frontend: a "simple mode" (form) or "advanced mode" (YAML/JS editor)
both just read and write these same three files — no special-casing between
generated and hand-written content.

`manifests/kind-config.yaml` and `manifests/k6-job-template.yaml` are the two
exceptions in that folder: infra-level, committed, not per-app. `.gitignore`
ignores `manifests/*.yaml` with explicit negations
(`!manifests/kind-config.yaml`, `!manifests/k6-job-template.yaml`) so per-app
manifests stay local while these two stay tracked.

Deleted entirely (per explicit decision, not archived): `manifests/outline.yaml`,
`manifests/postgres.yaml`, `manifests/redis.yaml`, `loadtest/outline-load.js`,
`loadtest/smoke-test-job.yaml`, `generate-secret.sh`, `seed-db.sh`,
`create-cluster.sh`, `run-matrix.sh`, `teardown.sh`, `plans/`, `specs/` (old
Outline spec/plan), `relatorio-resultados.md`, `results/`, `tmp-out/`.

## Test config schema

`manifests/<app>.yaml` and `loadtest/<app>.js` are real, standalone artifacts —
a plain Kubernetes Deployment+Service, and a plain k6 script — not templates
with placeholders. `configs/<app>.yaml` just points at them and carries the
test parameters that aren't part of either file:

```yaml
name: my-app
manifest: manifests/my-app.yaml   # real Deployment+Service; engine applies it as-is
container: app                     # container name inside that manifest to patch resources on
script: loadtest/my-app.js         # real k6 script; engine runs it as-is
resources:
  memory: [256Mi, 384Mi, 512Mi, 768Mi]
  cpu: [250m, 500m, 1000m]          # full cross product
load:
  vus: 15
  stages:
    - {duration: 20s, target: 15}
    - {duration: 120s, target: 15}
    - {duration: 10s, target: 0}
```

Field notes:
- `manifest`/`script` are file paths, not inline content — the engine never
  parses or renders their contents beyond applying/running them, and
  `kubectl set resources -c <container>` only needs the container name, not
  image/port/health-check details. This removes the placeholder-substitution
  layer for the app manifest entirely: no `app-template.yaml` to maintain.
  (`manifests/k6-job-template.yaml` still exists, but it's infra-level — the
  generic k6-runner Job wrapper, not something per-app.)
- Whatever env vars, health checks, secrets-as-plain-env, image, and ports the
  service needs are just written directly into `manifests/<app>.yaml`, like
  any normal Kubernetes manifest. `templates/manifest.example.yaml` shows the
  pattern (single container, HTTP readiness/liveness probe, plain env vars —
  consistent with this being a disposable local `kind` cluster, not a
  production secrets story; the README calls this out explicitly).
- `resources.memory`/`resources.cpu` replace the hardcoded 4×3 matrix; any
  length lists are supported, cross-producted the same way.
- `load.vus`/`load.stages` are passed to the k6 script as env vars
  (`VUS`, stage timings) so `loadtest/<app>.js` can read them uniformly,
  the same way `OUTLINE_URL`/`VUS` are read today. The script itself defines
  its own requests/weights in k6 JS directly (e.g. the existing 90%-read/
  10%-write pattern) — there is no separate declarative request format to
  keep in sync with a generated script, since the script *is* the artifact.

## Core engine flow

Implemented as functions in `modules/Perftest.psm1`, called both by
`perftest.ps1` and (later) by a future API layer:

- `New-PerftestCluster` — creates the kind cluster + metrics-server (idempotent,
  same skip-if-exists behavior as today's `create-cluster.sh`), generic naming
  (no "outline" in cluster name), no MSYS/WSL path workarounds needed under
  native PowerShell.
- `Deploy-PerftestApp -Config <path>` — `kubectl apply -f` the config's
  `manifest` file as-is, waits for rollout. No rendering/templating step.
- `Publish-PerftestLoadScript -Config <path>` — publishes the config's
  `script` file into a ConfigMap (`kubectl create configmap ... --from-file`),
  same mechanism as today's `k6-config` Makefile target.
- `Invoke-PerftestMatrix -Config <path>` — cross-products
  `resources.memory` × `resources.cpu`; for each pair: patch the named
  `container`'s resources on the Deployment, wait for rollout, sample
  `kubectl top` in the background, run a k6 Job (from
  `manifests/k6-job-template.yaml`, mounting the published script ConfigMap
  and injecting `load.vus`/`load.stages` as env vars), poll for completion,
  detect `OOMKilled`/restart count, append one row to
  `output/<name>-<run-id>/results.csv`. Same incremental-append behavior as
  today (a crash mid-matrix doesn't lose prior rows).
- `Remove-PerftestCluster` — tears down the kind cluster.

`ConvertFrom-Json`/`ConvertTo-Json` (native PowerShell) replace the `jq`
dependency used by `run-matrix.sh` today.

## CLI & Windows-first

- Primary runtime: PowerShell 7+ (`pwsh`), run directly on Windows. Prereqs:
  Docker Desktop, `kind`, `kubectl`, `k6` — no WSL, no `jq`.
- `perftest.ps1` exposes subcommands as switches/params, e.g.:
  - `.\perftest.ps1 -Cluster`
  - `.\perftest.ps1 -Run -Config configs\my-app.yaml`
  - `.\perftest.ps1 -Teardown`
  - `.\perftest.ps1 -All -Config configs\my-app.yaml` (cluster + deploy + matrix, cluster left running)
  - `.\perftest.ps1 -Full -Config configs\my-app.yaml` (same, plus teardown after)
- `Makefile` stays as a thin optional wrapper for Git Bash/`make` users,
  forwarding each target to the equivalent `pwsh -File perftest.ps1 ...` call.
  It is not the primary documented interface; the README leads with the
  PowerShell commands.

## Future API readiness (not designed now)

`Perftest.psm1`'s functions take explicit parameters and return structured
results (no interactive prompts, no hidden global state beyond the target
kind cluster), so a future thin API can `Import-Module Perftest.psm1` and call
these functions directly to back the Lovable frontend, instead of shelling out
to a monolithic script. The actual API contract (HTTP surface, auth, job
lifecycle for long-running matrix runs) is deliberately left for a later
brainstorming round, once there's a concrete frontend to design it against.

## Frontend folder

`frontend/README.md` only, stating the folder is reserved for the
Lovable-built frontend and that an API specification will be provided in a
future conversation. No scaffolding, no framework choice made now.

## Validation

- Copy `templates/config.example.yaml` → `configs/example.yaml`,
  `templates/manifest.example.yaml` → `manifests/example.yaml`, and
  `templates/loadtest.example.js` → `loadtest/example.js` (a small public test
  image, e.g. `httpbin`), then manually run
  `.\perftest.ps1 -All -Config configs\example.yaml` to confirm the full
  pipeline works end-to-end natively on Windows: cluster creation, manifest
  apply, k6 script execution, matrix loop, `results.csv` output — before
  considering the engine done.
