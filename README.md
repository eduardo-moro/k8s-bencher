# outline-k8s-perftest

Disposable local Kubernetes performance-testing workspace for the `site-outline`
Outline deployment. It exists to find the minimum viable CPU/memory
request/limit for Outline in Kubernetes, using a `kind` cluster with Postgres
and Redis restored from the real docker-compose database and a k6-driven
load matrix.

This is a standalone git repository, intentionally separate from the
`site-outline` repo it tests — it has no dependency relationship in either
direction beyond reading `site-outline`'s existing resource estimate as a
baseline to validate.

**Status: historical, not live.** The kind cluster this workspace built and
tested against has been torn down (`teardown.sh`). Nothing here is running;
treat this as a completed run, not an environment to connect to.

Deliverables:
- `results/matrix-results.csv` — raw data, one row per tested combination.
- `results/relatorio-resultados.md` — pt-BR summary report and recommendation.

To understand or reproduce how these were produced, start from
`plans/2026-07-24-outline-k8s-perf-testing-plan.md`, the full step-by-step
implementation plan (kept in sync with the actual committed scripts).
