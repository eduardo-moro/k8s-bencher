# Outline Kubernetes Performance Testing — Design

## Context

The current deployment runs Outline (+ Postgres, Redis, Caddy) via `docker-compose`
on a local machine with 32GB RAM available. Observation: the Outline container
appears to only use ~300MB of memory. Before sizing a future production
deployment, we want to find the **minimum viable CPU/memory** Outline needs to
stay stable under a realistic MVP-scale load, using a disposable local
Kubernetes environment as the test bed.

A draft estimate already exists (uncommitted, in `site-outline/README.md`),
proposing `250m CPU / 512Mi` request and `500m CPU / 768Mi` limit for Outline
in a real target cluster (`team-tools`), based on idle usage and a comparison
against an existing Docusaurus deployment there. This test's job is to
validate or correct that specific estimate under actual load, not just explore
resource sizing in the abstract.

**This workspace (spec, manifests, scripts, results) is intentionally kept
entirely separate from the `site-outline` git repository** — it lives in its
own sibling folder (`outline-k8s-perftest/`) and is not committed to
`site-outline` at any point. Only the final pt-BR summary/recommendation is
meant to potentially feed back into that repo's docs, and only if the user
asks for that explicitly later.

## Goal

Find the lowest CPU/memory resource combination for the Outline container that
survives simulated load (10-20 concurrent API users, read-heavy mix) without
OOMKills, pod restarts, or error-rate/latency degradation.

Non-goals:
- Testing Postgres/Redis resource floors (kept generously resourced, not the
  focus).
- Testing/replicating the OIDC + Caddy login flow inside Kubernetes.
- Building a long-lived or production Kubernetes environment — this cluster is
  throwaway, created and torn down for this test only.

## Architecture

- **Cluster:** local `kind` (Kubernetes-in-Docker), single node. Chosen over
  minikube (heavier, VM-based on Windows) and Docker Desktop's built-in
  Kubernetes (less flexible to tear down/recreate between experiments).
- **Manifests:** plain Kubernetes YAML under `manifests/` in this workspace,
  no Helm/Kustomize — matches the `site-outline` repo's existing lightweight
  style (docker-compose + shell scripts) without living inside that repo.
  - `Deployment` + `Service` for `outline`, `redis`, `postgres`.
  - Postgres and Redis use `emptyDir` volumes (ephemeral; acceptable since
    those pods are not deleted/recreated between resource-limit test runs
    within one session — only the Outline `Deployment` is patched/restarted
    per combination).
  - `outline-secret.yaml` (in this workspace only, never copied into
    `site-outline`) generated from `site-outline/.env`: same `SECRET_KEY` and
    `UTILS_SECRET` (required — Outline encrypts sensitive DB fields, like the
    OIDC client secret and API tokens, using `SECRET_KEY`; reusing it lets the
    restored DB decrypt cleanly), plus `DATABASE_URL`/`REDIS_URL` rewritten to
    in-cluster service DNS names.
  - No Caddy/Ingress/TLS in this cluster. All test traffic is Bearer-token API
    calls (not cookie-based browser sessions), so Outline's `Service` is
    exposed via `NodePort` or `kubectl port-forward` directly over HTTP —
    mirroring how `site-outline/scripts/migrate-to-outline.mjs` already talks
    to Outline over plain HTTP via the loopback-only port in docker-compose.
- **Bootstrap data:** one-time `pg_dump` of the current docker-compose
  Postgres database (read from `site-outline`'s running containers, nothing
  written back there), restored into the kind cluster's Postgres via
  `seed-db.sh`. Because `SECRET_KEY`/`UTILS_SECRET` are reused unchanged, the
  existing `OUTLINE_API_TOKEN` (already in `site-outline/.env`) works
  unmodified against the new cluster — no manual OIDC login or new token
  needs to be minted.

## Load test tool & workload

- **k6** for load generation (single static binary, scriptable in JS, clean
  built-in latency/error-rate reporting).
- `loadtest/outline-load.js`: authenticates via
  `Authorization: Bearer $OUTLINE_API_TOKEN` and simulates **10-20 virtual
  users** with a realistic MVP read-heavy mix:
  - ~90% reads: `documents.list`, `documents.info`, `documents.search`
  - ~10% writes: `documents.update`
- Each run: short ramp-up + ~2 minute steady-state window at target VUs per
  resource combination — long enough to surface OOMKills/CPU throttling
  without making the full matrix take hours.
- k6 runs from the host (or as a one-off container) against Outline's
  NodePort/port-forward, not as an in-cluster Job — keeps k6's own resource
  usage from muddying the pod metrics being measured, and keeps the script
  easy to iterate on.

## Resource matrix & automation

- Each combination runs with **requests = limits** (Guaranteed QoS) for clean,
  reproducible results without bursting/noisy-neighbor effects.
- Matrix is centered on the existing draft estimate
  (`250m/512Mi` request, `500m/768Mi` limit) so this test directly
  validates or corrects that specific recommendation, rather than exploring
  the full space from scratch (adjustable once early results come in — e.g.
  if the lowest combo already fails hard, drop it from later runs rather than
  wasting time; if everything passes easily, add a lower combo to keep
  pushing the floor down):
  - Memory: `256Mi, 384Mi, 512Mi, 768Mi`
  - CPU: `250m, 500m, 1000m`
  - → 12 combinations
- `metrics-server` installed as a kind cluster addon so `kubectl top pod`
  works for sampling during runs.
- Driver script `run-matrix.sh`, for each combination:
  1. Patch the Outline `Deployment`'s resources and wait for rollout.
  2. Run the k6 script against it.
  3. Sample `kubectl top pod` a few times during the run.
  4. Check `kubectl get pod` / `describe pod` afterward for `OOMKilled` status
     or restart count.
  5. Append a row to `results/matrix-results.csv`: memory limit, CPU
     limit, p95/p99 latency, error rate, OOMKilled (y/n), restart count.
- Results are appended incrementally (not just written at the end) so a crash
  mid-matrix doesn't lose prior data.

## Validation

- Before running the full matrix, do one manual smoke-run of the harness
  against a generous combination (e.g. `512Mi` / `1000m`) to confirm the k6
  script, seeded data, and metrics sampling all work end-to-end.

## Output

- `results/matrix-results.csv` — raw per-combination results.
- A short generated summary highlighting the lowest combination that passed
  with zero OOMKills/restarts and no error-rate/latency spike — the
  recommended minimum viable resource request/limit for Outline.
- **A pt-BR summary report** (methodology, matrix results, and final
  recommendation) written once the matrix finishes, for sharing with the rest
  of the team.

## Cleanup

- `teardown.sh` deletes the kind cluster once testing is complete — this
  environment is not meant to persist. Nothing in this workspace is ever
  committed to or copied into the `site-outline` repository.
