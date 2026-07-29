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
