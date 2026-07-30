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

function Start-PerftestK6Job {
    param(
        [Parameter(Mandatory)] [PSCustomObject]$Config,
        [Parameter(Mandatory)] [string]$ScriptFileName,
        [Parameter(Mandatory)] [string]$OutFile,
        [Parameter(Mandatory)] [string]$JobName
    )

    $repoRoot = Split-Path -Parent $PSScriptRoot
    $jobTemplatePath = Join-Path $repoRoot 'manifests/k6-job-template.yaml'
    $job = Get-Content -Path $jobTemplatePath -Raw | ConvertFrom-Yaml
    $job.metadata.name = $JobName

    $stageFlags = ($Config.load.stages | ForEach-Object { "--stage $($_.duration):$($_.target)" }) -join ' '
    # k6's default --summary-trend-stats is 'avg,min,med,max,p(90),p(95)' and never includes
    # p(99), so it must be requested explicitly or the summary JSON below has no p(99) key.
    $k6Command = "k6 run --summary-export=/results/summary.json --summary-trend-stats='avg,min,med,max,p(90),p(95),p(99)' $stageFlags /scripts/$ScriptFileName; ec=`$?; touch /results/done; sleep 20; exit `$ec"

    $job.spec.template.spec.containers[0].command = @('sh', '-c', $k6Command)
    $job.spec.template.spec.containers[0].env[0].value = [string]$Config.load.vus

    # Each combo gets its own uniquely-named Job (see $JobName), so there is no window
    # where an old combo's pod and the new combo's pod share the same job-name label —
    # this delete is just idempotency for a re-run of the same combo, not the source of
    # cross-combo pod-discovery races.
    kubectl delete job $JobName --ignore-not-found | Out-Null
    ($job | ConvertTo-Yaml) | kubectl apply -f -
    if ($LASTEXITCODE -ne 0) { throw "kubectl apply of $JobName Job failed with exit code $LASTEXITCODE" }

    $pod = $null
    $waited = 0
    while (-not $pod -and $waited -lt 30) {
        $pod = kubectl get pods -l job-name=$JobName -o jsonpath='{.items[0].metadata.name}' 2>$null
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

    $relativeOutFile = [System.IO.Path]::GetRelativePath((Get-Location).Path, $OutFile)
    kubectl cp "${pod}:/results/summary.json" $relativeOutFile
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
        if (-not $pod) { throw "No running pod found for app=$($Config.container) after resource patch" }

        $topLog = Join-Path $OutputDir "top-$mem-$cpu.log"
        $samplerJob = Start-Job -ScriptBlock {
            param($podName, $logPath)
            while ($true) {
                kubectl top pod $podName --no-headers *>> $logPath
                Start-Sleep -Seconds 10
            }
        } -ArgumentList $pod, $topLog

        $k6Out = Join-Path $OutputDir "k6-$mem-$cpu.json"
        # Unique per-combo Job name (lowercased: k8s object names must be lowercase,
        # and resource strings like "256Mi"/"250m" contain uppercase letters) so that
        # no two combos' Jobs/pods ever share a job-name label value.
        $jobName = "k6-loadtest-$($mem.ToLower())-$($cpu.ToLower())"
        Start-PerftestK6Job -Config $Config -ScriptFileName $scriptFileName -OutFile $k6Out -JobName $jobName

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

Export-ModuleMember -Function New-PerftestCluster, Remove-PerftestCluster, Get-PerftestConfig, Get-PerftestResourceCombos, Deploy-PerftestApp, Publish-PerftestLoadScript, Invoke-PerftestMatrix
