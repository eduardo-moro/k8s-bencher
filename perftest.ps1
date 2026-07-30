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
    [string]$Config
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
Import-Module (Join-Path $PSScriptRoot 'modules/Perftest.psm1') -Force

function Invoke-PerftestRun {
    param([string]$ConfigPath)
    if (-not $ConfigPath) { throw "O parametro -Config <caminho> e obrigatorio" }
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
    'Check' {
        $ready = Test-PerftestPrerequisites
        if (-not $ready) { exit 1 }
    }
    default {
        Write-Host "Uso: perftest.ps1 -Cluster | -Run -Config <caminho> | -Teardown | -All -Config <caminho> | -Full -Config <caminho> | -Check" -ForegroundColor Yellow
    }
}
