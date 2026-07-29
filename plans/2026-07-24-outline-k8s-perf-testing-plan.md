# Outline Kubernetes Minimum-Resource Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a disposable local Kubernetes (`kind`) cluster running Outline + Postgres + Redis (seeded from the existing docker-compose database), load-test Outline's API under a realistic 15-VU read-heavy workload across a memory×CPU matrix, and produce a pt-BR report recommending the minimum viable resource request/limit.

**Architecture:** Plain Kubernetes YAML manifests (no Helm/Kustomize) in a standalone workspace (`outline-k8s-perftest/`), entirely separate from the `site-outline` git repository. Outline is exposed via a NodePort Service (harmless to keep, but **not used for load generation** — see Environment Note below), and all in-cluster traffic (Postgres, Redis, and now k6) uses ClusterIP Service DNS names. The existing docker-compose Postgres database is dumped and restored into the cluster's Postgres so the existing `OUTLINE_API_TOKEN` and encrypted secrets (`SECRET_KEY`/`UTILS_SECRET`) work unmodified.

**Tech Stack:** `kind` (Kubernetes-in-Docker), `kubectl`, `metrics-server`, `k6` (load generation, run as an in-cluster Job — see Environment Note), `jq` (JSON parsing), bash scripts.

### Environment Note (discovered during Task 5)

This machine is corporate-managed with locked-down Windows Firewall policy: new inbound listener ports (e.g. the kind cluster's NodePort 30080, mapped by Docker to the host) are silently blackholed from the host side — confirmed via `netstat` showing the incoming SYN reach the listening socket but the handshake never completing back to the client, while the exact same endpoint responds instantly via `docker exec`/`kubectl exec` from inside the cluster. This is not a defect in any task's Kubernetes manifests. **Consequence: load generation (k6) cannot run from the host against the NodePort.** Tasks 7 and 8 instead run k6 as a Kubernetes Job inside the cluster, hitting Outline via `http://outline:3000` (ClusterIP Service DNS, always reachable in-cluster regardless of this host firewall issue). Metrics sampling (`kubectl top pod`) and result retrieval (`kubectl cp`, `kubectl logs`) are unaffected — they go through the Kubernetes API server, which has been reachable from the host throughout (confirmed working since Task 1).

## Global Constraints

- This entire workspace (`outline-k8s-perftest/`) must never be committed to or copied into the `site-outline` git repository. It has its own separate, freestanding local git repository (no remote, never pushed anywhere) used only as internal plumbing for tracking implementation progress — this is distinct from, and unrelated to, `site-outline`'s own git repository.
- Postgres/Redis Kubernetes Service names must be exactly `postgres` and `redis` so the existing `DATABASE_URL=postgres://outline:...@postgres:5432/outline` and `REDIS_URL=redis://redis:6379` in `site-outline/.env` work unmodified — no URL rewriting.
- Reuse `site-outline/.env` verbatim as the source for the in-cluster Secret (same `SECRET_KEY`/`UTILS_SECRET` so encrypted DB fields decrypt correctly).
- Resource matrix: Memory `256Mi, 384Mi, 512Mi, 768Mi` × CPU `250m, 500m, 1000m` (12 combinations), each run with **requests = limits** (Guaranteed QoS).
- Load test: 15 virtual users, ~20s ramp-up + 120s steady state + 10s ramp-down, ~90% reads (`documents.list`, `documents.info`, `documents.search`) / ~10% writes (`documents.update`).
- Final deliverable includes a **pt-BR summary report** of methodology, matrix results, and the recommended minimum viable resource combination.
- All paths below are relative to the workspace root: `C:\Users\e.moro\source\outline-k8s-perftest\` (referred to as `<ws>` below). `site-outline` refers to `C:\Users\e.moro\source\site-outline\`.

---

### Task 1: Cluster scaffolding (kind + metrics-server)

**Files:**
- Create: `<ws>/kind-config.yaml`
- Create: `<ws>/create-cluster.sh`
- Create: `<ws>/teardown.sh`

**Interfaces:**
- Produces: a running `kind` cluster named `outline-perftest`, context `kind-outline-perftest`, with `metrics-server` available (so `kubectl top pod` works in later tasks), and a NodePort 30080 mapped from the node to the host for later access to Outline.

- [ ] **Step 1: Install `kind` and `k6` via choco**

```bash
choco install kind k6 -y
```

Expected: both install successfully. Verify:

```bash
kind version
k6 version
```

Expected: version output for both, no "command not found".

- [ ] **Step 2: Write the kind cluster config**

Create `<ws>/kind-config.yaml`:

```yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: outline-perftest
nodes:
  - role: control-plane
    extraPortMappings:
      - containerPort: 30080
        hostPort: 30080
        protocol: TCP
```

- [ ] **Step 3: Write the cluster creation script**

Create `<ws>/create-cluster.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

kind create cluster --config kind-config.yaml

echo "Waiting for cluster to stabilize (30 seconds)..."
sleep 30

echo "Installing metrics-server..."
kubectl apply --validate=false -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# kind nodes use self-signed kubelet certs; metrics-server needs this flag
# to scrape them, or it never reports pod metrics (kubectl top stays empty).
kubectl patch deployment metrics-server -n kube-system --type='json' \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'

echo "Waiting for metrics-server rollout..."
kubectl -n kube-system rollout status deployment/metrics-server --timeout=120s

echo "Cluster ready. Context: kind-outline-perftest"
kubectl cluster-info --context kind-outline-perftest
```

**Correction discovered during Task 1's implementation:** immediately after `kind create cluster` returns, the API server isn't always fully ready to accept the metrics-server CRD/apply yet, so the script adds a `sleep 30` stabilization wait before installing metrics-server, plus `--validate=false` on that `kubectl apply` (the metrics-server manifest's CRD validation otherwise intermittently fails against a freshly-started kind API server) — both are cluster API readiness timing issues, not present in earlier drafts of this step.

- [ ] **Step 4: Write the teardown script**

Create `<ws>/teardown.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
kind delete cluster --name outline-perftest
```

- [ ] **Step 5: Run the creation script and verify**

```bash
chmod +x create-cluster.sh teardown.sh
./create-cluster.sh
```

Expected: ends with "Cluster ready. Context: kind-outline-perftest" and cluster-info output showing the control plane URL.

- [ ] **Step 6: Verify metrics-server is actually reporting data**

```bash
kubectl top node
```

Expected (may take ~30-60s after rollout before data appears — retry if empty): a row showing the `outline-perftest-control-plane` node with CPU/memory numbers, not an error like "metrics not available yet".

- [ ] **Step 7: Commit nothing (no git in this workspace) — just confirm files exist**

```bash
ls kind-config.yaml create-cluster.sh teardown.sh
```

Expected: all three files listed.

---

### Task 2: Deploy Redis

**Files:**
- Create: `<ws>/manifests/redis.yaml`

**Interfaces:**
- Consumes: running kind cluster from Task 1 (context `kind-outline-perftest`).
- Produces: a `redis` Deployment + Service reachable in-cluster at `redis:6379`, which Task 5 (Outline) depends on via `REDIS_URL`.

- [ ] **Step 1: Write the Redis manifest**

Create `<ws>/manifests/redis.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
  labels:
    app: redis
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
        - name: redis
          image: redis:7-alpine
          command: ["redis-server", "--appendonly", "yes"]
          ports:
            - containerPort: 6379
          volumeMounts:
            - name: data
              mountPath: /data
          readinessProbe:
            exec:
              command: ["redis-cli", "ping"]
            initialDelaySeconds: 5
            periodSeconds: 5
          livenessProbe:
            exec:
              command: ["redis-cli", "ping"]
            initialDelaySeconds: 10
            periodSeconds: 10
      volumes:
        - name: data
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: redis
spec:
  selector:
    app: redis
  ports:
    - port: 6379
      targetPort: 6379
```

- [ ] **Step 2: Apply and verify**

```bash
kubectl apply -f manifests/redis.yaml
kubectl rollout status deployment/redis --timeout=60s
```

Expected: `deployment "redis" successfully rolled out`.

- [ ] **Step 3: Verify Redis actually responds**

```bash
kubectl exec deploy/redis -- redis-cli ping
```

Expected: `PONG`.

---

### Task 3: Deploy Postgres

**Files:**
- Create: `<ws>/manifests/postgres.yaml`

**Interfaces:**
- Consumes: `outline-env` Secret (created in Task 4 — see note below on ordering), running kind cluster.
- Produces: a `postgres` Deployment + Service reachable in-cluster at `postgres:5432`, database `outline`, user `outline`. Task 6 (DB restore) and Task 5 (Outline) depend on this.

Note on ordering: this manifest references `envFrom: secretRef: outline-env` for `POSTGRES_PASSWORD`, but the actual secret isn't created until Task 4. That's fine — write and apply this manifest now; the Postgres pod will sit in `CreateContainerConfigError` until Task 4 creates the secret, which we'll confirm resolves it at the start of Task 4.

- [ ] **Step 1: Write the Postgres manifest**

Create `<ws>/manifests/postgres.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  labels:
    app: postgres
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: postgres:15-alpine
          envFrom:
            - secretRef:
                name: outline-env
          env:
            - name: POSTGRES_USER
              value: outline
            - name: POSTGRES_DB
              value: outline
          ports:
            - containerPort: 5432
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", "outline", "-d", "outline"]
            initialDelaySeconds: 5
            periodSeconds: 5
          livenessProbe:
            exec:
              command: ["pg_isready", "-U", "outline", "-d", "outline"]
            initialDelaySeconds: 15
            periodSeconds: 10
      volumes:
        - name: data
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
spec:
  selector:
    app: postgres
  ports:
    - port: 5432
      targetPort: 5432
```

- [ ] **Step 2: Apply it (it will not become Ready yet — that's expected)**

```bash
kubectl apply -f manifests/postgres.yaml
kubectl get pods -l app=postgres
```

Expected: pod present, status likely `CreateContainerConfigError` or `Pending` (missing `outline-env` secret) — do not troubleshoot further here, this resolves in Task 4.

---

### Task 4: Generate and apply the shared secret from `.env`

**Files:**
- Create: `<ws>/generate-secret.sh`
- Create (generated, not hand-written): `<ws>/manifests/outline-secret.yaml`

**Interfaces:**
- Consumes: `site-outline/.env` (must exist and contain at minimum `SECRET_KEY`, `UTILS_SECRET`, `POSTGRES_PASSWORD`, `DATABASE_URL`, `REDIS_URL`, `OUTLINE_API_TOKEN`, OIDC vars).
- Produces: a `Secret/outline-env` in the cluster, consumed via `envFrom` by Postgres (Task 3), and by Outline (Task 5).

- [ ] **Step 1: Write the secret-generation script**

Create `<ws>/generate-secret.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

SITE_OUTLINE_ENV="../site-outline/.env"

if [ ! -f "$SITE_OUTLINE_ENV" ]; then
  echo "Error: $SITE_OUTLINE_ENV not found" >&2
  exit 1
fi

kubectl create secret generic outline-env \
  --from-env-file="$SITE_OUTLINE_ENV" \
  --dry-run=client -o yaml > manifests/outline-secret.yaml

echo "Wrote manifests/outline-secret.yaml"
```

- [ ] **Step 2: Run it and apply**

```bash
chmod +x generate-secret.sh
./generate-secret.sh
kubectl apply -f manifests/outline-secret.yaml
```

Expected: `secret/outline-env created` (or `configured`).

- [ ] **Step 3: Verify the Postgres pod from Task 3 now becomes Ready**

```bash
kubectl rollout status deployment/postgres --timeout=60s
```

Expected: `deployment "postgres" successfully rolled out`.

- [ ] **Step 4: Verify the secret has the expected keys (without printing secret values)**

```bash
kubectl get secret outline-env -o jsonpath='{.data}' | tr ',' '\n' | grep -o '"[A-Z_]*"' | sort
```

Expected: list includes `"SECRET_KEY"`, `"UTILS_SECRET"`, `"POSTGRES_PASSWORD"`, `"DATABASE_URL"`, `"REDIS_URL"`, `"OUTLINE_API_TOKEN"`.

---

### Task 5: Deploy Outline and verify health

**Files:**
- Create: `<ws>/manifests/outline.yaml`

**Interfaces:**
- Consumes: `Secret/outline-env` (Task 4), `Service/postgres` (Task 3), `Service/redis` (Task 2).
- Produces: an `outline` Deployment + Service reachable in-cluster at `http://outline:3000` (ClusterIP, regardless of the NodePort/host-firewall issue — see Environment Note above), which Task 6 (DB restore verification), Task 7 (k6 script, run as an in-cluster Job), and Task 8 (resource matrix) all depend on. Later tasks patch this Deployment's `resources` block in place — the initial values here (`512Mi`/`500m`) are just a safe starting point for health verification, matching the existing draft estimate's request.
- Note: this task's manifest still defines the Service as `type: NodePort` with `nodePort: 30080` — that's harmless to leave as-is (a NodePort Service still provides a ClusterIP too), just unused by later tasks now that load generation runs in-cluster.

- [ ] **Step 1: Write the Outline manifest**

Create `<ws>/manifests/outline.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: outline
  labels:
    app: outline
spec:
  replicas: 1
  selector:
    matchLabels:
      app: outline
  template:
    metadata:
      labels:
        app: outline
    spec:
      containers:
        - name: outline
          image: outlinewiki/outline:1.9.1
          envFrom:
            - secretRef:
                name: outline-env
          ports:
            - containerPort: 3000
          resources:
            requests:
              cpu: 500m
              memory: 512Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /_health
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /_health
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: outline
spec:
  type: NodePort
  selector:
    app: outline
  ports:
    - port: 3000
      targetPort: 3000
      nodePort: 30080
```

- [ ] **Step 2: Apply and wait for rollout**

```bash
kubectl apply -f manifests/outline.yaml
kubectl rollout status deployment/outline --timeout=120s
```

Expected: `deployment "outline" successfully rolled out`.

- [ ] **Step 3: Verify the health endpoint from inside the cluster**

Per the Environment Note in Global Constraints, this host's firewall blocks new inbound NodePort traffic — verify from inside the cluster instead, using `kubectl exec` into the Outline pod itself. **Note: the `outlinewiki/outline` image does not have `curl` installed — use `wget` instead** (confirmed present at `/usr/bin/wget`):

```bash
POD=$(kubectl get pod -l app=outline -o jsonpath='{.items[0].metadata.name}')
kubectl exec "$POD" -- wget -qO- http://localhost:3000/_health
```

Expected: `OK`.

- [ ] **Step 4: Verify the existing API token authenticates (expect an auth failure — DB not restored yet)**

```bash
TOKEN=$(grep '^OUTLINE_API_TOKEN=' ../site-outline/.env | cut -d= -f2)
kubectl exec "$POD" -- wget -qO- --header="Authorization: Bearer ${TOKEN}" --header="Content-Type: application/json" --post-data='{}' http://localhost:3000/api/documents.list
```

Expected: the command fails with exit code 6 (`wget`'s code for an HTTP auth/4xx failure) rather than hanging or the pod crashing — this is expected at this point since the token belongs to a user/team that doesn't exist in this fresh, unrestored database yet. A clean auth failure (not a crash or timeout) confirms Outline itself is healthy and reachable; Task 6 restores the real data so this token starts working.

---

### Task 6: Dump docker-compose Postgres and restore into the cluster

**Files:**
- Create: `<ws>/seed-db.sh`

**Interfaces:**
- Consumes: running `senff-outline-postgres` docker-compose container (must be up), `Service/postgres` in the kind cluster (Task 3/4).
- Produces: the kind cluster's Postgres populated with the real migrated Outline data, making `OUTLINE_API_TOKEN` valid — required by Task 7's k6 script and every later load-test run.

- [ ] **Step 1: Write the seed script**

Create `<ws>/seed-db.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

DUMP_FILE="/tmp/outline-dump.sql"

echo "Dumping docker-compose Postgres..."
docker exec senff-outline-postgres pg_dump -U outline -d outline --clean --if-exists -f /tmp/outline-dump.sql
docker cp senff-outline-postgres:/tmp/outline-dump.sql "$DUMP_FILE"

POSTGRES_POD=$(kubectl get pod -l app=postgres -o jsonpath='{.items[0].metadata.name}')
echo "Restoring into pod $POSTGRES_POD..."
kubectl cp "$DUMP_FILE" "$POSTGRES_POD":/tmp/outline-dump.sql
kubectl exec "$POSTGRES_POD" -- psql -U outline -d outline -f /tmp/outline-dump.sql

echo "Restore complete. Document count:"
kubectl exec "$POSTGRES_POD" -- psql -U outline -d outline -t -c "SELECT count(*) FROM documents;"
```

- [ ] **Step 2: Run it**

```bash
chmod +x seed-db.sh
./seed-db.sh
```

Expected: ends printing a document count greater than 0 (matches whatever was previously migrated into docker-compose's Outline via `scripts/migrate-to-outline.mjs`).

- [ ] **Step 3: Verify the existing API token now works against real data**

Per the Environment Note in Global Constraints, verify from inside the cluster via `kubectl exec` rather than a host curl to the NodePort. The `outlinewiki/outline` image doesn't have `curl` — use `wget` (present at `/usr/bin/wget`), piped into `jq` on the host:

```bash
OUTLINE_POD=$(kubectl get pod -l app=outline -o jsonpath='{.items[0].metadata.name}')
TOKEN=$(grep '^OUTLINE_API_TOKEN=' ../site-outline/.env | cut -d= -f2)
kubectl exec "$OUTLINE_POD" -- wget -qO- --header="Authorization: Bearer ${TOKEN}" --header="Content-Type: application/json" --post-data='{"limit": 5}' http://localhost:3000/api/documents.list | jq '.data | length'
```

Expected: a number greater than 0 (up to 5), confirming authenticated reads now succeed against restored data.

---

### Task 7: Write and smoke-test the k6 load script (runs in-cluster as a Job)

**Files:**
- Create: `<ws>/loadtest/outline-load.js`
- Create: `<ws>/loadtest/smoke-test-job.yaml`

**Interfaces:**
- Consumes: `OUTLINE_URL` and `OUTLINE_API_TOKEN` env vars (injected into the Job's container — `OUTLINE_URL` defaults to `http://outline:3000`, the ClusterIP Service DNS name from Task 5; `OUTLINE_API_TOKEN` comes from `Secret/outline-env`, Task 4), and restored data from Task 6.
- Produces: a reusable k6 default-export function that Task 8's `run-matrix.sh` runs per resource combination as a Kubernetes Job (image `grafana/k6`, script mounted from a ConfigMap), writing a `--summary-export` JSON file with overall `metrics.http_req_duration.values["p(95)"]`/`["p(99)"]`/`metrics.http_req_failed.values.rate`, **plus two separately-tracked custom metrics** — `content_fetch_duration`/`content_fetch_errors` (for `documents.info`, "asking for the content of a document") and `search_duration`/`search_errors` (for `documents.search`) — the exact fields Task 8 parses with `jq` to report each test type independently, not just as one blended average.
- Per the Environment Note in Global Constraints: this runs as an in-cluster Job, not from the host, because the host's Windows Firewall blocks new inbound NodePort traffic. `OUTLINE_URL` defaults to the in-cluster ClusterIP DNS name, not `localhost:30080`.

- [ ] **Step 1: Write the k6 script**

Create `<ws>/loadtest/outline-load.js`:

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE_URL = __ENV.OUTLINE_URL || 'http://outline:3000';
const TOKEN = __ENV.OUTLINE_API_TOKEN;

if (!TOKEN) {
  throw new Error('OUTLINE_API_TOKEN env var is required');
}

const VUS = __ENV.VUS ? Number(__ENV.VUS) : 15;

// Tracked separately so the report can show "fetch document content" and
// "search" as two distinct test types, not just one blended average.
const contentFetchDuration = new Trend('content_fetch_duration');
const contentFetchErrors = new Rate('content_fetch_errors');
const searchDuration = new Trend('search_duration');
const searchErrors = new Rate('search_errors');

export const options = {
  scenarios: {
    steady_state: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: VUS },
        { duration: '120s', target: VUS },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<1.1'], // informational only; we read the rate, not a hard fail gate
  },
};

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

export default function () {
  const listRes = http.post(
    `${BASE_URL}/api/documents.list`,
    JSON.stringify({ limit: 25 }),
    { headers }
  );
  check(listRes, { 'documents.list 200': (r) => r.status === 200 });

  let docs = [];
  try {
    docs = listRes.json('data');
  } catch (e) {
    docs = [];
  }

  if (Array.isArray(docs) && docs.length > 0) {
    const doc = docs[Math.floor(Math.random() * docs.length)];

    // Test type 1: ask for the content of a document.
    const infoRes = http.post(
      `${BASE_URL}/api/documents.info`,
      JSON.stringify({ id: doc.id }),
      { headers }
    );
    contentFetchDuration.add(infoRes.timings.duration);
    const infoOk = check(infoRes, {
      'documents.info 200': (r) => r.status === 200,
      'documents.info has content': (r) => {
        try {
          return (r.json('data.text') || '').length > 0;
        } catch (e) {
          return false;
        }
      },
    });
    contentFetchErrors.add(!infoOk);

    // Test type 2: search across documents.
    const searchRes = http.post(
      `${BASE_URL}/api/documents.search`,
      JSON.stringify({ query: 'a' }),
      { headers }
    );
    searchDuration.add(searchRes.timings.duration);
    const searchOk = check(searchRes, {
      'documents.search 200': (r) => r.status === 200,
      'documents.search returns an array': (r) => {
        try {
          return Array.isArray(r.json('data'));
        } catch (e) {
          return false;
        }
      },
    });
    searchErrors.add(!searchOk);

    if (Math.random() < 0.1) {
      const updateRes = http.post(
        `${BASE_URL}/api/documents.update`,
        JSON.stringify({ id: doc.id, text: doc.text || ' ' }),
        { headers }
      );
      check(updateRes, { 'documents.update 200': (r) => r.status === 200 });
    }
  }

  sleep(1);
}
```

- [ ] **Step 2: Create the ConfigMap holding the script**

```bash
mkdir -p results
kubectl create configmap k6-script --from-file=outline-load.js=loadtest/outline-load.js \
  --dry-run=client -o yaml | kubectl apply -f -
```

Expected: `configmap/k6-script created` (or `configured`).

- [ ] **Step 3: Write a one-off smoke-test Job manifest**

Create `<ws>/loadtest/smoke-test-job.yaml`:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: k6-smoke-test
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: k6
          image: grafana/k6:latest
          # Wrapped in `sh -c` with a trailing sleep so the container stays
          # alive (Running) after k6 exits: `kubectl cp` execs into the
          # container to stream files via tar, which fails once the pod
          # phase is Succeeded/container is Terminated. The sleep gives a
          # window to `kubectl cp` the summary JSON out before cleanup.
          # k6's exit code is captured immediately (ec=$?) and re-raised
          # via `exit $ec` after the sleep, so the Job's success/failure
          # status reflects k6's actual result instead of always being 0
          # (which a plain `; sleep 60` would otherwise mask).
          command:
            - sh
            - -c
            - "k6 run --vus=3 --duration=20s --summary-export=/results/summary.json /scripts/outline-load.js; ec=$?; sleep 60; exit $ec"
          env:
            - name: OUTLINE_URL
              value: "http://outline:3000"
            - name: OUTLINE_API_TOKEN
              valueFrom:
                secretKeyRef:
                  name: outline-env
                  key: OUTLINE_API_TOKEN
          volumeMounts:
            - name: script
              mountPath: /scripts
            - name: results
              mountPath: /results
      volumes:
        - name: script
          configMap:
            name: k6-script
        - name: results
          emptyDir: {}
```

- [ ] **Step 4: Run the smoke-test Job and check its logs**

```bash
kubectl delete job k6-smoke-test --ignore-not-found
kubectl apply -f loadtest/smoke-test-job.yaml
kubectl wait --for=condition=complete job/k6-smoke-test --timeout=60s || kubectl wait --for=condition=failed job/k6-smoke-test --timeout=5s
kubectl logs job/k6-smoke-test
```

Expected: k6 summary output at the end showing `http_req_failed` rate at or near `0.00%`, all `check` names (including `documents.info has content` and `documents.search returns an array`) passing near 100%, and two custom metric blocks (`content_fetch_duration`, `search_duration`) printed in the summary. If `documents.list` checks fail, stop and re-verify Task 6's restore before proceeding.

- [ ] **Step 5: Retrieve the exported JSON summary and verify its fields**

On this Windows/git-bash host, `kubectl cp` needs `MSYS_NO_PATHCONV=1` set, and a plain relative destination path (no leading `/`) — that resolves identically for both `kubectl.exe` and bash/`jq`, avoiding path-mangling ambiguity entirely (an absolute POSIX-style path like `/tmp/...` or `/c/tmp/...` resolves inconsistently between the two and should be avoided). Also note: the actual `grafana/k6:latest` summary-export schema is flatter than typical k6 docs suggest — Trend percentiles are direct children (`.metrics.X["p(95)"]`, no `.values` wrapper) and Rate metrics expose `.value` (not `.values.rate`):

```bash
export MSYS_NO_PATHCONV=1
mkdir -p tmp-out
POD=$(kubectl get pods -l job-name=k6-smoke-test -o jsonpath='{.items[0].metadata.name}')
kubectl cp "${POD}:/results/summary.json" "tmp-out/smoke-summary.json"
jq '.metrics.http_req_duration["p(95)"], .metrics.http_req_failed.value, .metrics.content_fetch_duration["p(95)"], .metrics.content_fetch_errors.value, .metrics.search_duration["p(95)"], .metrics.search_errors.value' tmp-out/smoke-summary.json
```

Expected: six numeric values printed (no `null`/parse errors) — confirms the JSON shape Task 8's `jq` calls rely on, for both the overall metrics and the two per-test-type custom metrics. This also confirms `kubectl cp` can retrieve results out of a completed Job pod, the exact mechanism Task 8 depends on.

- [ ] **Step 6: Clean up the smoke-test Job**

```bash
kubectl delete job k6-smoke-test
```

Expected: `job.batch "k6-smoke-test" deleted`.

---

### Task 8: Build the resource-matrix automation script and smoke-test one combination

**Files:**
- Create: `<ws>/run-matrix.sh`

**Interfaces:**
- Consumes: `Deployment/outline` (Task 5), `ConfigMap/k6-script` + `loadtest/outline-load.js` (Task 7), `Secret/outline-env` for `OUTLINE_API_TOKEN` (read in-cluster by the Job, not by this script on the host).
- Produces: `<ws>/results/matrix-results.csv` with header
  `memory,cpu,p95_ms,p99_ms,error_rate,content_fetch_p95_ms,content_fetch_error_rate,search_p95_ms,search_error_rate,oom_killed,restart_count`
  — one row appended per combination, consumed by Task 10's report generator.
- Per the Environment Note in Global Constraints: k6 runs as an in-cluster Job (image `grafana/k6`, same ConfigMap-mounted script from Task 7), not as a local binary against a NodePort. This script only drives `kubectl` — it never makes an HTTP request to Outline directly.
- **Corrections discovered during Task 7's smoke test, already baked into the script below — do not "fix" these back to their original form:**
  1. `kubectl cp` cannot exec into a completed Job pod (`error: cannot exec into a container in a completed pod`), so the Job's container command appends `touch /results/done` after the k6 run and a short trailing `sleep`, keeping the container alive long enough to retrieve the file. The script polls for that sentinel file rather than using `kubectl wait --for=condition=complete` (which would race the trailing sleep). **k6's exit code is captured (`ec=$?`) and re-exited after the sleep (`exit $ec`) — do not join the commands with plain `;` all the way through, which would discard k6's real exit status and always report the Job as successful even if k6 itself crashed** (a real bug caught in Task 7's review, fixed here).
  2. On this Windows/git-bash host, `kubectl cp` requires `MSYS_NO_PATHCONV=1`, and absolute POSIX-style destination paths (`/tmp/...`, `/c/tmp/...`) resolve inconsistently between `kubectl.exe` and bash/`jq` reading the file back. Use a plain **relative** path (no leading `/`), which resolves identically for both — e.g. a `tmp-out/` directory inside this workspace.
  3. The `grafana/k6:latest` image's `--summary-export` JSON is flatter than typical k6 docs suggest: Trend metric percentiles are direct children (`.metrics.<name>["p(95)"]`, no `.values` wrapper), and Rate metrics expose their rate as `.value` (0.0–1.0), not `.values.rate`.

- [ ] **Step 1: Write the matrix driver script**

Create `<ws>/run-matrix.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export MSYS_NO_PATHCONV=1

RESULTS_FILE="results/matrix-results.csv"
mkdir -p results tmp-out

if [ ! -f "$RESULTS_FILE" ]; then
  echo "memory,cpu,p95_ms,p99_ms,error_rate,content_fetch_p95_ms,content_fetch_error_rate,search_p95_ms,search_error_rate,oom_killed,restart_count" > "$RESULTS_FILE"
fi

run_k6_job() {
  local k6_out="$1"

  kubectl delete job k6-loadtest --ignore-not-found >/dev/null
  cat <<'EOF' | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: k6-loadtest
spec:
  backoffLimit: 0
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: k6
          image: grafana/k6:latest
          command:
            - sh
            - -c
            - "k6 run --vus=15 --duration=2m --summary-trend-stats='avg,min,med,max,p(90),p(95),p(99)' --summary-export=/results/summary.json /scripts/outline-load.js; ec=$?; touch /results/done; sleep 20; exit $ec"
          env:
            - name: OUTLINE_URL
              value: "http://outline:3000"
            - name: OUTLINE_API_TOKEN
              valueFrom:
                secretKeyRef:
                  name: outline-env
                  key: OUTLINE_API_TOKEN
          volumeMounts:
            - name: script
              mountPath: /scripts
            - name: results
              mountPath: /results
      volumes:
        - name: script
          configMap:
            name: k6-script
        - name: results
          emptyDir: {}
EOF

  local k6_pod
  # Poll until the pod exists and is running (k6 needs a few seconds to be scheduled/started).
  local waited=0
  k6_pod=""
  while [ -z "$k6_pod" ] && [ "$waited" -lt 30 ]; do
    k6_pod=$(kubectl get pods -l job-name=k6-loadtest -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    [ -z "$k6_pod" ] && sleep 2 && waited=$((waited + 2))
  done
  [ -n "$k6_pod" ] || { echo "k6 pod never appeared" >&2; return 1; }

  # k6's own run takes ~2m30s (20s ramp-up + 120s steady + 10s ramp-down, plus
  # scheduling/pull time); poll for the /results/done sentinel rather than
  # kubectl wait --for=condition=complete, which would race the trailing sleep.
  waited=0
  until kubectl exec "$k6_pod" -- test -f /results/done 2>/dev/null; do
    sleep 5
    waited=$((waited + 5))
    if [ "$waited" -ge 240 ]; then
      echo "Timed out waiting for k6 job to finish (mem/cpu combo may be too resource-starved to even run k6's own client fairly, or Outline itself is unresponsive)" >&2
      break
    fi
  done

  kubectl cp "${k6_pod}:/results/summary.json" "$k6_out"
}

run_one() {
  local mem="$1"
  local cpu="$2"

  echo "=== Testing memory=$mem cpu=$cpu ==="
  kubectl set resources deployment/outline -c outline \
    --limits="cpu=${cpu},memory=${mem}" \
    --requests="cpu=${cpu},memory=${mem}"
  kubectl rollout status deployment/outline --timeout=120s
  sleep 5

  local pod
  # Filter to Running pods only: immediately after a rollout, the API server
  # can briefly still list the old (Terminating) pod alongside the new one
  # under the same `app=outline` label, and an unfiltered items[0] lookup can
  # nondeterministically pick the pod that's about to be deleted -- causing a
  # "not found" error later when this pod's restart count is queried.
  pod=$(kubectl get pod -l app=outline --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}')

  local top_log="tmp-out/top-${mem}-${cpu}.log"
  : > "$top_log"
  ( while true; do kubectl top pod "$pod" --no-headers >> "$top_log" 2>&1 || true; sleep 10; done ) &
  local sampler_pid=$!

  local k6_out="tmp-out/k6-${mem}-${cpu}.json"
  run_k6_job "$k6_out"

  kill "$sampler_pid" 2>/dev/null || true
  wait "$sampler_pid" 2>/dev/null || true

  local restart_count
  restart_count=$(kubectl get pod "$pod" -o jsonpath='{.status.containerStatuses[0].restartCount}')
  local last_reason
  last_reason=$(kubectl get pod "$pod" -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason}' 2>/dev/null || echo "")
  local oom_flag="no"
  [ "$last_reason" = "OOMKilled" ] && oom_flag="yes"

  local p95 p99 err_rate content_p95 content_err search_p95 search_err
  p95=$(jq '.metrics.http_req_duration["p(95)"]' "$k6_out")
  p99=$(jq '.metrics.http_req_duration["p(99)"]' "$k6_out")
  err_rate=$(jq '.metrics.http_req_failed.value' "$k6_out")
  content_p95=$(jq '.metrics.content_fetch_duration["p(95)"] // "NA"' "$k6_out")
  content_err=$(jq '.metrics.content_fetch_errors.value // "NA"' "$k6_out")
  search_p95=$(jq '.metrics.search_duration["p(95)"] // "NA"' "$k6_out")
  search_err=$(jq '.metrics.search_errors.value // "NA"' "$k6_out")

  echo "${mem},${cpu},${p95},${p99},${err_rate},${content_p95},${content_err},${search_p95},${search_err},${oom_flag},${restart_count}" >> "$RESULTS_FILE"
  echo "--- result: mem=$mem cpu=$cpu p95=${p95}ms err_rate=${err_rate} content_p95=${content_p95}ms search_p95=${search_p95}ms oom=${oom_flag} restarts=${restart_count} ---"
}

if [ "$#" -eq 2 ]; then
  # Single-combination mode, e.g. ./run-matrix.sh 768Mi 1000m — used for smoke-testing.
  run_one "$1" "$2"
  exit 0
fi

MEMORY_VALUES=(256Mi 384Mi 512Mi 768Mi)
CPU_VALUES=(250m 500m 1000m)

for mem in "${MEMORY_VALUES[@]}"; do
  for cpu in "${CPU_VALUES[@]}"; do
    if ! run_one "$mem" "$cpu"; then
      echo "!!! combination mem=$mem cpu=$cpu FAILED, continuing to next !!!" >&2
      echo "${mem},${cpu},FAILED,FAILED,FAILED,FAILED,FAILED,FAILED,FAILED,FAILED,FAILED" >> "$RESULTS_FILE"
    fi
  done
done

echo "Matrix complete. Results in $RESULTS_FILE"
```

- [ ] **Step 2: Make it executable and smoke-test ONE combination only**

```bash
chmod +x run-matrix.sh
./run-matrix.sh 768Mi 1000m
```

Expected: prints `=== Testing memory=768Mi cpu=1000m ===`, then after ~2.5-3 minutes (the Job runs the same 15-VU/2m load as Task 7's smoke test, just against a resource-patched Deployment, plus the trailing sentinel-poll overhead) prints a `--- result: ... ---` line with `oom=no` and a low `err_rate` (near 0), and `results/matrix-results.csv` contains exactly one data row. Per Task 7's finding, `content_p95`/`content_err` (from `documents.info has content`) may show a non-trivial error rate (~50% was observed in Task 7's smoke test) even when `err_rate` (overall HTTP status) is ~0 — this is expected, known Outline behavior unrelated to resource limits, not a sign this task's script is broken. Judge pass/fail on `err_rate`, `oom_flag`, and `restart_count`, not on `content_err`.

- [ ] **Step 3: Verify the CSV content**

```bash
cat results/matrix-results.csv
```

Expected: header row + one row like
`768Mi,1000m,<number>,<number>,<number>,<number>,<number>,<number>,<number>,no,0`
(memory, cpu, overall p95/p99/error_rate, then content-fetch p95/error_rate,
then search p95/error_rate, then oom_killed/restart_count).

---

### Task 9: Run the full 12-combination matrix

**Files:**
- Modify: none (reuses `run-matrix.sh` from Task 8)
- Produces: `<ws>/results/matrix-results.csv` fully populated

**Interfaces:**
- Consumes: everything from Tasks 1-8.
- Produces: complete results data for Task 10's report.

- [ ] **Step 1: Clear the smoke-test row and run the full matrix**

```bash
rm -f results/matrix-results.csv
./run-matrix.sh
```

Expected: runs all 12 combinations (~30-40 minutes total: 12 × ~2.5 min each), printing a `--- result: ... ---` line after each. This step legitimately takes a long time — do not interrupt it.

- [ ] **Step 2: Verify all 12 rows are present**

```bash
wc -l results/matrix-results.csv
```

Expected: `13` (1 header + 12 data rows).

- [ ] **Step 3: Sanity-check the results visually**

```bash
column -s, -t results/matrix-results.csv
```

Expected: a readable table; skim it for the general shape — lower memory/CPU combos should show either higher `err_rate`/`p95` or `oom_killed=yes`, while higher combos should be clean. If EVERY combination (including `256Mi`/`250m`) passes cleanly, note this — Task 10 should flag that the floor may be even lower than what was tested, per the spec's guidance to keep pushing down if everything passes easily.

---

### Task 10: Generate the pt-BR summary report

**Files:**
- Create: `<ws>/results/relatorio-resultados.md`

**Interfaces:**
- Consumes: `<ws>/results/matrix-results.csv` (Task 9).
- Produces: a pt-BR markdown report — the final deliverable requested by the user.

- [ ] **Step 1: Read the results and identify the recommended combination**

```bash
column -s, -t results/matrix-results.csv
```

**The actual Task 9 data is non-monotonic — do not mechanically pick "the lowest memory×CPU combination that happens to pass" as the recommendation.** Specifically: `256Mi` passes cleanly at `250m`/`500m` CPU but OOMs at `1000m`; `384Mi` (MORE memory than 256Mi) OOMs at ALL THREE CPU levels — worse than 256Mi despite having more memory; `512Mi/250m` fails via severe CPU throttling (24.5% error rate, p95≈10s) with no OOM, while `512Mi/500m` and `512Mi/1000m` pass cleanly; all three `768Mi` combinations pass cleanly (though `768Mi/250m` shows elevated latency, ~2s p95, without errors). This pattern is plausible, real behavior — likely Node.js/V8's heap-sizing heuristics reacting non-linearly to different cgroup memory limits (a larger limit can cause V8 to size a larger, more failure-prone heap than a smaller limit does) — not a data-collection bug.

Given this, the recommendation must reflect **robustness across CPU levels**, not just the single lowest passing row:
- Treat `384Mi` as a memory value to explicitly warn against (it fails at every CPU level tested, worse than the lower `256Mi`).
- `256Mi` passing at `250m`/`500m` should be reported as an observed result, but flagged as **fragile/not recommended for reliance** given the surrounding instability (it fails at `1000m`, and the same class of memory-sizing sensitivity that breaks `384Mi` could plausibly affect `256Mi` under slightly different conditions).
- The most **robust** recommendation is the combination that passed cleanly across every CPU level tested at that memory tier — `768Mi` is the only tier that does this (all three CPU levels clean). `512Mi` is a viable secondary option but requires at least `500m` CPU (fails at `250m`).
- Also note the previously proposed draft estimate (`250m/512Mi` request, `500m/768Mi` limit, from `site-outline/README.md`) for direct comparison — the data suggests the `768Mi` limit was reasonable, but `250m` CPU is risky at that memory tier (elevated latency) and clearly insufficient at `512Mi` (severe throttling).

- [ ] **Step 2: Write the report**

Create `<ws>/results/relatorio-resultados.md` with this structure (fill in the actual numbers from the CSV read in Step 1 — every `<...>` placeholder below must be replaced with real data, none should remain in the final file):

```markdown
# Relatório de Testes de Performance — Outline no Kubernetes

## Objetivo

Determinar o menor request/limit de CPU e memória que o Outline suporta de
forma estável em Kubernetes, sob uma carga simulada realista de uso do MVP,
para validar (ou corrigir) a estimativa de recursos já rascunhada no
`site-outline/README.md`.

## Metodologia

- Cluster `kind` local, descartável, com Postgres e Redis restaurados a
  partir do banco de dados real do docker-compose (mesmos `SECRET_KEY` /
  `UTILS_SECRET`, então o `OUTLINE_API_TOKEN` existente funcionou sem
  alterações).
- Carga gerada com k6: 15 usuários virtuais, ~20s de ramp-up, 2 minutos em
  regime permanente, mix de ~90% leitura (`documents.list`,
  `documents.info`, `documents.search`) e ~10% escrita
  (`documents.update`) — sem tocar o banco de dados real usado no
  docker-compose (o teste rodou contra uma cópia restaurada no cluster).
- Matriz testada: memória `256Mi, 384Mi, 512Mi, 768Mi` × CPU
  `250m, 500m, 1000m` (12 combinações), cada uma com request = limit.
- Critério de aprovação: sem `OOMKilled`, sem reinícios do pod, e taxa de
  erro/latência sem degradação perceptível durante a janela de carga.

## Resultados gerais

<tabela completa com todas as 12 combinações, copiada/formatada a partir de
results/matrix-results.csv: memória, CPU, p95 (ms), p99 (ms), taxa de erro
geral, OOMKilled, reinícios>

## Resultados por tipo de teste

Dois tipos de operação foram medidos separadamente para não esconder
diferenças de comportamento por trás de uma média geral:

- **Busca de conteúdo de documento** (`documents.info`)
- **Busca textual** (`documents.search`)

<tabela com memória, CPU, p95 de busca de conteúdo (ms), taxa de erro de
busca de conteúdo, p95 de busca textual (ms), taxa de erro de busca textual —
colunas content_fetch_p95_ms/content_fetch_error_rate/search_p95_ms/search_error_rate
do CSV. Comentar se um dos dois tipos se degrada antes do outro conforme os
recursos diminuem.>

## Comparação com a estimativa anterior

A estimativa rascunhada no README propunha `250m CPU / 512Mi` de request e
`500m CPU / 768Mi` de limit. <declarar aqui se o teste confirma essa
estimativa, se ela pode ser reduzida, ou se precisa ser aumentada, citando
os números observados>

## Recomendação

<combinação mínima recomendada de request/limit, com uma frase justificando
com base nos números observados>

## Observações

<qualquer observação relevante notada durante os testes: por exemplo, se
todas as combinações passaram facilmente (sugerindo que o piso real é ainda
mais baixo do que o testado), ou se algum comportamento inesperado ocorreu>
```

- [ ] **Step 3: Verify the report has no placeholder text remaining**

```bash
grep -n '<.*>' results/relatorio-resultados.md || echo "No placeholders found"
```

Expected: `No placeholders found` — if any `<...>` markers remain, go back and fill them with the actual data from the CSV before considering this task done.

---

### Task 11: Tear down the cluster

**Files:** none (uses `<ws>/teardown.sh` from Task 1)

**Interfaces:**
- Consumes: the running kind cluster.
- Produces: a clean local Docker environment, no lingering `kind` containers.

- [ ] **Step 1: Confirm the report exists before tearing down (results live only on the CSV/markdown files, not in the cluster, but double-check nothing else was meant to be extracted)**

```bash
ls results/matrix-results.csv results/relatorio-resultados.md
```

Expected: both files listed.

- [ ] **Step 2: Tear down the cluster**

```bash
./teardown.sh
```

Expected: `Deleting cluster "outline-perftest" ...` followed by success, no errors.

- [ ] **Step 3: Verify no kind containers remain**

```bash
docker ps -a --filter "name=outline-perftest"
```

Expected: empty output (just the header row) — cluster fully removed.
