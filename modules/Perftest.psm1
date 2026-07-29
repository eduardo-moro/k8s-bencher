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

Export-ModuleMember -Function New-PerftestCluster, Remove-PerftestCluster, Get-PerftestConfig, Get-PerftestResourceCombos
