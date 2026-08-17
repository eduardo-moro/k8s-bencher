---
name: bootstrapping-perftest-apps
description: Use when asked to add, onboard, set up, or scaffold a new application for load testing in this repo — before creating any Deployment/Service manifest, k6 script, or resource-matrix config for k8s-perftest.
---

# Bootstrapping perftest apps

## Overview

Onboarding an app to this tool means creating three gitignored, per-app files
(`manifests/<name>.yaml`, `loadtest/<name>.js`, `configs/<name>.yaml`) that
the harness (`modules/Perftest.psm1`) depends on following exact
conventions. Guessing at the details produces a config that *runs* but
produces misleading resource-sizing numbers — ask first, generate second.

## When to use

Any request to add a new app, set up load testing for a service, or
scaffold perftest manifest/script/config files in this repo.

## Step 1: Ask before writing anything

Don't generate files from assumptions. Ask the user for whatever isn't
already given:

| Need to know | Why |
|---|---|
| Image (`repo:tag`) | Locally-built images are auto-loaded into kind (`Import-PerftestLocalImages`); registry images just need network access — you don't need to ask which kind it is, but you do need the exact ref |
| Container port + health-check path | Drives `containerPort` and both probes |
| **Real, representative endpoint(s)/method(s) for the k6 script** | A `/health`-only load test produces meaningless sizing data — push back if the user doesn't supply this |
| Env vars / secrets needed to boot | Mirror the app's docker-compose if one exists (see `manifests/sts.yaml` for a worked example) |
| Runtime/language, especially .NET version | Pre-.NET Core 3.0 apps need the `DOTNET_GCHeapHardLimit` opt-in (Step 2) |
| Memory/CPU tiers to test | Offer a default matrix (`templates/config.example.yaml`) if the user has no strong opinion, but confirm it |
| VUs / load stages | Default to ramp/plateau/ramp-down if unspecified |
| Slow startup, or plan to test very low CPU tiers | Probe `timeoutSeconds` needs raising — default 1s is too aggressive under CPU throttling (see `manifests/sts.yaml`) |

## Step 2: Generate the three files

Base each on the matching template (`templates/manifest.example.yaml`,
`templates/config.example.yaml`, `templates/loadtest.example.js`), applying
these repo-specific conventions:

**`manifests/<name>.yaml`** — Deployment + Service:
- Deployment `metadata.name`, container `name`, pod label `app`, and Service
  `selector.app` must ALL be identical to each other and to the config's
  `container` field — `kubectl set resources`/`kubectl set env` target by
  this name.
- `strategy: { type: Recreate }` — the harness patches resources between
  combos; a stray RollingUpdate pod would contaminate a tier's results.
- `imagePullPolicy: IfNotPresent` — without it, a `:latest` tag ignores the
  image kind already loaded and tries (and fails) to pull from a real
  registry.
- Initial `resources.requests`/`limits` = the **highest** tier in the
  matrix, so the first deploy doesn't OOM before the matrix even starts
  patching tiers.
- If the app needs `DOTNET_GCHeapHardLimit` (Step 1's runtime question):
  add it with any placeholder hex value. The harness detects the env var by
  name and keeps it synced to 80% of each combo's memory limit
  automatically (`Get-PerftestGcHeapHardLimitHex`). Don't hand-compute a
  real value — it's overwritten per-combo anyway.
- `readinessProbe`/`livenessProbe` with explicit `timeoutSeconds` (5 is the
  established value) if the app is slow-starting or the matrix includes low
  CPU tiers.

**`configs/<name>.yaml`**:
- `manifest`/`script` point at the two files above; `container` matches the
  manifest name.
- `resources.memory`/`resources.cpu` — the confirmed tier lists.
- `load.vus`/`load.stages` — the confirmed load shape.
- `sampleIntervalSeconds` is optional (default 5s) — only set it if the
  user wants a different RAM/CPU sampling cadence.

**`loadtest/<name>.js`**:
- `BASE_URL` = `http://<container>:<port>` (in-cluster Service DNS, not
  localhost).
- Hits the real representative endpoint(s) from Step 1, not just the
  health check.

## Step 3: Validate and run

```
pwsh -File perftest.ps1 -Check       # confirms kind/kubectl/k6/docker/powershell-yaml are ready
make full CONFIG=configs/<name>.yaml # cluster + run + teardown, start to finish
```
Use `make all CONFIG=...` instead to leave the cluster up for iterating.

## Common mistakes

- Container/label/Service-selector name mismatch — resources silently stop
  being patched (`kubectl set resources` targets a container name that
  doesn't exist).
- Load script only exercising a health-check endpoint — runs fine, produces
  useless sizing numbers.
- Forgetting `strategy: Recreate` — a stale pod at the old resource tier can
  serve some of the "new" tier's traffic.
- Manually `docker push`/`kind load`-ing an image before running —
  unnecessary, the harness does this automatically for any image that
  exists in the local Docker cache.
- Hardcoding a real `DOTNET_GCHeapHardLimit` value in the manifest — it's
  overwritten per-combo anyway; a placeholder is fine.
