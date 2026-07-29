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
- Request chaining in the declarative load format (e.g. "list documents, then
  fetch a random one from the response"). Declarative `requests` are static;
  stateful flows require the raw k6 script escape hatch (`load.script`).

## Repo structure

```
k8s-perftest/
  perftest.ps1                  # CLI entrypoint: parses args, calls module functions
  Makefile                      # thin wrapper for Git Bash users: make test CONFIG=... -> pwsh
  modules/
    Perftest.psm1               # core logic: cluster, deploy, load-script generation, matrix, results
  manifests/
    kind-config.yaml            # generic kind cluster config
    app-template.yaml           # generic Deployment+Service template (placeholders, see below)
    k6-job-template.yaml        # generic k6 Job template
  configs/
    example.config.yaml         # one worked example (public test image), so the repo isn't an empty skeleton
  frontend/
    README.md                   # placeholder; reserved for the Lovable-built app, API spec to follow later
  output/                       # gitignored; each run creates output/<app-name>-<timestamp>/
  README.md                     # rewritten: generic purpose, prerequisites, quickstart, config schema
```

Deleted entirely (per explicit decision, not archived): `manifests/outline.yaml`,
`manifests/postgres.yaml`, `manifests/redis.yaml`, `loadtest/`,
`generate-secret.sh`, `seed-db.sh`, `create-cluster.sh`, `run-matrix.sh`,
`teardown.sh`, `plans/`, `specs/` (old Outline spec/plan), `relatorio-resultados.md`,
`results/`, `tmp-out/`.

## Test config schema

One YAML file fully describes a run. Example (`configs/example.config.yaml`):

```yaml
name: my-app
image: myregistry/myapp:latest
container:
  name: app
  port: 8080
healthCheck:
  path: /healthz
env:
  DATABASE_URL: postgres://host.docker.internal:5432/mydb
envFile: ../myapp/.env           # optional; merged in, explicit `env` wins on key conflict
resources:
  memory: [256Mi, 384Mi, 512Mi, 768Mi]
  cpu: [250m, 500m, 1000m]        # full cross product
load:
  vus: 15
  stages:
    - {duration: 20s, target: 15}
    - {duration: 120s, target: 15}
    - {duration: 10s, target: 0}
  requests:                       # declarative mode; omit if using `script`
    - name: list_items
      method: POST
      path: /api/items.list
      headers: {Content-Type: application/json}
      body: '{"limit":25}'
      weight: 1                   # fraction of iterations this request runs in (1 = always)
  # script: ./custom-load.js      # raw k6 script, mutually exclusive with `requests`
```

Field notes:
- `container.name`/`container.port`/`healthCheck.path` parameterize
  `manifests/app-template.yaml` (a Deployment with one container + a Service),
  replacing today's hardcoded `outline` container/`/_health` path.
- `env`/`envFile` values are injected as plain (not Secret-backed) env vars —
  consistent with this being a disposable local `kind` cluster, not a
  production secrets story. The README will call this out explicitly as a
  local-only tool.
- `resources.memory`/`resources.cpu` replace the hardcoded 4×3 matrix; any
  length lists are supported, cross-producted the same way.
- `load.requests[].weight` mirrors today's "10% of iterations write" pattern
  (`Math.random() < weight` in the generated script) — no dedicated syntax for
  richer distributions.
- `load.script`, when present, is used verbatim instead of a generated script;
  it still receives `BASE_URL`, `VUS`, and stage timings as env vars so a
  custom script can read the same tunables uniformly.

## Core engine flow

Implemented as functions in `modules/Perftest.psm1`, called both by
`perftest.ps1` and (later) by a future API layer:

- `New-PerftestCluster` — creates the kind cluster + metrics-server (idempotent,
  same skip-if-exists behavior as today's `create-cluster.sh`), generic naming
  (no "outline" in cluster name), no MSYS/WSL path workarounds needed under
  native PowerShell.
- `Deploy-PerftestApp -Config <path>` — renders `app-template.yaml` with the
  config's image/container/port/health-check/env, applies it via `kubectl`,
  waits for rollout.
- `Build-PerftestLoadScript -Config <path>` — generates a k6 script from
  `load.requests` (weighted per-request execution, same shape as today's
  `outline-load.js` but generic field names), or returns the path to
  `load.script` unchanged if provided. Publishes the script into a ConfigMap
  the same way `k6-config` does today.
- `Invoke-PerftestMatrix -Config <path>` — cross-products
  `resources.memory` × `resources.cpu`; for each pair: patch the Deployment's
  resources, wait for rollout, sample `kubectl top` in the background, run a
  k6 Job (rendered from `k6-job-template.yaml` with `load.vus`/`load.stages`),
  poll for completion, detect `OOMKilled`/restart count, append one row to
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

- Manually run `.\perftest.ps1 -All -Config configs\example.config.yaml`
  against the example config (a small public test image, e.g. `httpbin`) to
  confirm the full pipeline works end-to-end natively on Windows: cluster
  creation, generic manifest deploy, generated k6 script execution, matrix
  loop, `results.csv` output — before considering the engine done.
