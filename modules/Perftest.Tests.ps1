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

    It 'defaults sampleIntervalSeconds to 5 when omitted' {
        $configPath = Join-Path $fixtureDir 'no-interval.yaml'
        @'
name: my-app
manifest: manifests/my-app.yaml
container: app
script: loadtest/my-app.js
resources:
  memory: [256Mi]
  cpu: [250m]
load:
  vus: 15
  stages:
    - {duration: 20s, target: 15}
'@ | Set-Content -Path $configPath

        $config = Get-PerftestConfig -Path $configPath -RepoRoot $fixtureDir

        $config.sampleIntervalSeconds | Should -Be 5
    }

    It 'uses an explicit sampleIntervalSeconds override' {
        $configPath = Join-Path $fixtureDir 'with-interval.yaml'
        @'
name: my-app
manifest: manifests/my-app.yaml
container: app
script: loadtest/my-app.js
sampleIntervalSeconds: 15
resources:
  memory: [256Mi]
  cpu: [250m]
load:
  vus: 15
  stages:
    - {duration: 20s, target: 15}
'@ | Set-Content -Path $configPath

        $config = Get-PerftestConfig -Path $configPath -RepoRoot $fixtureDir

        $config.sampleIntervalSeconds | Should -Be 15
    }
}

Describe 'Write-PerftestRunMeta' {
    It 'writes totalDurationSeconds computed from StartTime to now' {
        $outputDir = Join-Path $fixtureDir "run-meta-$(Get-Random)"
        New-Item -ItemType Directory -Path $outputDir | Out-Null
        $start = (Get-Date).AddSeconds(-90)

        Write-PerftestRunMeta -OutputDir $outputDir -StartTime $start

        $metaPath = Join-Path $outputDir 'run-meta.json'
        Test-Path $metaPath | Should -Be $true
        $meta = Get-Content -Path $metaPath -Raw | ConvertFrom-Json
        # Allow slack for the test's own execution time between AddSeconds(-90) and the call above.
        $meta.totalDurationSeconds | Should -BeGreaterOrEqual 90
        $meta.totalDurationSeconds | Should -BeLessThan 100
    }
}

Describe 'Get-PerftestStagesTotalSeconds' {
    It 'sums plain-second stage durations' {
        $stages = @(
            [PSCustomObject]@{ duration = '30s'; target = 20 },
            [PSCustomObject]@{ duration = '300s'; target = 20 },
            [PSCustomObject]@{ duration = '30s'; target = 0 }
        )
        Get-PerftestStagesTotalSeconds -Stages $stages | Should -Be 360
    }

    It 'handles minute and hour units, mixed with seconds' {
        $stages = @(
            [PSCustomObject]@{ duration = '1m'; target = 10 },
            [PSCustomObject]@{ duration = '1h'; target = 10 }
        )
        Get-PerftestStagesTotalSeconds -Stages $stages | Should -Be 3660
    }

    It 'ignores stages with an unparseable duration instead of throwing' {
        $stages = @(
            [PSCustomObject]@{ duration = '30s'; target = 10 },
            [PSCustomObject]@{ duration = 'bogus'; target = 10 }
        )
        Get-PerftestStagesTotalSeconds -Stages $stages | Should -Be 30
    }
}

Describe 'ConvertTo-PerftestBytes' {
    It 'converts Ki/Mi/Gi suffixes to binary byte counts' {
        ConvertTo-PerftestBytes -Quantity '512Ki' | Should -Be 524288
        ConvertTo-PerftestBytes -Quantity '512Mi' | Should -Be 536870912
        ConvertTo-PerftestBytes -Quantity '2Gi' | Should -Be 2147483648
    }

    It 'accepts fractional values' {
        ConvertTo-PerftestBytes -Quantity '1.5Gi' | Should -Be 1610612736
    }

    It 'throws on an unrecognized suffix' {
        { ConvertTo-PerftestBytes -Quantity '512m' } | Should -Throw '*invalida*'
    }
}

Describe 'ConvertTo-PerftestHexBytes' {
    It 'converts a memory quantity straight to its full hex byte count' {
        ConvertTo-PerftestHexBytes -Quantity '512Mi' | Should -Be '0x20000000'
        ConvertTo-PerftestHexBytes -Quantity '768Mi' | Should -Be '0x30000000'
    }
}

Describe 'Get-PerftestGcHeapHardLimitHex' {
    It 'applies the 80% headroom fraction to the container memory limit' {
        # 512Mi * 0.8 = 409.6Mi = 429496729.6 bytes, floored.
        Get-PerftestGcHeapHardLimitHex -MemoryQuantity '512Mi' | Should -Be '0x19999999'
        # 768Mi * 0.8 = 614.4Mi = 644245094.4 bytes, floored.
        Get-PerftestGcHeapHardLimitHex -MemoryQuantity '768Mi' | Should -Be '0x26666666'
    }

    It 'always yields a value strictly lower than the full memory quantity in bytes' {
        $full = ConvertTo-PerftestBytes -Quantity '256Mi'
        $withHeadroom = [Convert]::ToInt64((Get-PerftestGcHeapHardLimitHex -MemoryQuantity '256Mi'), 16)
        $withHeadroom | Should -BeLessThan $full
    }
}

Describe 'Get-PerftestManifestImages' {
    It 'extracts a single unquoted image reference' {
        $manifest = @'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  template:
    spec:
      containers:
        - name: myapp
          image: myapp:latest
'@
        Get-PerftestManifestImages -ManifestContent $manifest | Should -Be @('myapp:latest')
    }

    It 'extracts images across multiple --- separated documents and dedupes repeats' {
        $manifest = @'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp
spec:
  template:
    spec:
      containers:
        - name: myapp
          image: "myapp:latest"
        - name: sidecar
          image: 'myapp:latest'
---
apiVersion: v1
kind: Service
metadata:
  name: myapp
spec:
  selector:
    app: myapp
  ports:
    - port: 80
'@
        Get-PerftestManifestImages -ManifestContent $manifest | Should -Be @('myapp:latest')
    }

    It 'returns an empty array when the manifest has no image field' {
        $manifest = @'
apiVersion: v1
kind: Service
metadata:
  name: myapp
spec:
  selector:
    app: myapp
'@
        @(Get-PerftestManifestImages -ManifestContent $manifest).Count | Should -Be 0
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
