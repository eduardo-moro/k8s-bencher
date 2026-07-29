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
