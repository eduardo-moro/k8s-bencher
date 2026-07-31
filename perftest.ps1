[CmdletBinding(DefaultParameterSetName = 'Help')]
param(
    [Parameter(ParameterSetName = 'Cluster')] [switch]$Cluster,
    [Parameter(ParameterSetName = 'Run')] [switch]$Run,
    [Parameter(ParameterSetName = 'Teardown')] [switch]$Teardown,
    [Parameter(ParameterSetName = 'All')] [switch]$All,
    [Parameter(ParameterSetName = 'Full')] [switch]$Full,
    [Parameter(ParameterSetName = 'Check')] [switch]$Check,
    [Parameter(ParameterSetName = 'Run')]
    [Parameter(ParameterSetName = 'All')]
    [Parameter(ParameterSetName = 'Full')]
    [string]$Config,
    [Parameter(ParameterSetName = 'Run')]
    [Parameter(ParameterSetName = 'All')]
    [Parameter(ParameterSetName = 'Full')]
    [string]$DataRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'modules/Perftest.psm1') -Force

function Invoke-PerftestRun {
    param([string]$ConfigPath, [string]$DataRootPath)
    if (-not $ConfigPath) { throw "O parametro -Config <caminho> e obrigatorio" }
    $parsedConfig = Get-PerftestConfig -Path $ConfigPath -RepoRoot $DataRootPath
    Deploy-PerftestApp -Config $parsedConfig
    Publish-PerftestLoadScript -Config $parsedConfig
    $timestamp = (Get-Date).ToString('yyyy-MM-ddTHH-mm-ss')
    $outputDir = Join-Path $DataRootPath "output/$($parsedConfig.name)-$timestamp"
    Invoke-PerftestMatrix -Config $parsedConfig -OutputDir $outputDir
}

$effectiveDataRoot = if ($DataRoot) { $DataRoot } else { $PSScriptRoot }

switch ($PSCmdlet.ParameterSetName) {
    'Cluster'  { New-PerftestCluster }
    'Run'      { Invoke-PerftestRun -ConfigPath $Config -DataRootPath $effectiveDataRoot }
    'Teardown' { Remove-PerftestCluster }
    'All' {
        New-PerftestCluster
        Invoke-PerftestRun -ConfigPath $Config -DataRootPath $effectiveDataRoot
    }
    'Full' {
        New-PerftestCluster
        Invoke-PerftestRun -ConfigPath $Config -DataRootPath $effectiveDataRoot
        Remove-PerftestCluster
    }
    'Check' {
        $ready = Test-PerftestPrerequisites
        if (-not $ready) { exit 1 }
    }
    default {
        Write-Host "Uso: perftest.ps1 -Cluster | -Run -Config <caminho> [-DataRoot <pasta>] | -Teardown | -All -Config <caminho> [-DataRoot <pasta>] | -Full -Config <caminho> [-DataRoot <pasta>] | -Check" -ForegroundColor Yellow
    }
}
