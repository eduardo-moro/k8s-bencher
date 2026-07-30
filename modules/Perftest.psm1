Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-PerftestCluster {
    [CmdletBinding()]
    param(
        [string]$ClusterName = 'k8s-perftest'
    )

    $existing = kind get clusters 2>$null
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
    if ($LASTEXITCODE -ne 0) { throw "Falha ao aplicar '$($Config.manifest)' (codigo de saida $LASTEXITCODE)" }

    kubectl rollout status "deployment/$($Config.container)" --timeout=120s
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
    if ($LASTEXITCODE -ne 0) { throw "Falha ao aplicar o Job $JobName (codigo de saida $LASTEXITCODE)" }

    $pod = $null
    $waited = 0
    while (-not $pod -and $waited -lt 30) {
        $pod = kubectl get pods -l job-name=$JobName -o jsonpath='{.items[0].metadata.name}' 2>$null
        if (-not $pod) { Start-Sleep -Seconds 2; $waited += 2 }
    }
    if (-not $pod) { throw "O pod do k6 nunca apareceu" }

    $waited = 0
    while ($true) {
        kubectl exec $pod -- test -f /results/done 2>$null
        if ($LASTEXITCODE -eq 0) { break }
        Start-Sleep -Seconds 5
        $waited += 5
        if ($waited -ge 240) { throw "Tempo esgotado aguardando o job do k6 '$pod' terminar" }
    }

    # kubectl cp can't disambiguate an absolute Windows path's drive-letter
    # colon from its own pod:path separator, so the destination must be
    # relative to the caller's cwd (perftest.ps1 already cd's to repo root).
    $relativeOutFile = [System.IO.Path]::GetRelativePath((Get-Location).Path, $OutFile)
    kubectl cp "${pod}:/results/summary.json" $relativeOutFile
    if ($LASTEXITCODE -ne 0) { throw "Falha ao copiar o summary.json do k6 (codigo de saida $LASTEXITCODE)" }
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

        # A single combo going wrong - low resources breaking the app, or a harness
        # hiccup like the k6-completion poll timing out - is one data point, not a
        # reason to abort every combo still queued behind it. Record what's known
        # and move on; only truly unrecoverable setup failures (resource patch,
        # missing pod) still stop the whole matrix.
        try {
            kubectl set resources "deployment/$($Config.container)" -c $Config.container `
                --limits="cpu=$cpu,memory=$mem" --requests="cpu=$cpu,memory=$mem"
            if ($LASTEXITCODE -ne 0) { throw "Falha ao definir os recursos (codigo de saida $LASTEXITCODE)" }

            kubectl rollout status "deployment/$($Config.container)" --timeout=120s
            $rolloutReady = ($LASTEXITCODE -eq 0)
            if ($rolloutReady) {
                Start-Sleep -Seconds 5
            } else {
                Write-Host "Rollout nao ficou pronto para memory=$mem cpu=$cpu - registrando falha e seguindo para a proxima combinacao." -ForegroundColor Yellow
            }

            $pod = kubectl get pod -l "app=$($Config.container)" -o jsonpath='{.items[0].metadata.name}'
            if (-not $pod) { throw "Nenhum pod encontrado para app=$($Config.container) apos o ajuste de recursos" }

            $restartCount = kubectl get pod $pod -o jsonpath='{.status.containerStatuses[0].restartCount}'
            $lastReason = kubectl get pod $pod -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason}' 2>$null
            $oomFlag = if ($lastReason -eq 'OOMKilled') { 'yes' } else { 'no' }

            if ($rolloutReady) {
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
                $samplerJob = $null

                # Re-read after the load test - restarts/OOMs can also happen under load,
                # not just during rollout.
                $restartCount = kubectl get pod $pod -o jsonpath='{.status.containerStatuses[0].restartCount}'
                $lastReason = kubectl get pod $pod -o jsonpath='{.status.containerStatuses[0].lastState.terminated.reason}' 2>$null
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
        }
    }

    Write-Host "Matriz concluida. Resultados em $resultsPath" -ForegroundColor Green
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

Export-ModuleMember -Function New-PerftestCluster, Remove-PerftestCluster, Get-PerftestConfig, Get-PerftestResourceCombos, Deploy-PerftestApp, Publish-PerftestLoadScript, Invoke-PerftestMatrix, Test-PerftestPrerequisites
