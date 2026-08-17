Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-PerftestCluster {
    [CmdletBinding()]
    param(
        [string]$ClusterName = 'k8s-perftest'
    )

    # 2>&1 (not 2>$null) sidesteps a Windows PowerShell 5.1 bug where redirecting
    # only stderr on a native command throws "StandardOutputEncoding is only
    # supported when standard output is redirected" under non-default console
    # codepages; merging both streams then dropping ErrorRecords keeps the same
    # "ignore stderr" behavior without hitting that code path.
    $existing = kind get clusters 2>&1 | Where-Object { $_ -is [string] }
    if ($existing -contains $ClusterName) {
        Write-Host "Cluster '$ClusterName' ja existe, pulando a criacao." -ForegroundColor Yellow
        kubectl config use-context "kind-$ClusterName" | Out-Null
        return
    }

    $repoRoot = Split-Path -Parent $PSScriptRoot
    kind create cluster --name $ClusterName --config (Join-Path $repoRoot 'manifests/kind-config.yaml')
    if ($LASTEXITCODE -ne 0) { throw "Falha ao criar o cluster kind (codigo de saida $LASTEXITCODE)" }

    Write-Host "Aguardando o cluster estabilizar (30 segundos)..." -ForegroundColor Cyan
    Start-Sleep -Seconds 30

    Write-Host "Instalando o metrics-server..." -ForegroundColor Cyan
    kubectl apply --validate=false -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
    if ($LASTEXITCODE -ne 0) { throw "Falha ao aplicar o metrics-server (codigo de saida $LASTEXITCODE)" }

    # kind nodes use self-signed kubelet certs; metrics-server needs this flag
    # to scrape them, or `kubectl top pod` stays empty forever.
    kubectl patch deployment metrics-server -n kube-system --type='json' `
        -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'
    if ($LASTEXITCODE -ne 0) { throw "Falha ao aplicar patch no metrics-server (codigo de saida $LASTEXITCODE)" }

    Write-Host "Aguardando o rollout do metrics-server..." -ForegroundColor Cyan
    kubectl -n kube-system rollout status deployment/metrics-server --timeout=120s
    if ($LASTEXITCODE -ne 0) { throw "Falha no rollout do metrics-server (codigo de saida $LASTEXITCODE)" }

    Write-Host "Cluster pronto. Contexto: kind-$ClusterName" -ForegroundColor Green
}

function Remove-PerftestCluster {
    [CmdletBinding()]
    param(
        [string]$ClusterName = 'k8s-perftest'
    )
    kind delete cluster --name $ClusterName
    if ($LASTEXITCODE -ne 0) { throw "Falha ao excluir o cluster kind (codigo de saida $LASTEXITCODE)" }
}

function Assert-PerftestYamlModule {
    if (-not (Get-Module -ListAvailable -Name powershell-yaml)) {
        Write-Host "Instalando o modulo powershell-yaml (apenas uma vez)..." -ForegroundColor Cyan
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
            throw "A configuracao '$Path' esta sem o campo obrigatorio '$required'."
        }
    }
    if (-not $raw.ContainsKey('resources') -or -not $raw.resources.ContainsKey('memory') -or -not $raw.resources.memory) {
        throw "A configuracao '$Path' esta sem o campo obrigatorio 'resources.memory'."
    }
    if (-not $raw.resources.ContainsKey('cpu') -or -not $raw.resources.cpu) {
        throw "A configuracao '$Path' esta sem o campo obrigatorio 'resources.cpu'."
    }

    $stages = @()
    foreach ($stage in $raw.load.stages) {
        $stages += [PSCustomObject]@{ duration = [string]$stage.duration; target = [int]$stage.target }
    }

    # Optional - defaults to 5s. How often the background sampler polls
    # `kubectl top pod` (RAM/CPU) and restart-count during each combo.
    $sampleIntervalSeconds = if ($raw.ContainsKey('sampleIntervalSeconds') -and $raw.sampleIntervalSeconds) {
        [int]$raw.sampleIntervalSeconds
    } else {
        5
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
        sampleIntervalSeconds = $sampleIntervalSeconds
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

function Get-PerftestStagesTotalSeconds {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [array]$Stages
    )

    $total = 0.0
    foreach ($stage in $Stages) {
        if ($stage.duration -match '^(\d+(\.\d+)?)(ms|s|m|h)$') {
            $value = [double]$Matches[1]
            $seconds = switch ($Matches[3]) {
                'ms' { $value / 1000 }
                's' { $value }
                'm' { $value * 60 }
                'h' { $value * 3600 }
            }
            $total += $seconds
        }
    }
    [int][Math]::Ceiling($total)
}

function ConvertTo-PerftestBytes {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Quantity
    )

    if ($Quantity -notmatch '^(\d+(\.\d+)?)(Ki|Mi|Gi)$') {
        throw "Quantidade de memoria invalida: '$Quantity' (use sufixo Ki, Mi ou Gi)"
    }
    $value = [double]$Matches[1]
    # PowerShell's KB/MB/GB numeric-literal suffixes are already binary
    # (1MB = 1048576), matching Ki/Mi/Gi exactly - no separate lookup table
    # of multipliers needed.
    $multiplier = switch ($Matches[3]) {
        'Ki' { 1KB }
        'Mi' { 1MB }
        'Gi' { 1GB }
    }
    [long]($value * $multiplier)
}

function ConvertTo-PerftestHexBytes {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$Quantity
    )
    $bytes = ConvertTo-PerftestBytes -Quantity $Quantity
    '0x' + $bytes.ToString('X')
}

# DOTNET_GCHeapHardLimit only bounds the *managed* heap, not the process's
# total memory footprint (native allocations, thread stacks, JIT, unmanaged
# buffers...). Setting it equal to the container's memory limit leaves those
# other consumers zero headroom - the container can still get OOM-killed
# even though the managed heap itself never crossed the "limit", which would
# misreport a tier as broken for a reason unrelated to the app's actual
# managed-memory usage at that tier. Reserving a fraction of the container
# limit for everything else is standard .NET-in-containers guidance.
$script:GcHeapHardLimitHeadroomFraction = 0.8

function Get-PerftestGcHeapHardLimitHex {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$MemoryQuantity
    )
    $limitBytes = [long][Math]::Floor((ConvertTo-PerftestBytes -Quantity $MemoryQuantity) * $script:GcHeapHardLimitHeadroomFraction)
    '0x' + $limitBytes.ToString('X')
}

function Get-PerftestManifestImages {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$ManifestContent
    )

    # A plain regex over the raw YAML, not a full parse: `image:` lines are
    # always simple scalars regardless of which resource/container they
    # belong to, so this covers Deployments/StatefulSets/multi-container
    # pods without needing to walk the parsed YAML tree (and without caring
    # how many `---`-separated documents the manifest has).
    $found = [regex]::Matches($ManifestContent, "(?m)^\s*image:\s*['`"]?([^\s'`"]+)['`"]?\s*$")
    @($found | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
}

function Import-PerftestLocalImages {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [string]$ManifestPath,
        [string]$ClusterName = 'k8s-perftest'
    )

    $manifestText = Get-Content -Path $ManifestPath -Raw
    $imageRefs = Get-PerftestManifestImages -ManifestContent $manifestText

    foreach ($image in $imageRefs) {
        # kind can't see locally-built images automatically. Only load ones
        # that actually exist in the local Docker image cache - a registry
        # image (like the bundled httpbin example) isn't present locally,
        # `docker image inspect` fails, and kubelet pulls it normally as
        # before; nothing here should change behavior for that case.
        docker image inspect $image *> $null
        if ($LASTEXITCODE -ne 0) { continue }

        Write-Host "Carregando imagem local '$image' no cluster kind '$ClusterName'..." -ForegroundColor Cyan
        kind load docker-image $image --name $ClusterName
        if ($LASTEXITCODE -ne 0) { throw "Falha ao carregar a imagem '$image' no kind (codigo de saida $LASTEXITCODE)" }
    }
}

function Deploy-PerftestApp {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Config,
        [string]$ClusterName = 'k8s-perftest'
    )

    Import-PerftestLocalImages -ManifestPath $Config.manifest -ClusterName $ClusterName

    kubectl apply -f $Config.manifest
    if ($LASTEXITCODE -ne 0) { throw "Falha ao aplicar '$($Config.manifest)' (codigo de saida $LASTEXITCODE)" }

    # stdout suprimido: só o exit code importa aqui, e o texto de progresso
    # ("Waiting for deployment...", uma linha a cada poll) não serve pra nada
    # além de inflar o log da execução sem necessidade.
    kubectl rollout status "deployment/$($Config.container)" --timeout=120s | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Falha no rollout de deployment/$($Config.container) (codigo de saida $LASTEXITCODE)" }
}

function Publish-PerftestLoadScript {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [PSCustomObject]$Config
    )

    $scriptFileName = Split-Path -Leaf $Config.script
    $yaml = kubectl create configmap k6-script "--from-file=${scriptFileName}=$($Config.script)" --dry-run=client -o yaml
    if ($LASTEXITCODE -ne 0) { throw "Falha ao gerar o ConfigMap (dry-run) (codigo de saida $LASTEXITCODE)" }

    $yaml | kubectl apply -f -
    if ($LASTEXITCODE -ne 0) { throw "Falha ao aplicar o ConfigMap k6-script (codigo de saida $LASTEXITCODE)" }
}

function Start-PerftestK6Job {
    param(
        [Parameter(Mandatory)] [PSCustomObject]$Config,
        [Parameter(Mandatory)] [string]$ScriptFileName,
        [Parameter(Mandatory)] [string]$OutFile,
        [Parameter(Mandatory)] [string]$JobName,
        [string]$LogPath,
        [string]$MetricsPath
    )

    $repoRoot = Split-Path -Parent $PSScriptRoot
    $jobTemplatePath = Join-Path $repoRoot 'manifests/k6-job-template.yaml'
    $job = Get-Content -Path $jobTemplatePath -Raw | ConvertFrom-Yaml
    $job.metadata.name = $JobName

    $stageFlags = ($Config.load.stages | ForEach-Object { "--stage $($_.duration):$($_.target)" }) -join ' '
    # k6's default --summary-trend-stats is 'avg,min,med,max,p(90),p(95)' and never includes
    # p(99), so it must be requested explicitly or the summary JSON below has no p(99) key.
    # --out json writes k6's raw per-request metrics (http_req_failed etc.) to a
    # separate file - the throughput chart needs real success/failure per
    # request, which the human progress bar (captured separately as
    # k6-logs-<mem>-<cpu>.log) doesn't carry.
    $k6Command = "k6 run --summary-export=/results/summary.json --out json=/results/metrics.ndjson --summary-trend-stats='avg,min,med,max,p(90),p(95),p(99)' $stageFlags /scripts/$ScriptFileName; ec=`$?; touch /results/done; sleep 20; exit `$ec"

    $job.spec.template.spec.containers[0].command = @('sh', '-c', $k6Command)
    $job.spec.template.spec.containers[0].env[0].value = [string]$Config.load.vus

    # Each combo gets its own uniquely-named Job (see $JobName), so there is no window
    # where an old combo's pod and the new combo's pod share the same job-name label —
    # this delete is just idempotency for a re-run of the same combo, not the source of
    # cross-combo pod-discovery races.
    kubectl delete job $JobName --ignore-not-found | Out-Null
    ($job | ConvertTo-Yaml) | kubectl apply -f -
    if ($LASTEXITCODE -ne 0) { throw "Falha ao aplicar o Job $JobName (codigo de saida $LASTEXITCODE)" }

    $pod = $null
    $waited = 0
    while (-not $pod -and $waited -lt 30) {
        $pod = kubectl get pods -l job-name=$JobName -o jsonpath='{.items[0].metadata.name}' 2>&1 | Where-Object { $_ -is [string] }
        if (-not $pod) { Start-Sleep -Seconds 2; $waited += 2 }
    }
    if (-not $pod) { throw "O pod do k6 nunca apareceu" }

    $k6LogsJob = $null
    if ($LogPath) {
        # O Job usa backoffLimit 0 / restartPolicy Never (ver
        # manifests/k6-job-template.yaml), entao o pod nunca e substituido
        # durante essa execucao - diferente do pod da app (Recreate), uma
        # captura simples sem loop de retry e suficiente aqui.
        $k6LogsJob = Start-Job -ScriptBlock {
            param($podName, $logPath)
            kubectl logs -f $podName *>> $logPath
        } -ArgumentList $pod, $LogPath
    }

    $k6MetricsJob = $null
    if ($MetricsPath) {
        $k6MetricsJob = Start-Job -ScriptBlock {
            param($podName, $metricsPath)
            # /results/metrics.ndjson doesn't exist until k6 actually starts
            # writing to it, a moment after the container starts - looping
            # past tail's "no such file" error is simpler and more portable
            # than relying on this image's tail supporting --retry.
            while ($true) {
                kubectl exec $podName -- tail -f -n +1 /results/metrics.ndjson *>> $metricsPath
                Start-Sleep -Seconds 2
            }
        } -ArgumentList $pod, $MetricsPath
    }

    try {
        # Um timeout fixo nao acompanha a duracao real configurada em
        # load.stages - para uma config com estagios somando mais que o
        # timeout, o job do k6 e cancelado (sem resultado nenhum) mesmo que
        # o teste esteja rodando normalmente. 60s de folga cobre o overhead
        # de setup do k6 e a granularidade do polling (5s); nunca menor que
        # 240s para nao regredir configs com estagios curtos.
        $stagesTotalSeconds = Get-PerftestStagesTotalSeconds -Stages $Config.load.stages
        $completionTimeoutSeconds = [Math]::Max(240, $stagesTotalSeconds + 60)

        $waited = 0
        while ($true) {
            kubectl exec $pod -- test -f /results/done 2>&1 | Out-Null
            if ($LASTEXITCODE -eq 0) { break }
            Start-Sleep -Seconds 5
            $waited += 5
            if ($waited -ge $completionTimeoutSeconds) {
                throw "Tempo esgotado aguardando o job do k6 '$pod' terminar (esperou ${completionTimeoutSeconds}s - estagios configurados somam ${stagesTotalSeconds}s)"
            }
        }

        # kubectl cp can't disambiguate an absolute Windows path's drive-letter
        # colon from its own pod:path separator, so the destination must be
        # relative to the caller's cwd (perftest.ps1 already cd's to repo root).
        $relativeOutFile = [System.IO.Path]::GetRelativePath((Get-Location).Path, $OutFile)
        kubectl cp "${pod}:/results/summary.json" $relativeOutFile
        if ($LASTEXITCODE -ne 0) { throw "Falha ao copiar o summary.json do k6 (codigo de saida $LASTEXITCODE)" }
    } finally {
        if ($k6LogsJob) {
            Stop-Job $k6LogsJob -ErrorAction SilentlyContinue | Out-Null
            Remove-Job $k6LogsJob -Force -ErrorAction SilentlyContinue | Out-Null
        }
        if ($k6MetricsJob) {
            Stop-Job $k6MetricsJob -ErrorAction SilentlyContinue | Out-Null
            Remove-Job $k6MetricsJob -Force -ErrorAction SilentlyContinue | Out-Null
        }
    }
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
        Write-Host "=== Testando memory=$mem cpu=$cpu ===" -ForegroundColor Cyan
        $startTime = Get-Date
        $samplerJob = $null
        $logsJob = $null

        # A single combo going wrong - low resources breaking the app, or a harness
        # hiccup like the k6-completion poll timing out - is one data point, not a
        # reason to abort every combo still queued behind it. Record what's known
        # and move on; only truly unrecoverable setup failures (resource patch,
        # missing pod) still stop the whole matrix.
        try {
            kubectl set resources "deployment/$($Config.container)" -c $Config.container `
                --limits="cpu=$cpu,memory=$mem" --requests="cpu=$cpu,memory=$mem"
            if ($LASTEXITCODE -ne 0) { throw "Falha ao definir os recursos (codigo de saida $LASTEXITCODE)" }

            # stdout suprimido (só o exit code é lido): "Waiting for
            # deployment..." é reimpresso a cada poll enquanto o rollout não
            # fica pronto e, sem isso, pode facilmente empurrar a própria
            # marca "=== Testando ===" desta combinação pra fora dos últimos
            # 20000 caracteres que a interface web guarda como logTail - a
            # UI então perde o rastro de qual combinação está rodando até o
            # usuário clicar manualmente em algo.
            kubectl rollout status "deployment/$($Config.container)" --timeout=120s | Out-Null
            $rolloutReady = ($LASTEXITCODE -eq 0)

            if ($rolloutReady) {
                # DOTNET_GCHeapHardLimit sync - opt-in, by env var name: apps whose
                # manifest declares this get it kept in sync with whichever memory
                # tier is currently under test. Needed for older .NET runtimes
                # (netcoreapp2.2 and earlier) whose cgroup memory-limit detection is
                # unreliable - Server GC can otherwise size itself off the *host's*
                # RAM instead of the container's limit, growing past what this combo
                # is meant to test until the container gets OOM-killed for reasons
                # unrelated to the app's real memory efficiency at that tier. A
                # hardcoded value would be just as wrong the other way: it'd cap the
                # GC heap at one tier's size even while testing a larger tier.
                $envNames = kubectl get "deployment/$($Config.container)" -o jsonpath='{.spec.template.spec.containers[0].env[*].name}' 2>&1 |
                    Where-Object { $_ -is [string] }
                if ($envNames -and ($envNames -split '\s+') -contains 'DOTNET_GCHeapHardLimit') {
                    $gcHeapHex = Get-PerftestGcHeapHardLimitHex -MemoryQuantity $mem
                    kubectl set env "deployment/$($Config.container)" "DOTNET_GCHeapHardLimit=$gcHeapHex"
                    if ($LASTEXITCODE -ne 0) { throw "Falha ao sincronizar DOTNET_GCHeapHardLimit (codigo de saida $LASTEXITCODE)" }
                    kubectl rollout status "deployment/$($Config.container)" --timeout=120s | Out-Null
                    $rolloutReady = ($LASTEXITCODE -eq 0)
                }
            }

            if ($rolloutReady) {
                Start-Sleep -Seconds 5
            } else {
                Write-Host "Rollout nao ficou pronto para memory=$mem cpu=$cpu - registrando falha e seguindo para a proxima combinacao." -ForegroundColor Yellow
            }

            $pod = kubectl get pod -l "app=$($Config.container)" -o jsonpath='{.items[0].metadata.name}'
            if (-not $pod) { throw "Nenhum pod encontrado para app=$($Config.container) apos o ajuste de recursos" }

            $restartCount = kubectl get pod $pod -o jsonpath='{.status.containerStatuses[0].restartCount}'
            $lastReason = kubectl get pod $pod -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason}' 2>&1 | Where-Object { $_ -is [string] }
            $oomFlag = if ($lastReason -eq 'OOMKilled') { 'yes' } else { 'no' }

            if ($rolloutReady) {
                $topLog = Join-Path $OutputDir "top-$mem-$cpu.log"
                $restartsLog = Join-Path $OutputDir "restarts-$mem-$cpu.log"
                $samplerJob = Start-Job -ScriptBlock {
                    param($podName, $logPath, $restartsPath, $initialRestartCount, $intervalSeconds)
                    # Only count increases from this combo's own starting restart
                    # count - a pod that already had restarts before this combo's
                    # sampler even started (e.g. during the rollout wait) shouldn't
                    # log a false event the moment sampling begins.
                    $lastRestartCount = $initialRestartCount
                    while ($true) {
                        # Timestamp-prefix each sample (tab-separated) so the RAM-over-time
                        # chart can plot real elapsed seconds instead of assuming a steady
                        # cadence, which kubectl/network hiccups don't guarantee. Failed
                        # samples (metrics-server not ready yet, transient connection errors)
                        # are dropped rather than logged, since only successful samples parse.
                        $sample = kubectl top pod $podName --no-headers 2>&1 | Where-Object { $_ -is [string] }
                        if ($LASTEXITCODE -eq 0 -and $sample) {
                            $ts = [DateTimeOffset]::UtcNow.ToString('o')
                            "$ts`t$sample" | Add-Content -Path $logPath
                        }

                        $currentRestartCount = kubectl get pod $podName -o jsonpath='{.status.containerStatuses[0].restartCount}' 2>&1 |
                            Where-Object { $_ -is [string] }
                        if ($currentRestartCount -match '^\d+$') {
                            $currentRestartCount = [int]$currentRestartCount
                            if ($currentRestartCount -gt $lastRestartCount) {
                                # lastState.terminated.reason distinguishes OOMKilled from
                                # everything else (typically Error, from a livenessProbe
                                # timeout - common at low CPU tiers where the app can't
                                # respond fast enough under throttling).
                                $reason = kubectl get pod $podName -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason}' 2>&1 |
                                    Where-Object { $_ -is [string] }
                                if (-not $reason) { $reason = 'Unknown' }
                                $ts2 = [DateTimeOffset]::UtcNow.ToString('o')
                                "$ts2`t$currentRestartCount`t$reason" | Add-Content -Path $restartsPath
                            }
                            $lastRestartCount = $currentRestartCount
                        }

                        Start-Sleep -Seconds $intervalSeconds
                    }
                } -ArgumentList $pod, $topLog, $restartsLog, ([int]$restartCount), $Config.sampleIntervalSeconds

                $appLog = Join-Path $OutputDir "logs-$mem-$cpu.log"
                $logsJob = Start-Job -ScriptBlock {
                    param($podName, $logPath)
                    # `kubectl logs -f` stops streaming when the container it's attached
                    # to exits (crash, OOMKilled, restart) - it does not auto-reattach to
                    # the replacement container. Looping means a crash-looping app's logs
                    # keep accumulating across restarts instead of the capture silently
                    # going dead after the first crash.
                    while ($true) {
                        kubectl logs -f $podName *>> $logPath
                        Start-Sleep -Seconds 2
                    }
                } -ArgumentList $pod, $appLog

                $k6Out = Join-Path $OutputDir "k6-$mem-$cpu.json"
                $k6LogPath = Join-Path $OutputDir "k6-logs-$mem-$cpu.log"
                $k6MetricsPath = Join-Path $OutputDir "k6-metrics-$mem-$cpu.ndjson"
                # Unique per-combo Job name (lowercased: k8s object names must be lowercase,
                # and resource strings like "256Mi"/"250m" contain uppercase letters) so that
                # no two combos' Jobs/pods ever share a job-name label value.
                $jobName = "k6-loadtest-$($mem.ToLower())-$($cpu.ToLower())"
                Start-PerftestK6Job -Config $Config -ScriptFileName $scriptFileName -OutFile $k6Out -JobName $jobName -LogPath $k6LogPath -MetricsPath $k6MetricsPath

                Stop-Job $samplerJob -ErrorAction SilentlyContinue | Out-Null
                Remove-Job $samplerJob -Force -ErrorAction SilentlyContinue | Out-Null
                $samplerJob = $null
                Stop-Job $logsJob -ErrorAction SilentlyContinue | Out-Null
                Remove-Job $logsJob -Force -ErrorAction SilentlyContinue | Out-Null
                $logsJob = $null

                # Re-read after the load test - restarts/OOMs can also happen under load,
                # not just during rollout.
                $restartCount = kubectl get pod $pod -o jsonpath='{.status.containerStatuses[0].restartCount}'
                $lastReason = kubectl get pod $pod -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason}' 2>&1 | Where-Object { $_ -is [string] }
                $oomFlag = if ($lastReason -eq 'OOMKilled') { 'yes' } else { 'no' }

                $metrics = Get-Content -Path $k6Out -Raw | ConvertFrom-Json
                $p95 = $metrics.metrics.http_req_duration.'p(95)'
                $p99 = $metrics.metrics.http_req_duration.'p(99)'
                $errRate = $metrics.metrics.http_req_failed.value
                $httpReqsTotal = $metrics.metrics.http_reqs.count
            } else {
                $p95 = ''; $p99 = ''; $errRate = ''; $httpReqsTotal = ''
            }

            $endTime = Get-Date
            $durationSeconds = [int]($endTime - $startTime).TotalSeconds

            # String interpolation (not -join) for the numeric fields: -join calls
            # .ToString() under the current culture, which on a pt-BR host renders
            # decimals like 1.64 as "1,64" and silently splits the CSV column in two.
            "$mem,$cpu,$($startTime.ToString('o')),$($endTime.ToString('o')),$durationSeconds,$p95,$p99,$errRate,$httpReqsTotal,$oomFlag,$restartCount" |
                Add-Content -Path $resultsPath

            $resultColor = if (-not $rolloutReady -or $oomFlag -eq 'yes' -or $restartCount -gt 0) { 'Red' } else { 'Green' }
            Write-Host "--- resultado: mem=$mem cpu=$cpu duracao=${durationSeconds}s p95=${p95}ms taxa_erro=$errRate oom=$oomFlag reinicios=$restartCount ---" -ForegroundColor $resultColor
        } catch {
            $endTime = Get-Date
            $durationSeconds = [int]($endTime - $startTime).TotalSeconds
            Write-Host "--- falha ao testar mem=$mem cpu=${cpu}: $($_.Exception.Message) - seguindo para a proxima combinacao. ---" -ForegroundColor Red
            $row = @($mem, $cpu, $startTime.ToString('o'), $endTime.ToString('o'), $durationSeconds, '', '', '', '', '', '') -join ','
            Add-Content -Path $resultsPath -Value $row
        } finally {
            if ($samplerJob) {
                Stop-Job $samplerJob -ErrorAction SilentlyContinue | Out-Null
                Remove-Job $samplerJob -Force -ErrorAction SilentlyContinue | Out-Null
            }
            if ($logsJob) {
                Stop-Job $logsJob -ErrorAction SilentlyContinue | Out-Null
                Remove-Job $logsJob -Force -ErrorAction SilentlyContinue | Out-Null
            }
        }
    }

    Write-Host "Matriz concluida. Resultados em $resultsPath" -ForegroundColor Green
}

function Write-PerftestRunMeta {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$OutputDir,
        [Parameter(Mandatory)] [datetime]$StartTime
    )

    $totalDurationSeconds = [int]((Get-Date) - $StartTime).TotalSeconds
    $meta = @{ totalDurationSeconds = $totalDurationSeconds } | ConvertTo-Json -Compress
    Set-Content -Path (Join-Path $OutputDir 'run-meta.json') -Value $meta
}

function Test-PerftestPrerequisites {
    [CmdletBinding()]
    param()

    $requirements = @(
        @{
            Label = 'kind'
            Check = { [bool](Get-Command kind -ErrorAction SilentlyContinue) }
            Hint  = 'Instale o kind: https://kind.sigs.k8s.io/docs/user/quick-start/#installation'
        },
        @{
            Label = 'kubectl'
            Check = { [bool](Get-Command kubectl -ErrorAction SilentlyContinue) }
            Hint  = 'Instale o kubectl: https://kubernetes.io/docs/tasks/tools/'
        },
        @{
            Label = 'k6'
            Check = { [bool](Get-Command k6 -ErrorAction SilentlyContinue) }
            Hint  = 'Instale o k6: https://k6.io/docs/get-started/installation/'
        },
        @{
            Label = 'docker (daemon em execucao)'
            Check = {
                if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
                docker info *> $null
                $LASTEXITCODE -eq 0
            }
            Hint  = 'Instale o Docker Desktop e verifique se esta em execucao: https://www.docker.com/products/docker-desktop/'
        },
        @{
            Label = 'modulo powershell-yaml'
            Check = { [bool](Get-Module -ListAvailable -Name powershell-yaml) }
            Hint  = 'Instale com: Install-Module -Name powershell-yaml -Scope CurrentUser'
        }
    )

    $allPassed = $true
    foreach ($requirement in $requirements) {
        $passed = $false
        try { $passed = [bool](& $requirement.Check) } catch { $passed = $false }

        if ($passed) {
            Write-Host "[  " -NoNewline
            Write-Host "OK" -ForegroundColor Green -NoNewline
            Write-Host "  ]    $($requirement.Label)"
        } else {
            Write-Host "[ " -NoNewline
            Write-Host "FAIL" -ForegroundColor Red -NoNewline
            Write-Host " ] $($requirement.Label) - $($requirement.Hint)"
            $allPassed = $false
        }
    }

    Write-Host ''
    if ($allPassed) {
        Write-Host 'Todos os pre-requisitos estao instalados e prontos.' -ForegroundColor Cyan
    } else {
        Write-Host 'Alguns pre-requisitos estao faltando - veja as linhas de FAIL acima.' -ForegroundColor Red
    }

    $allPassed
}

Export-ModuleMember -Function New-PerftestCluster, Remove-PerftestCluster, Get-PerftestConfig, Get-PerftestResourceCombos, Get-PerftestStagesTotalSeconds, ConvertTo-PerftestBytes, ConvertTo-PerftestHexBytes, Get-PerftestGcHeapHardLimitHex, Get-PerftestManifestImages, Import-PerftestLocalImages, Deploy-PerftestApp, Publish-PerftestLoadScript, Invoke-PerftestMatrix, Write-PerftestRunMeta, Test-PerftestPrerequisites
