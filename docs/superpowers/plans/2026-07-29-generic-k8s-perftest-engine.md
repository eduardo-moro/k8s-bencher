# Generic K8s Perftest Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn this repo from an Outline-specific, WSL-only resource-sizing workspace into a generic, Windows-native (PowerShell) tool that right-sizes CPU/memory for any single containerized service, driven by per-app config/manifest/k6-script files.

**Architecture:** A PowerShell module (`modules/Perftest.psm1`) holds all logic as testable functions (cluster lifecycle, config parsing, app deploy, k6 script publishing, resource-matrix execution). `perftest.ps1` is a thin CLI shell over that module. Per-app artifacts (`manifests/<app>.yaml`, `loadtest/<app>.js`, `configs/<app>.yaml`) are real, gitignored files a dev creates by copying `templates/`; the engine applies/runs them as-is rather than rendering templates.

**Tech Stack:** PowerShell 7+ (`pwsh`), `powershell-yaml` module (YAML parsing — not in PowerShell core), `kind`, `kubectl`, `k6`, Docker Desktop, Pester 5+ (unit tests).

## Global Constraints

- Design source of truth: `docs/superpowers/specs/2026-07-29-generic-k8s-perftest-design.md`. Every task below implements one part of it — read it if a step's rationale is unclear.
- No documentation work this round (explicit non-goal in the spec): no README rewrites, no new docs beyond code comments where genuinely non-obvious.
- Windows-native: all scripts run directly under `pwsh`, no WSL/MSYS assumptions, no `jq` (use `ConvertFrom-Json`/`ConvertTo-Json`).
- All file paths in configs are resolved relative to the repo root (the directory containing `perftest.ps1`), matching today's `cd "$(dirname "$0")"` convention in the bash scripts being replaced.
- Convention (needed because `configs/<app>.yaml` only has one `container` field, not separate Deployment/Service/label names): in `manifests/<app>.yaml`, the Deployment's `metadata.name`, its container's `name`, and its pod template's `app` label must all equal the config's `container` value. `templates/manifest.example.yaml` must demonstrate this.
- `loadtest/<app>.js` hardcodes its own target URL (e.g. `http://<service-name>:<port>`) the same way `outline-load.js` hardcodes `http://outline:3000` today — there is no `BASE_URL`/port field in `configs/<app>.yaml`. Only `VUS` is passed in as an env var; load *stages* are passed to `k6 run` as repeated `--stage <duration>:<target>` CLI flags, not read by the script itself.
- Tests run for real against the actual tools installed on this machine (`kind`, `kubectl`, `k6`, Docker Desktop are confirmed present and working) wherever a task's deliverable is cluster-facing. Pure-logic functions (config parsing, resource cross-product) get Pester unit tests instead of a real cluster.

---

### Task 1: Remove Outline-specific content, lay out the new folder skeleton, update `.gitignore`

**Files:**
- Delete: `manifests/outline.yaml`, `manifests/postgres.yaml`, `manifests/redis.yaml`, `manifests/outline-secret.yaml` (if present), `loadtest/outline-load.js`, `loadtest/smoke-test-job.yaml`, `generate-secret.sh`, `seed-db.sh`, `create-cluster.sh`, `run-matrix.sh`, `teardown.sh`, `kind-config.yaml` (old root-level copy — replaced under `manifests/` in Task 2), `plans/2026-07-24-outline-k8s-perf-testing-plan.md`, `specs/2026-07-24-outline-k8s-perf-testing-design.md`, `relatorio-resultados.md`, `results/matrix-results-2026-07-29.csv`, and the `results/`, `tmp-out/`, `plans/`, `specs/` directories themselves once empty.
- Create (empty dirs need a placeholder to be tracked by git): `configs/.gitkeep`, `frontend/.gitkeep`
- Modify: `.gitignore`

- [ ] **Step 1: Delete the old Outline-specific files and folders**

```bash
cd "c:\Users\e.moro\source\k8s-perftest"
git rm -r manifests/outline.yaml manifests/postgres.yaml manifests/redis.yaml \
  loadtest/outline-load.js loadtest/smoke-test-job.yaml \
  generate-secret.sh seed-db.sh create-cluster.sh run-matrix.sh teardown.sh \
  kind-config.yaml plans specs relatorio-resultados.md results
rm -rf tmp-out
```

(`manifests/outline-secret.yaml` is gitignored and was never committed — nothing to `git rm` there; delete the file directly if it exists locally: `rm -f manifests/outline-secret.yaml`.)

**Step 1 checkpoint:** `git status` should show the above as staged deletions, and `ls manifests loadtest` should show empty directories (git doesn't track empty dirs — that's expected and fixed by Task 2/4's `.gitkeep`/real files).

- [ ] **Step 2: Create placeholders for directories that would otherwise be empty**

```bash
mkdir -p configs frontend
touch configs/.gitkeep frontend/.gitkeep
```

(`manifests/` and `loadtest/` get real committed files in later tasks — `kind-config.yaml`/`k6-job-template.yaml` in Task 2/5 — so they don't need `.gitkeep`.)

- [ ] **Step 3: Rewrite `.gitignore`**

Replace the full contents of `.gitignore` with:

```gitignore
# Per-app artifacts are local to each dev/app — never committed. Only the
# infra-level files below (kind cluster config, k6 Job wrapper) are tracked.
manifests/*.yaml
!manifests/kind-config.yaml
!manifests/k6-job-template.yaml
loadtest/*.js
configs/*.yaml

# Every test run's raw output.
output/

.claude/
.superpowers/
```

- [ ] **Step 4: Verify the ignore rules work as intended**

```bash
mkdir -p manifests loadtest
touch manifests/kind-config.yaml manifests/k6-job-template.yaml manifests/my-app.yaml
touch loadtest/my-app.js
touch configs/my-app.yaml
git status --porcelain --ignored=matching manifests loadtest configs
```

Expected: `manifests/kind-config.yaml` and `manifests/k6-job-template.yaml` show as untracked (`??`), ready to be added normally in later tasks; `manifests/my-app.yaml`, `loadtest/my-app.js`, and `configs/my-app.yaml` show as ignored (`!!`).

- [ ] **Step 5: Clean up the verification files and commit**

```bash
rm manifests/my-app.yaml manifests/kind-config.yaml manifests/k6-job-template.yaml loadtest/my-app.js configs/my-app.yaml
git add .gitignore configs/.gitkeep frontend/.gitkeep
git add -u
git commit -m "Remove Outline-specific content, lay out generic folder skeleton"
```

---

### Task 2: Generic kind cluster config + cluster lifecycle functions

**Files:**
- Create: `manifests/kind-config.yaml`
- Create: `modules/Perftest.psm1`
- Test: manual verification via real `kind`/`kubectl` (Pester not useful here — this is pure orchestration of external processes with no branching logic worth unit-testing in isolation)

**Interfaces:**
- Produces: `New-PerftestCluster [-ClusterName <string> = 'k8s-perftest']` (no return value; throws on failure), `Remove-PerftestCluster [-ClusterName <string> = 'k8s-perftest']` (no return value).

- [ ] **Step 1: Create `manifests/kind-config.yaml`**

```yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: k8s-perftest
nodes:
  - role: control-plane
    extraPortMappings:
      - containerPort: 30080
        hostPort: 30080
        protocol: TCP
```

- [ ] **Step 2: Create `modules/Perftest.psm1` with `New-PerftestCluster` and `Remove-PerftestCluster`**

```powershell
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-PerftestCluster {
    [CmdletBinding()]
    param(
        [string]$ClusterName = 'k8s-perftest'
    )

    $existing = kind get clusters 2>$null
    if ($existing -contains $ClusterName) {
        Write-Host "Cluster '$ClusterName' already exists, skipping creation."
        kubectl config use-context "kind-$ClusterName" | Out-Null
        return
    }

    $repoRoot = Split-Path -Parent $PSScriptRoot
    kind create cluster --name $ClusterName --config (Join-Path $repoRoot 'manifests/kind-config.yaml')
    if ($LASTEXITCODE -ne 0) { throw "kind create cluster failed with exit code $LASTEXITCODE" }

    Write-Host "Waiting for cluster to stabilize (30 seconds)..."
    Start-Sleep -Seconds 30

    Write-Host "Installing metrics-server..."
    kubectl apply --validate=false -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
    if ($LASTEXITCODE -ne 0) { throw "metrics-server apply failed with exit code $LASTEXITCODE" }

    # kind nodes use self-signed kubelet certs; metrics-server needs this flag
    # to scrape them, or `kubectl top pod` stays empty forever.
    kubectl patch deployment metrics-server -n kube-system --type='json' `
        -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
    if ($LASTEXITCODE -ne 0) { throw "metrics-server patch failed with exit code $LASTEXITCODE" }

    Write-Host "Waiting for metrics-server rollout..."
    kubectl -n kube-system rollout status deployment/metrics-server --timeout=120s
    if ($LASTEXITCODE -ne 0) { throw "metrics-server rollout failed with exit code $LASTEXITCODE" }

    Write-Host "Cluster ready. Context: kind-$ClusterName"
}

function Remove-PerftestCluster {
    [CmdletBinding()]
    param(
        [string]$ClusterName = 'k8s-perftest'
    )
    kind delete cluster --name $ClusterName
    if ($LASTEXITCODE -ne 0) { throw "kind delete cluster failed with exit code $LASTEXITCODE" }
}

Export-ModuleMember -Function New-PerftestCluster, Remove-PerftestCluster
```

- [ ] **Step 3: Verify cluster creation and teardown for real**

```bash
pwsh -NoProfile -Command "Import-Module ./modules/Perftest.psm1 -Force; New-PerftestCluster"
kind get clusters
kubectl get nodes
kubectl -n kube-system get deployment metrics-server
```

Expected: `kind get clusters` lists `k8s-perftest`; `kubectl get nodes` shows one `Ready` node; `metrics-server` deployment shows `1/1` ready.

```bash
pwsh -NoProfile -Command "Import-Module ./modules/Perftest.psm1 -Force; Remove-PerftestCluster"
kind get clusters
```

Expected: cluster no longer listed (or "No kind clusters found").

- [ ] **Step 4: Commit**

```bash
git add manifests/kind-config.yaml modules/Perftest.psm1
git commit -m "Add generic kind cluster config and cluster lifecycle functions"
```

---

### Task 3: Config parsing and resource-matrix cross product

**Files:**
- Modify: `modules/Perftest.psm1` (add `Get-PerftestConfig`, `Get-PerftestResourceCombos`)
- Test: `modules/Perftest.Tests.ps1` (Pester)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `Get-PerftestConfig -Path <string>` → `[PSCustomObject]` with properties `name` (string), `manifest` (string, resolved to an absolute path), `container` (string), `script` (string, resolved to an absolute path), `resources` (`@{ memory = [string[]]; cpu = [string[]] }`), `load` (`@{ vus = [int]; stages = [PSCustomObject[]] }`, each stage having `duration` and `target`). Throws `System.Exception` with a descriptive message if `manifest`, `container`, `script`, `resources.memory`, or `resources.cpu` is missing.
  - `Get-PerftestResourceCombos -Resources <PSCustomObject>` → `[PSCustomObject[]]`, each with `memory` and `cpu` properties — the full cross product of `Resources.memory` × `Resources.cpu`, in nested-loop order (outer = memory, inner = cpu), matching today's `run-matrix.sh` iteration order.

- [ ] **Step 1: Write the failing Pester tests**

Create `modules/Perftest.Tests.ps1`:

```powershell
BeforeAll {
    Import-Module "$PSScriptRoot/Perftest.psm1" -Force
    $script:fixtureDir = Join-Path ([System.IO.Path]::GetTempPath()) "perftest-tests-$(Get-Random)"
    New-Item -ItemType Directory -Path $fixtureDir | Out-Null
}

AfterAll {
    Remove-Item -Recurse -Force $fixtureDir -ErrorAction SilentlyContinue
}

Describe 'Get-PerftestConfig' {
    It 'parses a valid config and resolves manifest/script to absolute paths' {
        $configPath = Join-Path $fixtureDir 'app.yaml'
        @'
name: my-app
manifest: manifests/my-app.yaml
container: app
script: loadtest/my-app.js
resources:
  memory: [256Mi, 512Mi]
  cpu: [250m, 500m]
load:
  vus: 15
  stages:
    - {duration: 20s, target: 15}
    - {duration: 10s, target: 0}
'@ | Set-Content -Path $configPath

        $config = Get-PerftestConfig -Path $configPath -RepoRoot $fixtureDir

        $config.name | Should -Be 'my-app'
        $config.container | Should -Be 'app'
        $config.manifest | Should -Be (Join-Path $fixtureDir 'manifests/my-app.yaml')
        $config.script | Should -Be (Join-Path $fixtureDir 'loadtest/my-app.js')
        $config.resources.memory | Should -Be @('256Mi', '512Mi')
        $config.resources.cpu | Should -Be @('250m', '500m')
        $config.load.vus | Should -Be 15
        $config.load.stages.Count | Should -Be 2
        $config.load.stages[0].duration | Should -Be '20s'
        $config.load.stages[0].target | Should -Be 15
    }

    It 'throws when a required field is missing' {
        $configPath = Join-Path $fixtureDir 'bad.yaml'
        @'
name: my-app
container: app
script: loadtest/my-app.js
resources:
  memory: [256Mi]
  cpu: [250m]
load:
  vus: 15
  stages: []
'@ | Set-Content -Path $configPath

        { Get-PerftestConfig -Path $configPath -RepoRoot $fixtureDir } | Should -Throw '*manifest*'
    }
}

Describe 'Get-PerftestResourceCombos' {
    It 'returns the full cross product in memory-outer, cpu-inner order' {
        $resources = [PSCustomObject]@{ memory = @('256Mi', '512Mi'); cpu = @('250m', '500m') }
        $combos = Get-PerftestResourceCombos -Resources $resources

        $combos.Count | Should -Be 4
        $combos[0].memory | Should -Be '256Mi'
        $combos[0].cpu | Should -Be '250m'
        $combos[1].memory | Should -Be '256Mi'
        $combos[1].cpu | Should -Be '500m'
        $combos[2].memory | Should -Be '512Mi'
        $combos[2].cpu | Should -Be '250m'
        $combos[3].memory | Should -Be '512Mi'
        $combos[3].cpu | Should -Be '500m'
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.0; Invoke-Pester ./modules/Perftest.Tests.ps1"
```

Expected: FAIL — `Get-PerftestConfig`/`Get-PerftestResourceCombos` not recognized as the names of a cmdlet.

- [ ] **Step 3: Implement `Get-PerftestConfig` and `Get-PerftestResourceCombos`**

Append to `modules/Perftest.psm1` (and add `Get-PerftestConfig`, `Get-PerftestResourceCombos` to the `Export-ModuleMember -Function` list):

```powershell
function Assert-PerftestYamlModule {
    if (-not (Get-Module -ListAvailable -Name powershell-yaml)) {
        Write-Host "Installing powershell-yaml module (one-time)..."
        Install-Module -Name powershell-yaml -Scope CurrentUser -Force -ErrorAction Stop
    }
    Import-Module powershell-yaml -ErrorAction Stop
}

function Get-PerftestConfig {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Path,
        [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot)
    )

    Assert-PerftestYamlModule
    $raw = Get-Content -Path $Path -Raw | ConvertFrom-Yaml

    foreach ($required in 'manifest', 'container', 'script') {
        if (-not $raw.ContainsKey($required) -or [string]::IsNullOrWhiteSpace($raw[$required])) {
            throw "Config '$Path' is missing required field '$required'."
        }
    }
    if (-not $raw.ContainsKey('resources') -or -not $raw.resources.ContainsKey('memory') -or -not $raw.resources.memory) {
        throw "Config '$Path' is missing required field 'resources.memory'."
    }
    if (-not $raw.resources.ContainsKey('cpu') -or -not $raw.resources.cpu) {
        throw "Config '$Path' is missing required field 'resources.cpu'."
    }

    $stages = @()
    foreach ($stage in $raw.load.stages) {
        $stages += [PSCustomObject]@{ duration = [string]$stage.duration; target = [int]$stage.target }
    }

    [PSCustomObject]@{
        name      = $raw.name
        manifest  = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $raw.manifest))
        container = $raw.container
        script    = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $raw.script))
        resources = [PSCustomObject]@{
            memory = @($raw.resources.memory)
            cpu    = @($raw.resources.cpu)
        }
        load      = [PSCustomObject]@{
            vus    = [int]$raw.load.vus
            stages = $stages
        }
    }
}

function Get-PerftestResourceCombos {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Resources
    )

    $combos = @()
    foreach ($memory in $Resources.memory) {
        foreach ($cpu in $Resources.cpu) {
            $combos += [PSCustomObject]@{ memory = $memory; cpu = $cpu }
        }
    }
    $combos
}
```

Also update the `Export-ModuleMember` line at the bottom of the file to:

```powershell
Export-ModuleMember -Function New-PerftestCluster, Remove-PerftestCluster, Get-PerftestConfig, Get-PerftestResourceCombos
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pwsh -NoProfile -Command "Import-Module Pester -MinimumVersion 5.0; Invoke-Pester ./modules/Perftest.Tests.ps1"
```

Expected: PASS, 3 tests, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add modules/Perftest.psm1 modules/Perftest.Tests.ps1
git commit -m "Add config parsing and resource-matrix cross product, with Pester tests"
```

---

### Task 4: Example templates (httpbin) + app deploy + k6 script publishing

**Files:**
- Create: `templates/manifest.example.yaml`, `templates/loadtest.example.js`, `templates/config.example.yaml`
- Modify: `modules/Perftest.psm1` (add `Deploy-PerftestApp`, `Publish-PerftestLoadScript`)

**Interfaces:**
- Consumes: `Get-PerftestConfig` output shape from Task 3 (`.manifest`, `.container`, `.script`).
- Produces: `Deploy-PerftestApp -Config <PSCustomObject>` (applies the manifest, waits for rollout, no return value), `Publish-PerftestLoadScript -Config <PSCustomObject>` (creates/updates the `k6-script` ConfigMap, no return value).

- [ ] **Step 1: Create `templates/manifest.example.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: httpbin
  labels:
    app: httpbin
spec:
  replicas: 1
  # Recreate (not the default RollingUpdate) guarantees exactly one pod exists
  # at a time — Invoke-PerftestMatrix patches resources between combos, and a
  # stale pod lingering alongside a resource-starved one would contaminate
  # results with requests that never hit the tier actually under test.
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: httpbin
  template:
    metadata:
      labels:
        app: httpbin
    spec:
      containers:
        - name: httpbin
          image: kennethreitz/httpbin:latest
          ports:
            - containerPort: 80
          resources:
            requests:
              cpu: 500m
              memory: 512Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /status/200
              port: 80
            initialDelaySeconds: 5
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /status/200
              port: 80
            initialDelaySeconds: 10
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: httpbin
spec:
  selector:
    app: httpbin
  ports:
    - port: 80
      targetPort: 80
```

(Deployment name, container name, and pod label all read `httpbin` — matching the convention in this plan's Global Constraints, since `configs/config.example.yaml`'s `container: httpbin` is used to patch resources on all three identically-named things.)

- [ ] **Step 2: Create `templates/loadtest.example.js`**

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

// Target URL is hardcoded to this app's own Service/port — not a config
// field, since only the dev writing this script knows its shape.
const BASE_URL = 'http://httpbin:80';
const VUS = __ENV.VUS ? Number(__ENV.VUS) : 15;

export default function () {
  const res = http.get(`${BASE_URL}/get`);
  check(res, { 'GET /get 200': (r) => r.status === 200 });
  sleep(1);
}
```

- [ ] **Step 3: Create `templates/config.example.yaml`**

```yaml
name: httpbin-example
manifest: manifests/httpbin.yaml
container: httpbin
script: loadtest/httpbin.js
resources:
  memory: [128Mi, 256Mi]
  cpu: [100m, 250m]
load:
  vus: 15
  stages:
    - {duration: 10s, target: 15}
    - {duration: 30s, target: 15}
    - {duration: 5s, target: 0}
```

- [ ] **Step 4: Implement `Deploy-PerftestApp` and `Publish-PerftestLoadScript`**

Append to `modules/Perftest.psm1` (and add both names to `Export-ModuleMember`):

```powershell
function Deploy-PerftestApp {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Config
    )

    kubectl apply -f $Config.manifest
    if ($LASTEXITCODE -ne 0) { throw "kubectl apply of '$($Config.manifest)' failed with exit code $LASTEXITCODE" }

    kubectl rollout status "deployment/$($Config.container)" --timeout=120s
    if ($LASTEXITCODE -ne 0) { throw "rollout of deployment/$($Config.container) failed with exit code $LASTEXITCODE" }
}

function Publish-PerftestLoadScript {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Config
    )

    $scriptFileName = Split-Path -Leaf $Config.script
    $yaml = kubectl create configmap k6-script "--from-file=${scriptFileName}=$($Config.script)" --dry-run=client -o yaml
    if ($LASTEXITCODE -ne 0) { throw "kubectl create configmap (dry-run) failed with exit code $LASTEXITCODE" }

    $yaml | kubectl apply -f -
    if ($LASTEXITCODE -ne 0) { throw "kubectl apply of k6-script ConfigMap failed with exit code $LASTEXITCODE" }
}
```

- [ ] **Step 5: Verify against a real cluster**

```bash
pwsh -NoProfile -Command "Import-Module ./modules/Perftest.psm1 -Force; New-PerftestCluster"
mkdir -p manifests loadtest
cp templates/manifest.example.yaml manifests/httpbin.yaml
cp templates/loadtest.example.js loadtest/httpbin.js
pwsh -NoProfile -Command "
Import-Module ./modules/Perftest.psm1 -Force
\$config = Get-PerftestConfig -Path (Join-Path (Get-Location) 'templates/config.example.yaml')
Deploy-PerftestApp -Config \$config
Publish-PerftestLoadScript -Config \$config
"
kubectl get pods -l app=httpbin
kubectl get configmap k6-script
```

Expected: `httpbin` pod is `Running`/`1/1 Ready`; `k6-script` ConfigMap exists with a `httpbin.js` data key.

- [ ] **Step 6: Clean up the local copies used for verification (they're gitignored, but tidy the working tree) and commit the template files**

```bash
rm manifests/httpbin.yaml loadtest/httpbin.js
git add templates/manifest.example.yaml templates/loadtest.example.js templates/config.example.yaml modules/Perftest.psm1
git commit -m "Add httpbin example templates, Deploy-PerftestApp, Publish-PerftestLoadScript"
```

(Leave the kind cluster running — Task 5 reuses it.)

---

### Task 5: Generic k6 Job wrapper + resource-matrix execution

**Files:**
- Create: `manifests/k6-job-template.yaml`
- Modify: `modules/Perftest.psm1` (add `Invoke-PerftestMatrix`)

**Interfaces:**
- Consumes: `Get-PerftestResourceCombos` (Task 3), `PSCustomObject` config shape (Task 3), a running cluster with the app already deployed and `k6-script` ConfigMap already published (Task 4's `Deploy-PerftestApp`/`Publish-PerftestLoadScript`, called by this task before the loop).
- Produces: `Invoke-PerftestMatrix -Config <PSCustomObject> -OutputDir <string>` — runs the full matrix, writes `results.csv` in `OutputDir`, no return value.

- [ ] **Step 1: Create `manifests/k6-job-template.yaml`**

```yaml
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
          command: ["sh", "-c", "PLACEHOLDER"]
          env:
            - name: VUS
              value: "PLACEHOLDER"
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

(`command` and the `VUS` env var value are placeholders — `Invoke-PerftestMatrix` loads this file, overwrites those two fields per run via object mutation, and applies the result. It never hand-edits YAML text.)

- [ ] **Step 2: Implement `Invoke-PerftestMatrix`**

Append to `modules/Perftest.psm1` (and add `Invoke-PerftestMatrix` to `Export-ModuleMember`):

```powershell
function Start-PerftestK6Job {
    param(
        [Parameter(Mandatory)] [PSCustomObject]$Config,
        [Parameter(Mandatory)] [string]$ScriptFileName,
        [Parameter(Mandatory)] [string]$OutFile
    )

    $repoRoot = Split-Path -Parent $PSScriptRoot
    $jobTemplatePath = Join-Path $repoRoot 'manifests/k6-job-template.yaml'
    $job = Get-Content -Path $jobTemplatePath -Raw | ConvertFrom-Yaml

    $stageFlags = ($Config.load.stages | ForEach-Object { "--stage $($_.duration):$($_.target)" }) -join ' '
    $k6Command = "k6 run --summary-export=/results/summary.json $stageFlags /scripts/$ScriptFileName; ec=`$?; touch /results/done; sleep 20; exit `$ec"

    $job.spec.template.spec.containers[0].command = @('sh', '-c', $k6Command)
    $job.spec.template.spec.containers[0].env[0].value = [string]$Config.load.vus

    kubectl delete job k6-loadtest --ignore-not-found | Out-Null
    ($job | ConvertTo-Yaml) | kubectl apply -f -
    if ($LASTEXITCODE -ne 0) { throw "kubectl apply of k6-loadtest Job failed with exit code $LASTEXITCODE" }

    $pod = $null
    $waited = 0
    while (-not $pod -and $waited -lt 30) {
        $pod = kubectl get pods -l job-name=k6-loadtest -o jsonpath='{.items[0].metadata.name}' 2>$null
        if (-not $pod) { Start-Sleep -Seconds 2; $waited += 2 }
    }
    if (-not $pod) { throw "k6 pod never appeared" }

    $waited = 0
    while ($true) {
        kubectl exec $pod -- test -f /results/done 2>$null
        if ($LASTEXITCODE -eq 0) { break }
        Start-Sleep -Seconds 5
        $waited += 5
        if ($waited -ge 240) { throw "Timed out waiting for k6 job '$pod' to finish" }
    }

    kubectl cp "${pod}:/results/summary.json" $OutFile
    if ($LASTEXITCODE -ne 0) { throw "kubectl cp of k6 summary.json failed with exit code $LASTEXITCODE" }
}

function Invoke-PerftestMatrix {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [PSCustomObject]$Config,
        [Parameter(Mandatory)] [string]$OutputDir
    )

    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    $resultsPath = Join-Path $OutputDir 'results.csv'
    if (-not (Test-Path $resultsPath)) {
        'memory,cpu,start_time,end_time,duration_seconds,p95_ms,p99_ms,error_rate,http_reqs_total,oom_killed,restart_count' |
            Set-Content -Path $resultsPath
    }

    $scriptFileName = Split-Path -Leaf $Config.script
    $combos = Get-PerftestResourceCombos -Resources $Config.resources

    foreach ($combo in $combos) {
        $mem = $combo.memory
        $cpu = $combo.cpu
        Write-Host "=== Testing memory=$mem cpu=$cpu ==="
        $startTime = Get-Date

        kubectl set resources "deployment/$($Config.container)" -c $Config.container `
            --limits="cpu=$cpu,memory=$mem" --requests="cpu=$cpu,memory=$mem"
        if ($LASTEXITCODE -ne 0) { throw "kubectl set resources failed with exit code $LASTEXITCODE" }

        kubectl rollout status "deployment/$($Config.container)" --timeout=120s
        if ($LASTEXITCODE -ne 0) { throw "rollout after resource patch failed with exit code $LASTEXITCODE" }
        Start-Sleep -Seconds 5

        $pod = kubectl get pod -l "app=$($Config.container)" --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}'

        $topLog = Join-Path $OutputDir "top-$mem-$cpu.log"
        $samplerJob = Start-Job -ScriptBlock {
            param($podName, $logPath)
            while ($true) {
                kubectl top pod $podName --no-headers *>> $logPath
                Start-Sleep -Seconds 10
            }
        } -ArgumentList $pod, $topLog

        $k6Out = Join-Path $OutputDir "k6-$mem-$cpu.json"
        Start-PerftestK6Job -Config $Config -ScriptFileName $scriptFileName -OutFile $k6Out

        Stop-Job $samplerJob -ErrorAction SilentlyContinue | Out-Null
        Remove-Job $samplerJob -Force -ErrorAction SilentlyContinue | Out-Null

        $restartCount = kubectl get pod $pod -o jsonpath='{.status.containerStatuses[0].restartCount}'
        $lastReason = kubectl get pod $pod -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason}' 2>$null
        $oomFlag = if ($lastReason -eq 'OOMKilled') { 'yes' } else { 'no' }

        $metrics = Get-Content -Path $k6Out -Raw | ConvertFrom-Json
        $p95 = $metrics.metrics.http_req_duration.'p(95)'
        $p99 = $metrics.metrics.http_req_duration.'p(99)'
        $errRate = $metrics.metrics.http_req_failed.value
        $httpReqsTotal = $metrics.metrics.http_reqs.count

        $endTime = Get-Date
        $durationSeconds = [int]($endTime - $startTime).TotalSeconds

        "$mem,$cpu,$($startTime.ToString('o')),$($endTime.ToString('o')),$durationSeconds,$p95,$p99,$errRate,$httpReqsTotal,$oomFlag,$restartCount" |
            Add-Content -Path $resultsPath

        Write-Host "--- result: mem=$mem cpu=$cpu duration=${durationSeconds}s p95=${p95}ms err_rate=$errRate oom=$oomFlag restarts=$restartCount ---"
    }

    Write-Host "Matrix complete. Results in $resultsPath"
}
```

- [ ] **Step 3: Verify a real (small, 2-combo) matrix run end-to-end**

Reusing the cluster/deployment/ConfigMap left running from Task 4 (re-run Task 4's Step 5 setup if the cluster was torn down):

```bash
pwsh -NoProfile -Command "
Import-Module ./modules/Perftest.psm1 -Force
\$config = Get-PerftestConfig -Path (Join-Path (Get-Location) 'templates/config.example.yaml')
Invoke-PerftestMatrix -Config \$config -OutputDir 'output/httpbin-example-verify'
"
cat output/httpbin-example-verify/results.csv
```

Expected: `results.csv` has a header row plus 4 data rows (2 memory × 2 cpu combos from `templates/config.example.yaml`), each with numeric `p95_ms`/`p99_ms`/`error_rate`/`http_reqs_total`, `oom_killed` of `yes`/`no`, and a numeric `restart_count`.

- [ ] **Step 4: Clean up the verification output (it's gitignored, but tidy) and commit**

```bash
rm -rf output/httpbin-example-verify
git add manifests/k6-job-template.yaml modules/Perftest.psm1
git commit -m "Add generic k6 Job wrapper and Invoke-PerftestMatrix"
```

---

### Task 6: CLI entrypoint, Makefile wrapper, and full end-to-end verification

**Files:**
- Create: `perftest.ps1`
- Create: `Makefile`

**Interfaces:**
- Consumes: every function exported by `modules/Perftest.psm1` so far (`New-PerftestCluster`, `Remove-PerftestCluster`, `Get-PerftestConfig`, `Deploy-PerftestApp`, `Publish-PerftestLoadScript`, `Invoke-PerftestMatrix`).
- Produces: the `perftest.ps1` CLI surface described in the design spec (`-Cluster`, `-Run -Config <path>`, `-Teardown`, `-All -Config <path>`, `-Full -Config <path>`).

- [ ] **Step 1: Create `perftest.ps1`**

```powershell
[CmdletBinding(DefaultParameterSetName = 'Help')]
param(
    [Parameter(ParameterSetName = 'Cluster')] [switch]$Cluster,
    [Parameter(ParameterSetName = 'Run')] [switch]$Run,
    [Parameter(ParameterSetName = 'Teardown')] [switch]$Teardown,
    [Parameter(ParameterSetName = 'All')] [switch]$All,
    [Parameter(ParameterSetName = 'Full')] [switch]$Full,
    [Parameter(ParameterSetName = 'Run')]
    [Parameter(ParameterSetName = 'All')]
    [Parameter(ParameterSetName = 'Full')]
    [string]$Config
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'modules/Perftest.psm1') -Force

function Invoke-PerftestRun {
    param([string]$ConfigPath)
    if (-not $ConfigPath) { throw "-Config <path> is required" }
    $parsedConfig = Get-PerftestConfig -Path $ConfigPath -RepoRoot $PSScriptRoot
    Deploy-PerftestApp -Config $parsedConfig
    Publish-PerftestLoadScript -Config $parsedConfig
    $timestamp = (Get-Date).ToString('yyyy-MM-ddTHH-mm-ss')
    $outputDir = Join-Path $PSScriptRoot "output/$($parsedConfig.name)-$timestamp"
    Invoke-PerftestMatrix -Config $parsedConfig -OutputDir $outputDir
}

switch ($PSCmdlet.ParameterSetName) {
    'Cluster'  { New-PerftestCluster }
    'Run'      { Invoke-PerftestRun -ConfigPath $Config }
    'Teardown' { Remove-PerftestCluster }
    'All' {
        New-PerftestCluster
        Invoke-PerftestRun -ConfigPath $Config
    }
    'Full' {
        New-PerftestCluster
        Invoke-PerftestRun -ConfigPath $Config
        Remove-PerftestCluster
    }
    default {
        Write-Host "Usage: perftest.ps1 -Cluster | -Run -Config <path> | -Teardown | -All -Config <path> | -Full -Config <path>"
    }
}
```

- [ ] **Step 2: Create `Makefile`**

```makefile
.PHONY: help cluster run teardown all full

help:
	@echo "k8s-perftest - thin make wrapper around perftest.ps1 (primary interface is PowerShell)"
	@echo ""
	@echo "  make cluster              - create the kind cluster"
	@echo "  make run CONFIG=path.yaml - deploy + run the resource matrix for a config"
	@echo "  make teardown             - delete the kind cluster"
	@echo "  make all CONFIG=path.yaml - cluster + run, cluster left running"
	@echo "  make full CONFIG=path.yaml - cluster + run + teardown"

cluster:
	pwsh -File perftest.ps1 -Cluster

run:
	@if [ -z "$(CONFIG)" ]; then echo "Usage: make run CONFIG=path.yaml" >&2; exit 1; fi
	pwsh -File perftest.ps1 -Run -Config "$(CONFIG)"

teardown:
	pwsh -File perftest.ps1 -Teardown

all:
	@if [ -z "$(CONFIG)" ]; then echo "Usage: make all CONFIG=path.yaml" >&2; exit 1; fi
	pwsh -File perftest.ps1 -All -Config "$(CONFIG)"

full:
	@if [ -z "$(CONFIG)" ]; then echo "Usage: make full CONFIG=path.yaml" >&2; exit 1; fi
	pwsh -File perftest.ps1 -Full -Config "$(CONFIG)"
```

- [ ] **Step 3: Full end-to-end verification from a clean slate**

```bash
cd "c:\Users\e.moro\source\k8s-perftest"
kind delete cluster --name k8s-perftest 2>/dev/null || true
mkdir -p manifests loadtest configs
cp templates/manifest.example.yaml manifests/httpbin.yaml
cp templates/loadtest.example.js loadtest/httpbin.js
cp templates/config.example.yaml configs/httpbin-example.yaml
pwsh -File perftest.ps1 -Full -Config configs/httpbin-example.yaml
ls output
cat output/httpbin-example-*/results.csv
kind get clusters
```

Expected: the command runs cluster-create → deploy → matrix (4 combos) → teardown without error; `output/httpbin-example-<timestamp>/results.csv` has a header + 4 data rows; `kind get clusters` shows no clusters afterward (fully torn down).

- [ ] **Step 4: Verify the `Makefile` wrapper produces the same result**

```bash
make full CONFIG=configs/httpbin-example.yaml
kind get clusters
```

Expected: same as Step 3 — completes without error, cluster torn down afterward.

- [ ] **Step 5: Clean up local verification artifacts (all gitignored) and commit**

```bash
rm manifests/httpbin.yaml loadtest/httpbin.js configs/httpbin-example.yaml
rm -rf output
git add perftest.ps1 Makefile
git commit -m "Add perftest.ps1 CLI and Makefile wrapper; verified full pipeline end-to-end"
```

---

## Post-plan state

At this point the repo has zero Outline references, a fully Windows-native PowerShell engine, a configurable resource matrix and load shape per app, and `manifests/`/`loadtest/`/`configs/` are real gitignored per-app artifacts with `templates/` examples — matching the design spec. `frontend/` remains an empty placeholder. `README.md` is untouched (flagged in the spec as a deliberate, separate follow-up).
