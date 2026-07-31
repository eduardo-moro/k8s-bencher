# Electron Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package `k8s-perftest`'s existing API + frontend as a single-file Windows Electron installer, with a user-configurable data folder and a first-launch prerequisite check — without touching what the engine or API actually do.

**Architecture:** Split the one `repoRoot` concept used throughout the PowerShell engine and the API into two: `engineRoot` (bundled, read-only — `perftest.ps1`, `modules/`, `manifests/kind-config.yaml`, `manifests/k6-job-template.yaml`, `templates/`) and `dataRoot` (user-configurable, writable — `configs/`, `manifests/<app>.yaml`, `loadtest/<app>.js`, `output/`). A new `interface/electron/` project owns settings persistence, spawns the compiled API as a child process with both roots and a fixed port passed via env vars, and serves the frontend's static SPA build (a new build mode alongside the existing SSR dev flow, which is untouched).

**Tech Stack:** Electron + electron-builder (NSIS), existing Fastify API (compiled via `tsc` instead of run via `tsx` for packaging), existing TanStack Start frontend (new static-SPA build mode).

## Global Constraints

- Local dev (`make interface`, `npm run dev`, `npm test` in `interface/API`) must keep working exactly as today — every change here is additive (new optional params/env vars with defaults matching current behavior), never a breaking change to an existing default.
- Fixed port `8026` for the packaged API — matches the port already established as this project's real default (`interface/API/src/server.ts`'s `isMainModule` block, committed by the user in `2d67006`).
- No auth, no i18n framework — matches every other constraint already established in this repo.
- Windows-only packaging (NSIS via electron-builder) — matches the engine's own Windows/PowerShell/Docker-Desktop assumption.
- New dependencies only in the specific `package.json` that needs them (`interface/electron/package.json` gets `electron`/`electron-builder`; `interface/API/package.json` gets nothing new beyond what Task 6 adds for the build script, which is TypeScript itself, already a devDependency).

---

### Task 1: `perftest.ps1` — add `-DataRoot` parameter

**Files:**
- Modify: `perftest.ps1`

**Interfaces:**
- Consumes: nothing new.
- Produces: `perftest.ps1` accepts an optional `-DataRoot <path>` alongside `-Run`/`-All`/`-Full`. Defaults to `$PSScriptRoot` (today's behavior) when omitted. Used by Task 3's `JobRunner` to pass the Electron-configured data folder.

- [ ] **Step 1: Replace `perftest.ps1`**

```powershell
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
```

- [ ] **Step 2: Manually verify the existing dev flow still works unchanged**

```bash
pwsh -File perftest.ps1 -Check
```
Expected: same output as before (prerequisite check unaffected — `-DataRoot` isn't used by the `Check` parameter set at all).

```bash
pwsh -NoProfile -Command "& { . { param(\$DataRoot) } }; Set-Location $PWD; pwsh -File perftest.ps1 -Run -Config configs/example.yaml"
```
(Simpler: just run `pwsh -File perftest.ps1 -Run -Config configs/example.yaml` from the repo root, no `-DataRoot` flag, and confirm it behaves exactly as before — reads `configs/example.yaml` relative to the repo root, writes to `output/` relative to the repo root. This is the existing `configs/example.yaml` from earlier manual testing sessions; if it's not present, `make demo-setup` recreates it from `templates/`.)
Expected: rollout/matrix output identical to prior runs in this repo — `-DataRoot`'s default (`$PSScriptRoot`) preserves current behavior exactly.

- [ ] **Step 3: Commit**

```bash
git add perftest.ps1
git commit -m "Add optional -DataRoot parameter to perftest.ps1, defaulting to today's behavior"
```

---

### Task 2: `configFiles.ts` — split `repoRoot` into `engineRoot` + `dataRoot`

**Files:**
- Modify: `interface/API/src/lib/configFiles.ts`
- Modify: `interface/API/src/lib/configFiles.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `ConfigFiles`'s constructor becomes `(dataRoot: string, engineRoot?: string)` — `engineRoot` defaults to `dataRoot` when omitted (preserves today's single-root behavior for every existing caller/test). `configs/`, `manifests/`, `loadtest/` resolve against `dataRoot`; `templates/` (used only by `getTemplateExample`) resolves against `engineRoot`. Used by Task 5 (`server.ts`) and Task 3 (`jobRunner.ts`).

- [ ] **Step 1: Update the failing/changed test**

`configFiles.test.ts` already constructs `new ConfigFiles(repoRoot)` with a single temp dir containing both `configs/manifests/loadtest/templates` — that still passes unchanged (single-arg constructor still works, `engineRoot` defaults to `dataRoot`). Add one new test proving the split works, appended to the existing `describe('ConfigFiles', ...)` block right after the `'getTemplateExample reads from templates/'` test:

```typescript
  it('reads templates from a separate engineRoot when provided', async () => {
    const engineRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'perftest-api-test-engine-'));
    await fs.mkdir(path.join(engineRoot, 'templates'), { recursive: true });
    await fs.writeFile(
      path.join(engineRoot, 'templates/config.example.yaml'),
      'name: httpbin-example\nmanifest: manifests/httpbin.yaml\ncontainer: httpbin\nscript: loadtest/httpbin.js\nresources:\n  memory: [128Mi]\n  cpu: [100m]\nload:\n  vus: 15\n  stages:\n    - {duration: 10s, target: 15}\n'
    );
    await fs.writeFile(path.join(engineRoot, 'templates/manifest.example.yaml'), 'kind: Deployment\n');
    await fs.writeFile(path.join(engineRoot, 'templates/loadtest.example.js'), 'export default function(){}\n');

    const splitConfigFiles = new ConfigFiles(repoRoot, engineRoot);
    const template = await splitConfigFiles.getTemplateExample();
    expect(template.name).toBe('httpbin-example');

    await fs.rm(engineRoot, { recursive: true, force: true });
  });
```

- [ ] **Step 2: Run tests to verify the new one fails**

```bash
cd interface/API
npm test
```
Expected: FAIL on the new test — `ConfigFiles` constructor only takes one argument today, so `getTemplateExample` still reads `templates/` from `repoRoot` (the first temp dir, which has no `templates/` dir in this new test) rather than `engineRoot`, throwing an `ENOENT`.

- [ ] **Step 3: Replace `configFiles.ts`**

```typescript
import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { NotFoundError, ConflictError } from './errors.js';

export interface StageConfig {
  duration: string;
  target: number;
}

export interface ResourcesConfig {
  memory: string[];
  cpu: string[];
}

export interface LoadConfig {
  vus: number;
  stages: StageConfig[];
}

export interface AppConfig {
  name: string;
  container: string;
  resources: ResourcesConfig;
  load: LoadConfig;
}

export interface AppDetail extends AppConfig {
  manifestContent: string;
  scriptContent: string;
}

export interface AppSummary {
  name: string;
  container: string;
  resources: ResourcesConfig;
}

interface RawConfigYaml {
  name: string;
  manifest: string;
  container: string;
  script: string;
  resources: ResourcesConfig;
  load: LoadConfig;
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, filePath);
}

async function fileExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false
  );
}

export class ConfigFiles {
  private engineRoot: string;

  constructor(private dataRoot: string, engineRoot?: string) {
    this.engineRoot = engineRoot ?? dataRoot;
  }

  private configPath(name: string): string {
    return path.join(this.dataRoot, 'configs', `${name}.yaml`);
  }

  async listApps(): Promise<AppSummary[]> {
    const configsDir = path.join(this.dataRoot, 'configs');
    let entries: string[];
    try {
      entries = await fs.readdir(configsDir);
    } catch {
      return [];
    }

    const summaries: AppSummary[] = [];
    for (const file of entries.filter((f) => f.endsWith('.yaml'))) {
      const raw = await fs.readFile(path.join(configsDir, file), 'utf8');
      const parsed = YAML.parse(raw) as RawConfigYaml;
      summaries.push({
        name: file.replace(/\.yaml$/, ''),
        container: parsed.container,
        resources: parsed.resources,
      });
    }
    return summaries;
  }

  async getApp(name: string): Promise<AppDetail> {
    const configFile = this.configPath(name);
    if (!(await fileExists(configFile))) {
      throw new NotFoundError(`App '${name}' not found`);
    }

    const raw = await fs.readFile(configFile, 'utf8');
    const parsed = YAML.parse(raw) as RawConfigYaml;
    const manifestContent = await fs.readFile(path.join(this.dataRoot, parsed.manifest), 'utf8');
    const scriptContent = await fs.readFile(path.join(this.dataRoot, parsed.script), 'utf8');

    return {
      name: parsed.name,
      container: parsed.container,
      resources: parsed.resources,
      load: parsed.load,
      manifestContent,
      scriptContent,
    };
  }

  async createApp(detail: AppDetail): Promise<void> {
    const configFile = this.configPath(detail.name);
    if (await fileExists(configFile)) {
      throw new ConflictError(`App '${detail.name}' already exists`);
    }

    const manifestRelPath = `manifests/${detail.name}.yaml`;
    const scriptRelPath = `loadtest/${detail.name}.js`;

    const rawConfig: RawConfigYaml = {
      name: detail.name,
      manifest: manifestRelPath,
      container: detail.container,
      script: scriptRelPath,
      resources: detail.resources,
      load: detail.load,
    };

    await fs.mkdir(path.join(this.dataRoot, 'manifests'), { recursive: true });
    await fs.mkdir(path.join(this.dataRoot, 'loadtest'), { recursive: true });
    await fs.mkdir(path.join(this.dataRoot, 'configs'), { recursive: true });

    await atomicWrite(path.join(this.dataRoot, manifestRelPath), detail.manifestContent);
    await atomicWrite(path.join(this.dataRoot, scriptRelPath), detail.scriptContent);
    await atomicWrite(configFile, YAML.stringify(rawConfig));
  }

  async updateApp(name: string, partial: Partial<AppDetail>): Promise<AppDetail> {
    const configFile = this.configPath(name);
    if (!(await fileExists(configFile))) {
      throw new NotFoundError(`App '${name}' not found`);
    }

    const raw = await fs.readFile(configFile, 'utf8');
    const parsed = YAML.parse(raw) as RawConfigYaml;

    if (partial.manifestContent !== undefined) {
      await atomicWrite(path.join(this.dataRoot, parsed.manifest), partial.manifestContent);
    }
    if (partial.scriptContent !== undefined) {
      await atomicWrite(path.join(this.dataRoot, parsed.script), partial.scriptContent);
    }

    const updatedRaw: RawConfigYaml = {
      ...parsed,
      container: partial.container ?? parsed.container,
      resources: partial.resources ?? parsed.resources,
      load: partial.load ?? parsed.load,
    };
    await atomicWrite(configFile, YAML.stringify(updatedRaw));

    return this.getApp(name);
  }

  async deleteApp(name: string): Promise<void> {
    const configFile = this.configPath(name);
    if (!(await fileExists(configFile))) {
      throw new NotFoundError(`App '${name}' not found`);
    }

    const raw = await fs.readFile(configFile, 'utf8');
    const parsed = YAML.parse(raw) as RawConfigYaml;

    await fs.rm(path.join(this.dataRoot, parsed.manifest), { force: true });
    await fs.rm(path.join(this.dataRoot, parsed.script), { force: true });
    await fs.rm(configFile, { force: true });
  }

  async getTemplateExample(): Promise<AppDetail> {
    const templatesDir = path.join(this.engineRoot, 'templates');
    const raw = await fs.readFile(path.join(templatesDir, 'config.example.yaml'), 'utf8');
    const parsed = YAML.parse(raw) as RawConfigYaml;
    const manifestContent = await fs.readFile(path.join(templatesDir, 'manifest.example.yaml'), 'utf8');
    const scriptContent = await fs.readFile(path.join(templatesDir, 'loadtest.example.js'), 'utf8');

    return {
      name: parsed.name,
      container: parsed.container,
      resources: parsed.resources,
      load: parsed.load,
      manifestContent,
      scriptContent,
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd interface/API
npm test
```
Expected: PASS, all existing tests plus the one new test (10 tests in this file now).

- [ ] **Step 5: Commit**

```bash
git add interface/API/src/lib/configFiles.ts interface/API/src/lib/configFiles.test.ts
git commit -m "Split ConfigFiles' repoRoot into dataRoot + engineRoot"
```

---

### Task 3: `jobRunner.ts` — split `repoRoot`, pass `-DataRoot` to the spawned engine

**Files:**
- Modify: `interface/API/src/lib/jobRunner.ts`
- Modify: `interface/API/src/lib/jobRunner.test.ts`

**Interfaces:**
- Consumes: `ConfigFiles` from Task 2 (now `(dataRoot, engineRoot?)`).
- Produces: `JobRunner`'s constructor becomes `(dataRoot: string, engineRoot?: string, options?: {...})` — `engineRoot` defaults to `dataRoot`. The default `buildRunCommand` now passes `-DataRoot <dataRoot>` to `perftest.ps1` (which lives under `engineRoot`). `configs/<name>.yaml` and `output/` resolve against `dataRoot`; the `perftest.ps1` path itself resolves against `engineRoot`.

- [ ] **Step 1: Add a failing test**

The existing `jobRunner.test.ts` always supplies a custom `buildRunCommand`/`buildTeardownCommand` (bypassing the real default), so none of the existing tests exercise the default command construction. Add a new test proving the default wiring is correct, appended after the `'getCurrentJob returns null before any run has started'` test:

```typescript
  it('default buildRunCommand points at engineRoot/perftest.ps1 and passes -DataRoot dataRoot', async () => {
    const engineRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'perftest-api-jobrunner-engine-'));
    const runner = new JobRunner(repoRoot, engineRoot, { pollIntervalMs: 50 });

    const expectedPerftestPath = path.join(engineRoot, 'perftest.ps1');
    const expectedConfigPath = path.join(repoRoot, 'configs/testapp.yaml');

    // startRun will fail fast (no real pwsh needed to fail) once it tries to
    // spawn a literal 'pwsh' - what matters is the args array shape it built
    // before spawning, so spy on child_process.spawn and fake a minimal
    // ChildProcess-shaped EventEmitter rather than letting the real spawn run.
    const cp = await import('node:child_process');
    const spawnSpy = vi.spyOn(cp, 'spawn').mockImplementation((..._args: unknown[]) => {
      const fake = new EventEmitter() as unknown as ChildProcess;
      (fake as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
      (fake as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
      return fake;
    });

    await runner.startRun('testapp');

    expect(spawnSpy).toHaveBeenCalledWith(
      'pwsh',
      ['-File', expectedPerftestPath, '-Full', '-Config', expectedConfigPath, '-DataRoot', repoRoot],
      { cwd: repoRoot }
    );

    spawnSpy.mockRestore();
    await fs.rm(engineRoot, { recursive: true, force: true });
  });
```

This test needs two additions to the file's existing top-of-file imports:
- Extend the existing `import { describe, it, expect, beforeEach, afterEach } from 'vitest';` to also import `vi`.
- Add `import { EventEmitter } from 'node:events';` and `import type { ChildProcess } from 'node:child_process';` as new top-level imports (both plain ESM imports — this project is `"type": "module"`, so `require()` is not available inside these test files; only `import` works).

- [ ] **Step 2: Run tests to verify the new one fails**

```bash
cd interface/API
npm test
```
Expected: FAIL — `JobRunner`'s constructor only takes `(repoRoot, options?)` today, so the second positional argument (`engineRoot`) is silently ignored as `options`, and the default `buildRunCommand` doesn't append `-DataRoot` at all — the `toHaveBeenCalledWith` assertion fails on the args array shape.

- [ ] **Step 3: Replace `jobRunner.ts`**

```typescript
import { spawn, ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ConfigFiles } from './configFiles.js';
import { ConflictError } from './errors.js';

export type JobStatus = 'starting' | 'running' | 'done' | 'failed';

export interface JobState {
  appName: string;
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  logTail: string;
  outputDir?: string;
}

export interface CommandSpec {
  command: string;
  args: string[];
}

const MAX_LOG_CHARS = 20000;
const DEFAULT_POLL_INTERVAL_MS = 1000;

export class JobRunner {
  private currentJob: JobState | null = null;
  private currentProcess: ChildProcess | null = null;
  private outputPollTimer: NodeJS.Timeout | null = null;
  private configFiles: ConfigFiles;
  private buildRunCommand: (configRelPath: string) => CommandSpec;
  private buildTeardownCommand: () => CommandSpec;
  private pollIntervalMs: number;

  constructor(
    private dataRoot: string,
    engineRoot?: string,
    options?: {
      buildRunCommand?: (configRelPath: string) => CommandSpec;
      buildTeardownCommand?: () => CommandSpec;
      pollIntervalMs?: number;
    }
  ) {
    const resolvedEngineRoot = engineRoot ?? dataRoot;
    this.configFiles = new ConfigFiles(dataRoot, resolvedEngineRoot);
    this.buildRunCommand =
      options?.buildRunCommand ??
      ((configRelPath: string) => ({
        command: 'pwsh',
        args: [
          '-File',
          path.join(resolvedEngineRoot, 'perftest.ps1'),
          '-Full',
          '-Config',
          path.join(dataRoot, configRelPath),
          '-DataRoot',
          dataRoot,
        ],
      }));
    this.buildTeardownCommand =
      options?.buildTeardownCommand ??
      (() => ({ command: 'pwsh', args: ['-File', path.join(resolvedEngineRoot, 'perftest.ps1'), '-Teardown'] }));
    this.pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  getCurrentJob(): JobState | null {
    return this.currentJob;
  }

  async startRun(appName: string): Promise<JobState> {
    if (this.currentJob && (this.currentJob.status === 'starting' || this.currentJob.status === 'running')) {
      throw new ConflictError('A run is already in progress');
    }

    const app = await this.configFiles.getApp(appName);
    const outputPrefix = app.name;
    const spawnTime = Date.now();
    const configRelPath = `configs/${appName}.yaml`;
    const { command, args } = this.buildRunCommand(configRelPath);

    const job: JobState = {
      appName,
      status: 'starting',
      startedAt: new Date(spawnTime).toISOString(),
      logTail: '',
    };
    this.currentJob = job;

    const child = spawn(command, args, { cwd: this.dataRoot });
    this.currentProcess = child;
    job.status = 'running';

    const appendLog = (chunk: Buffer) => {
      job.logTail = (job.logTail + chunk.toString()).slice(-MAX_LOG_CHARS);
    };
    child.stdout?.on('data', appendLog);
    child.stderr?.on('data', appendLog);

    const pollTimer = setInterval(() => {
      void this.findNewOutputDir(outputPrefix, spawnTime).then((dir) => {
        if (dir) {
          job.outputDir = dir;
          if (this.outputPollTimer === pollTimer) {
            this.stopPolling();
          }
        }
      });
    }, this.pollIntervalMs);
    this.outputPollTimer = pollTimer;

    child.on('exit', (code) => {
      job.status = code === 0 ? 'done' : 'failed';
      job.exitCode = code ?? undefined;
      job.finishedAt = new Date().toISOString();
      if (this.outputPollTimer === pollTimer) {
        this.stopPolling();
      }
      if (this.currentProcess === child) {
        this.currentProcess = null;
      }
    });

    return job;
  }

  private stopPolling(): void {
    if (this.outputPollTimer) {
      clearInterval(this.outputPollTimer);
      this.outputPollTimer = null;
    }
  }

  private async findNewOutputDir(prefix: string, afterMs: number): Promise<string | undefined> {
    const outputRoot = path.join(this.dataRoot, 'output');
    let entries: string[];
    try {
      entries = await fs.readdir(outputRoot);
    } catch {
      return undefined;
    }

    for (const entry of entries) {
      if (!entry.startsWith(`${prefix}-`)) continue;
      const stat = await fs.stat(path.join(outputRoot, entry)).catch(() => null);
      if (stat && stat.birthtimeMs >= afterMs) {
        return entry;
      }
    }
    return undefined;
  }

  async cancelCurrentJob(): Promise<void> {
    if (this.currentProcess) {
      this.currentProcess.kill();
    }
    this.stopPolling();

    const { command, args } = this.buildTeardownCommand();
    await new Promise<void>((resolve) => {
      const teardown = spawn(command, args, { cwd: this.dataRoot });
      teardown.on('exit', () => resolve());
      teardown.on('error', () => resolve());
    });

    this.currentJob = null;
    this.currentProcess = null;
  }
}
```

Note: every existing call site in `jobRunner.test.ts` does `new JobRunner(repoRoot, { pollIntervalMs: 50, buildRunCommand: ..., buildTeardownCommand: ... })` — a single `repoRoot` arg followed by the options object. With the new signature `(dataRoot, engineRoot?, options?)`, that options object is now being passed positionally as `engineRoot`, which is wrong. **Every existing test call must be updated** from `new JobRunner(repoRoot, { ... })` to `new JobRunner(repoRoot, repoRoot, { ... })` (both roots equal, matching this project's dev-flow default). Do this as part of Step 3 — search `jobRunner.test.ts` for every `new JobRunner(` call and fix each one.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd interface/API
npm test
```
Expected: PASS — all prior `JobRunner` tests (updated to pass `repoRoot` twice) plus the new default-command test.

- [ ] **Step 5: Commit**

```bash
git add interface/API/src/lib/jobRunner.ts interface/API/src/lib/jobRunner.test.ts
git commit -m "Split JobRunner's repoRoot into dataRoot + engineRoot, pass -DataRoot to the engine"
```

---

### Task 4: `outputs.ts` + `check.ts` — wire `dataRoot`/`engineRoot` correctly

**Files:**
- Modify: `interface/API/src/routes/outputs.ts`
- Modify: `interface/API/src/routes/outputs.test.ts`
- Modify: `interface/API/src/routes/check.ts`
- Modify: `interface/API/src/routes/check.test.ts`

**Interfaces:**
- Consumes: `ConfigFiles` from Task 2.
- Produces: `registerOutputRoutes(app, configFiles, dataRoot: string)` (parameter renamed from `repoRoot` — `output/` is user data, not engine files, so it must resolve against `dataRoot`). `registerCheckRoute(app, engineRoot: string, options?)` (parameter renamed from `repoRoot` — `perftest.ps1 -Check` is an engine file, so it must resolve against `engineRoot`).

- [ ] **Step 1: Rename the parameter in `outputs.ts`**

This is a pure rename (`repoRoot` → `dataRoot`) everywhere it appears in the file — no behavioral change, since `output/` was always meant to be user data and every existing test already passes a single root that now correctly maps to `dataRoot`.

```typescript
import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ConfigFiles } from '../lib/configFiles.js';
import { parseResultsCsv } from '../lib/resultsCsv.js';
import { statusForError, NotFoundError, ValidationError } from '../lib/errors.js';

async function assertOwnedOutputFolder(
  configFiles: ConfigFiles,
  dataRoot: string,
  name: string,
  folder: string
): Promise<void> {
  if (folder.includes('..') || folder.includes('/') || folder.includes('\\')) {
    throw new ValidationError(`Invalid output folder name '${folder}'`);
  }

  const appDetail = await configFiles.getApp(name);
  if (!folder.startsWith(`${appDetail.name}-`)) {
    throw new NotFoundError(`Output folder '${folder}' does not belong to app '${name}'`);
  }

  const folderPath = path.join(dataRoot, 'output', folder);
  const stat = await fs.stat(folderPath).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new NotFoundError(`Output folder '${folder}' not found`);
  }
}

export function registerOutputRoutes(app: FastifyInstance, configFiles: ConfigFiles, dataRoot: string): void {
  app.get('/apps/:name/outputs', async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      const appDetail = await configFiles.getApp(name);
      const outputRoot = path.join(dataRoot, 'output');
      let entries: string[];
      try {
        entries = await fs.readdir(outputRoot);
      } catch {
        entries = [];
      }

      const matches = entries.filter((e) => e.startsWith(`${appDetail.name}-`));
      const withStats = await Promise.all(
        matches.map(async (folder) => {
          const stat = await fs.stat(path.join(outputRoot, folder));
          return { folder, timestamp: stat.birthtime.toISOString() };
        })
      );
      withStats.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
      return withStats;
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });

  app.get('/apps/:name/outputs/:folder', async (req, reply) => {
    const { name, folder } = req.params as { name: string; folder: string };
    try {
      await assertOwnedOutputFolder(configFiles, dataRoot, name, folder);
      const csvText = await fs.readFile(path.join(dataRoot, 'output', folder, 'results.csv'), 'utf8');
      return { rows: parseResultsCsv(csvText) };
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });

  app.get('/apps/:name/outputs/:folder/raw', async (req, reply) => {
    const { name, folder } = req.params as { name: string; folder: string };
    try {
      await assertOwnedOutputFolder(configFiles, dataRoot, name, folder);
      const csvText = await fs.readFile(path.join(dataRoot, 'output', folder, 'results.csv'), 'utf8');
      reply.header('Content-Type', 'text/csv');
      return csvText;
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });
}
```

No test changes needed in `outputs.test.ts` — it calls `registerOutputRoutes(app, configFiles, repoRoot)` positionally, and that variable already refers to the one temp dir this test uses for everything, which is exactly what `dataRoot` means here too.

- [ ] **Step 2: Rename the parameter in `check.ts`**

Same pure rename, the other direction (`repoRoot` → `engineRoot`, since `-Check` reads `perftest.ps1` itself):

```typescript
import type { FastifyInstance } from 'fastify';
import { spawn } from 'node:child_process';
import path from 'node:path';

export interface CheckResult {
  ready: boolean;
  output: string;
}

function defaultRunCheck(engineRoot: string): Promise<CheckResult> {
  return new Promise((resolve) => {
    const child = spawn('pwsh', ['-File', path.join(engineRoot, 'perftest.ps1'), '-Check'], { cwd: engineRoot });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('exit', (code) => resolve({ ready: code === 0, output }));
  });
}

export function registerCheckRoute(
  app: FastifyInstance,
  engineRoot: string,
  options?: { runCheck?: () => Promise<CheckResult> }
): void {
  const runCheck = options?.runCheck ?? (() => defaultRunCheck(engineRoot));
  app.get('/check', async () => runCheck());
}
```

`check.test.ts` doesn't need changes — it always passes `options.runCheck` directly (bypassing `defaultRunCheck`), so the parameter rename doesn't affect it.

- [ ] **Step 3: Run tests to verify they pass**

```bash
cd interface/API
npm test
```
Expected: PASS, no test count change (39 tests, same as before Task 2/3 added their two new ones — 41 total now).

- [ ] **Step 4: Commit**

```bash
git add interface/API/src/routes/outputs.ts interface/API/src/routes/check.ts
git commit -m "Rename outputs.ts/check.ts repoRoot params to dataRoot/engineRoot"
```

---

### Task 5: `server.ts` — wire `engineRoot`/`dataRoot`, env vars, static SPA serving

**Files:**
- Modify: `interface/API/src/server.ts`
- Modify: `interface/API/src/server.test.ts`
- Modify: `interface/API/package.json` (new dependency: `@fastify/static`)

**Interfaces:**
- Consumes: `ConfigFiles`/`JobRunner` from Tasks 2-3, `registerOutputRoutes`/`registerCheckRoute` from Task 4.
- Produces: `buildServer(options?: { dataRoot?: string; engineRoot?: string })` (replaces the old `{ repoRoot?: string }` — both new options default to the same repo-root-detection logic the old single option used, so existing dev/test behavior is unchanged). The `isMainModule` block reads `PORT`, `ENGINE_ROOT`, `DATA_ROOT` env vars (each falling back to today's defaults when unset — a plain `npm start` with no env vars behaves exactly as before). If `<engineRoot>/../frontend-dist` (see Task 7) exists, serves it as a static SPA with a wildcard fallback to `index.html`; otherwise this is a no-op (dev mode has no such folder).

- [ ] **Step 1: Install `@fastify/static`**

```bash
cd interface/API
npm install @fastify/static
```

- [ ] **Step 2: Update `server.test.ts`**

The existing test constructs `buildServer()` with no options (uses the real repo root — fine, unaffected) and `buildServer({ repoRoot })` is used by other route test files (`apps.test.ts`, `runs.test.ts`, `outputs.test.ts`) — check each of those and rename their `{ repoRoot }` call to `{ dataRoot: repoRoot, engineRoot: repoRoot }`, since with the split, a test temp dir needs to be both (it contains everything — configs, manifests, templates — in one place, matching the dev-flow default). Search every `buildServer({ repoRoot` occurrence across `interface/API/src/**/*.test.ts` and update it to `buildServer({ dataRoot: repoRoot, engineRoot: repoRoot }`.

`server.test.ts` itself needs no new test — `buildServer()` with no args is already covered, and the static-serving behavior (Step 4) only activates when a specific folder exists on disk, which none of the existing test temp dirs create, so it's implicitly exercised as a no-op by every existing test. Add one explicit test proving that no-op is safe, appended to the existing `describe('GET /health', ...)` block as a sibling `describe`:

```typescript
describe('static frontend serving', () => {
  it('does not error when no frontend-dist folder exists next to engineRoot', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/some-spa-route' });
    // No static folder in this test's engineRoot, so this 404s through
    // Fastify's default not-found handler rather than crashing - proving
    // the static-serving registration is conditional, not a hard dependency.
    expect(res.statusCode).toBe(404);
  });
});
```

- [ ] **Step 3: Run tests to verify the updated ones fail correctly**

```bash
cd interface/API
npm test
```
Expected: FAIL — every route test file still calls `buildServer({ repoRoot })`, which `buildServer`'s current signature accepts fine (it'll fail later, once Step 4 changes the signature) — actually at this point (before Step 4), the new `server.test.ts` test should already PASS (since `buildServer()` with no args works today) but this step's real purpose is confirming you've found every `{ repoRoot` call site before moving to Step 4's signature change. Grep first:

```bash
grep -rn "buildServer({ repoRoot" interface/API/src
```
Note every file it lists — each one needs its call updated in Step 5.

- [ ] **Step 4: Replace `server.ts`**

```typescript
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigFiles } from './lib/configFiles.js';
import { JobRunner } from './lib/jobRunner.js';
import { registerAppRoutes } from './routes/apps.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerOutputRoutes } from './routes/outputs.js';
import { registerCheckRoute } from './routes/check.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

export function buildServer(options?: { dataRoot?: string; engineRoot?: string }): FastifyInstance {
  const dataRoot = options?.dataRoot ?? DEFAULT_REPO_ROOT;
  const engineRoot = options?.engineRoot ?? DEFAULT_REPO_ROOT;

  const app = Fastify({ logger: true });
  // Local, single-user dev tool (same trust model as running perftest.ps1
  // directly) - the frontend's dev server port isn't fixed, so reflect
  // whatever Origin the browser sends rather than hardcoding one.
  void app.register(cors, { origin: true });
  app.get('/health', async () => ({ ok: true }));

  const configFiles = new ConfigFiles(dataRoot, engineRoot);
  const jobRunner = new JobRunner(dataRoot, engineRoot);
  registerAppRoutes(app, configFiles);
  registerRunRoutes(app, jobRunner);
  registerOutputRoutes(app, configFiles, dataRoot);
  registerCheckRoute(app, engineRoot);

  // Packaged (Electron) builds place the frontend's static SPA output at
  // <engineRoot>/frontend-dist (see Task 7); plain git-checkout dev mode
  // never has this folder, so this registration is a silent no-op there -
  // `make interface`/`npm run dev` always talk to the frontend's own dev
  // server instead, never to this route.
  const frontendDist = path.join(engineRoot, 'frontend-dist');
  if (existsSync(frontendDist)) {
    void app.register(fastifyStatic, { root: frontendDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/apps') && !req.url.startsWith('/jobs') &&
          !req.url.startsWith('/check') && !req.url.startsWith('/health') && !req.url.startsWith('/templates')) {
        return reply.sendFile('index.html');
      }
      reply.code(404).send({ error: 'Not Found' });
    });
  }

  return app;
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  const app = buildServer({
    dataRoot: process.env.DATA_ROOT ?? DEFAULT_REPO_ROOT,
    engineRoot: process.env.ENGINE_ROOT ?? DEFAULT_REPO_ROOT,
  });
  const port = process.env.PORT ? Number(process.env.PORT) : 8026;
  app.listen({ port, host: '0.0.0.0' }).then(() => {
    app.log.info(`perftest-api listening on port ${port}`);
  });
}
```

- [ ] **Step 5: Fix every other test file's `buildServer({ repoRoot })` call**

Using the grep output from Step 3, change each occurrence from:
```typescript
const app = buildServer({ repoRoot });
```
to:
```typescript
const app = buildServer({ dataRoot: repoRoot, engineRoot: repoRoot });
```
This applies to `apps.test.ts`, `runs.test.ts` (if it constructs a server this way — check; it may build `Fastify()` directly and call `registerRunRoutes` without going through `buildServer` at all, in which case it needs no change), and any other file the grep found.

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd interface/API
npm test
```
Expected: PASS, all tests green (42 total: 41 from before + 1 new static-serving test).

- [ ] **Step 7: Manually verify the real dev flow still works**

```bash
cd interface/API
npm start
```
In another terminal:
```bash
curl -s http://localhost:8026/health
```
Expected: `{"ok":true}` — no env vars set, defaults match today's real behavior exactly. Stop the server (Ctrl+C).

- [ ] **Step 8: Commit**

```bash
git add interface/API/src/server.ts interface/API/src/server.test.ts interface/API/src/routes/apps.test.ts interface/API/src/routes/runs.test.ts interface/API/package.json interface/API/package-lock.json
git commit -m "Wire dataRoot/engineRoot through buildServer, add conditional static SPA serving"
```

---

### Task 6: API build script for packaging

**Files:**
- Modify: `interface/API/package.json`

**Interfaces:**
- Consumes: nothing new.
- Produces: `npm run build` in `interface/API` compiles `src/**/*.ts` to `dist/**/*.js` via `tsc` (the existing `tsconfig.json` already has `outDir: "dist"` and `rootDir: "src"` — no tsconfig change needed, just the script). Used by Task 13's packaging step, which spawns `dist/server.js` directly with plain `node` instead of `tsx src/server.ts` (avoids bundling `tsx` and its dependency tree into the Electron package).

- [ ] **Step 1: Add the `build` script**

In `interface/API/package.json`, add `"build": "tsc"` to the `scripts` object (alongside the existing `dev`/`start`/`test`):

```json
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "tsx src/server.ts",
    "build": "tsc",
    "test": "vitest run"
  },
```

- [ ] **Step 2: Run the build and verify it produces runnable output**

```bash
cd interface/API
npm run build
node dist/server.js &
sleep 2
curl -s http://localhost:8026/health
```
Expected: `{"ok":true}` — the compiled JS runs standalone with plain `node`, no `tsx`/TypeScript-on-the-fly needed. Stop the background process (find its PID via `netstat`/`taskkill` on Windows, matching the pattern used throughout this project's other live-verification steps).

- [ ] **Step 3: Add `dist/` to `.gitignore` if not already covered**

```bash
grep -n "^dist" interface/API/.gitignore || echo "dist/" >> interface/API/.gitignore
```

- [ ] **Step 4: Commit**

```bash
git add interface/API/package.json interface/API/.gitignore
git commit -m "Add build script to compile the API for packaging"
```

---

### Task 7: Frontend — static SPA build mode for Electron

**Files:**
- Modify: `interface/frontend/vite.config.ts`
- Modify: `interface/frontend/package.json`

**Interfaces:**
- Consumes: nothing new.
- Produces: `npm run build:electron` in `interface/frontend` produces a static SPA build (SSR disabled) at `interface/frontend/dist/client` (TanStack Start's standard static-output location when SSR is off). Used by Task 13's packaging step, which copies this folder to become `<engineRoot>/frontend-dist` (referenced by Task 5's `server.ts`).

- [ ] **Step 1: Add an SSR-disabled Vite mode**

`@lovable.dev/vite-tanstack-config`'s `defineConfig` accepts a `tanstackStart` passthrough (already used for `server: { entry: "server" }`) and forwards unrecognized keys to the underlying `@tanstack/react-start` Vite plugin, which supports a top-level `spa: { enabled: true }` option to disable SSR entirely (pure client-side rendering, matching the design doc's decision). Update `vite.config.ts`:

```typescript
// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const isElectronBuild = process.env.BUILD_TARGET === "electron";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // Electron packaging only: disable SSR entirely and produce a plain
    // static SPA (interface/API's server.ts serves it as static files) -
    // a local desktop app gets no SEO/first-paint benefit from SSR, and
    // this avoids needing a second Node server process just for the
    // frontend. Local dev (npm run dev / make interface) never sets
    // BUILD_TARGET, so this stays false there - SSR dev flow unaffected.
    spa: isElectronBuild ? { enabled: true } : undefined,
  },
});
```

- [ ] **Step 2: Add the `build:electron` script**

In `interface/frontend/package.json`, add alongside the existing `build`/`build:dev`:

```json
    "build:electron": "cross-env BUILD_TARGET=electron vite build",
```

This needs the `cross-env` package (Windows `set VAR=val && cmd` vs. POSIX `VAR=val cmd` portability) — but since this project is Windows-only per this plan's constraints, a plain `set` would also work; using `cross-env` is still the safer, more standard choice in case this ever runs from a POSIX shell (Git Bash, which this whole project's `make` targets already assume). Install it:

```bash
cd interface/frontend
npm install --save-dev cross-env
```

- [ ] **Step 3: Run the build and verify static output**

```bash
cd interface/frontend
npm run build:electron
```
Expected: completes without error, produces `interface/frontend/dist/client/index.html` (or equivalent static entry point — inspect the actual output directory `vite build` reports in its final summary line and note the exact path for Task 13's packaging step, since TanStack Start's exact static-output directory name can vary by version).

```bash
ls interface/frontend/dist
```
Expected: a directory containing `index.html` and hashed JS/CSS asset files — a normal Vite SPA build output, no server-side files.

- [ ] **Step 4: Confirm normal dev mode still works unaffected**

```bash
cd interface/frontend
npm run dev
```
Expected: starts exactly as before (SSR, port auto-selected) — `BUILD_TARGET` is unset in dev, so `isElectronBuild` is `false` and `spa` stays `undefined` (TanStack Start's own default, i.e. today's behavior). Stop the server (Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add interface/frontend/vite.config.ts interface/frontend/package.json interface/frontend/package-lock.json
git commit -m "Add static SPA build mode for Electron packaging"
```

---

### Task 8: Frontend — `window.electronAPI` types + Settings modal

**Files:**
- Create: `interface/frontend/src/lib/electron.ts`
- Create: `interface/frontend/src/components/SettingsDialog.tsx`

**Interfaces:**
- Produces: `isElectron(): boolean` (feature-detects `window.electronAPI`), `type ElectronAPI` (the contract Task 12's preload script implements: `pickDataFolder(): Promise<string | null>`, `getDataRoot(): Promise<string>`, `setDataRoot(path: string): Promise<void>`), and `SettingsDialog` — a modal component shown only when `isElectron()` is true, used by Task 9.

- [ ] **Step 1: Create `electron.ts`**

```typescript
export interface ElectronAPI {
  pickDataFolder: () => Promise<string | null>;
  getDataRoot: () => Promise<string>;
  setDataRoot: (path: string) => Promise<void>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export function isElectron(): boolean {
  return typeof window !== "undefined" && window.electronAPI !== undefined;
}
```

- [ ] **Step 2: Create `SettingsDialog.tsx`**

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isElectron } from "@/lib/electron";

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [restarting, setRestarting] = useState(false);
  const { data: dataRoot, refetch } = useQuery({
    queryKey: ["electron-data-root"],
    queryFn: () => window.electronAPI!.getDataRoot(),
    enabled: open && isElectron(),
  });

  const changeFolder = async () => {
    const picked = await window.electronAPI!.pickDataFolder();
    if (!picked) return;
    setRestarting(true);
    try {
      await window.electronAPI!.setDataRoot(picked);
      await refetch();
      toast.success("Pasta de dados atualizada — reiniciando a API…");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRestarting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configurações</DialogTitle>
          <DialogDescription>
            Pasta onde os apps configurados, manifests, scripts do k6 e resultados de execuções ficam salvos.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-md border border-border bg-muted/40 p-3 font-mono text-xs break-all">
          {dataRoot ?? "carregando…"}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={restarting} onClick={changeFolder}>
            {restarting ? <Loader2 className="size-4 animate-spin" /> : <FolderOpen className="size-4" />}
            Trocar pasta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
cd interface/frontend
npx tsc --noEmit
```
Expected: no output. (Confirms `@/components/ui/dialog` exports `Dialog`/`DialogContent`/`DialogDescription`/`DialogFooter`/`DialogHeader`/`DialogTitle` — these are shadcn/ui primitives already bundled in this project's `src/components/ui/`; if the typecheck fails on that import, read `interface/frontend/src/components/ui/dialog.tsx` to confirm the exact exported names and adjust the import to match.)

- [ ] **Step 4: Commit**

```bash
git add interface/frontend/src/lib/electron.ts interface/frontend/src/components/SettingsDialog.tsx
git commit -m "Add window.electronAPI types and Settings dialog (Electron-only)"
```

---

### Task 9: Frontend — wire Settings into `__root.tsx`

**Files:**
- Modify: `interface/frontend/src/routes/__root.tsx`

**Interfaces:**
- Consumes: `isElectron` from `@/lib/electron`, `SettingsDialog` from Task 8.

- [ ] **Step 1: Add the Settings trigger to the header**

Read `interface/frontend/src/routes/__root.tsx`'s current header section first (it's been translated since the version shown in earlier tasks — confirm exact current JSX before editing) — add an import for `Settings` from `lucide-react`, `useState`, `isElectron`, and `SettingsDialog`, then render a small icon button next to `<EnvStatus />` inside the header's `<div className="ml-auto">` wrapper, only when `isElectron()` is true:

```tsx
{isElectron() && (
  <>
    <button
      type="button"
      onClick={() => setSettingsOpen(true)}
      className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label="Configurações"
    >
      <Settings className="size-4" />
    </button>
    <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
  </>
)}
```

with `const [settingsOpen, setSettingsOpen] = useState(false);` added inside the `RootComponent` function body, alongside its existing `const { queryClient } = Route.useRouteContext();` line.

- [ ] **Step 2: Typecheck**

```bash
cd interface/frontend
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 3: Live-verify the Settings icon is absent outside Electron (normal dev mode)**

```bash
npm run dev > /tmp-frontend-dev.log 2>&1 &
sleep 6
grep -oE ':[0-9]{4}' /tmp-frontend-dev.log | head -1
```
Note the port, then:
```bash
curl -s "http://localhost:<PORT>/" -H "Accept-Encoding: identity" | grep -a -o "Configurações"
```
Expected: no match (empty output) — `isElectron()` is false in a plain browser tab, so the button never renders, confirming it's correctly gated. Stop the dev server (`netstat`/`taskkill` on the noted port, matching this project's established pattern).

- [ ] **Step 4: Commit**

```bash
git add interface/frontend/src/routes/__root.tsx
git commit -m "Wire Settings dialog into the header, Electron-only"
```

---

### Task 10: Scaffold `interface/electron/` — project, settings, requirements check

**Files:**
- Create: `interface/electron/package.json`
- Create: `interface/electron/tsconfig.json`
- Create: `interface/electron/.gitignore`
- Create: `interface/electron/src/settings.ts`
- Create: `interface/electron/src/requirements.ts`

**Interfaces:**
- Produces: `readSettings(): Settings | null` / `writeSettings(s: Settings): void` (JSON file at a given path — the caller, Task 12's `main.ts`, supplies `app.getPath('userData')`), `type Settings = { dataRoot: string }`. `runRequirementsCheck(engineRoot: string): Promise<{ ready: boolean; output: string }>` (same shape/logic as `interface/API/src/routes/check.ts`'s `defaultRunCheck`, duplicated here deliberately — the API isn't running yet at the point this runs, so there's nothing to call into).

- [ ] **Step 1: Create `interface/electron/package.json`**

```json
{
  "name": "perftest-electron",
  "version": "0.1.0",
  "private": true,
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc",
    "start": "npm run build && electron ."
  },
  "devDependencies": {
    "@types/node": "^20.14.15",
    "electron": "^31.3.1",
    "electron-builder": "^24.13.3",
    "typescript": "^5.5.4"
  }
}
```

- [ ] **Step 2: Create `interface/electron/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

CommonJS (not ESM, unlike `interface/API`/`interface/frontend`) — Electron's preload script loading is most reliably compatible with CommonJS output regardless of Electron version/sandbox settings, and there's no reason to fight that for a small main-process project.

- [ ] **Step 3: Create `interface/electron/.gitignore`**

```gitignore
node_modules/
dist/
release/
```

- [ ] **Step 4: Install dependencies**

```bash
cd interface/electron
npm install
```

- [ ] **Step 5: Create `interface/electron/src/settings.ts`**

```typescript
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export interface Settings {
  dataRoot: string;
}

function settingsFilePath(userDataDir: string): string {
  return path.join(userDataDir, 'settings.json');
}

export function readSettings(userDataDir: string): Settings | null {
  const file = settingsFilePath(userDataDir);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Settings;
  } catch {
    return null;
  }
}

export function writeSettings(userDataDir: string, settings: Settings): void {
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(settingsFilePath(userDataDir), JSON.stringify(settings, null, 2), 'utf8');
}
```

- [ ] **Step 6: Create `interface/electron/src/requirements.ts`**

```typescript
import { spawn } from 'node:child_process';
import path from 'node:path';

export interface RequirementsResult {
  ready: boolean;
  output: string;
}

export function runRequirementsCheck(engineRoot: string): Promise<RequirementsResult> {
  return new Promise((resolve) => {
    const child = spawn('pwsh', ['-File', path.join(engineRoot, 'perftest.ps1'), '-Check'], { cwd: engineRoot });
    let output = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', (err) => {
      output += `\n${err.message}`;
      resolve({ ready: false, output });
    });
    child.on('exit', (code) => resolve({ ready: code === 0, output }));
  });
}
```

- [ ] **Step 7: Compile to verify no syntax/type errors**

```bash
cd interface/electron
npx tsc --noEmit
```
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add interface/electron/package.json interface/electron/tsconfig.json interface/electron/.gitignore interface/electron/src/settings.ts interface/electron/src/requirements.ts interface/electron/package-lock.json
git commit -m "Scaffold interface/electron: project setup, settings persistence, requirements check"
```

---

### Task 11: Electron bootstrap screens — first-run folder picker + requirements check

**Files:**
- Create: `interface/electron/renderer/bootstrap.html`
- Create: `interface/electron/renderer/bootstrap.js`
- Create: `interface/electron/src/preload.ts`

**Interfaces:**
- Consumes: `readSettings`/`writeSettings` from Task 10 (via IPC handlers Task 12's `main.ts` registers), `runRequirementsCheck` from Task 10.
- Produces: a `contextBridge`-exposed `window.electronAPI` in the bootstrap renderer with `pickDataFolder(): Promise<string | null>`, `saveDataRoot(path: string): Promise<void>`, `runRequirementsCheck(): Promise<{ready: boolean; output: string}>` — the IPC channel names (`'pick-data-folder'`, `'save-data-root'`, `'run-requirements-check'`) that Task 12's `main.ts` must register handlers for.

- [ ] **Step 1: Create `interface/electron/src/preload.ts`**

```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  pickDataFolder: () => ipcRenderer.invoke('pick-data-folder'),
  saveDataRoot: (path: string) => ipcRenderer.invoke('save-data-root', path),
  getDataRoot: () => ipcRenderer.invoke('get-data-root'),
  setDataRoot: (path: string) => ipcRenderer.invoke('set-data-root', path),
  runRequirementsCheck: () => ipcRenderer.invoke('run-requirements-check'),
});
```

Note this single preload script is shared by both the bootstrap window (Steps 2-3, uses `pickDataFolder`/`saveDataRoot`/`runRequirementsCheck`) and the main app window (Task 9's frontend, uses `getDataRoot`/`setDataRoot`/`pickDataFolder`) — one `contextBridge` surface covering every IPC channel this app needs, simpler than maintaining two separate preload scripts.

- [ ] **Step 2: Create `interface/electron/renderer/bootstrap.html`**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>k8s-perftest — configuração inicial</title>
  <style>
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: #0f1115;
      color: #e6e6e6;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
    }
    .card {
      max-width: 32rem;
      padding: 2rem;
      border: 1px solid #2a2d36;
      border-radius: 0.75rem;
      background: #171a21;
    }
    h1 { font-size: 1.1rem; margin: 0 0 0.5rem; }
    p { color: #9aa0ab; font-size: 0.85rem; line-height: 1.5; }
    button {
      margin-top: 1rem;
      padding: 0.5rem 1rem;
      border-radius: 0.4rem;
      border: 1px solid #3a3f4b;
      background: #232733;
      color: #e6e6e6;
      cursor: pointer;
      font-size: 0.85rem;
    }
    button:hover { background: #2c313f; }
    button:disabled { opacity: 0.5; cursor: default; }
    #path { font-family: monospace; font-size: 0.8rem; margin-top: 0.75rem; word-break: break-all; color: #7fd88f; }
    pre {
      background: #0b0d11;
      border: 1px solid #2a2d36;
      border-radius: 0.4rem;
      padding: 0.75rem;
      font-size: 0.75rem;
      max-height: 12rem;
      overflow: auto;
      white-space: pre-wrap;
    }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="card">
    <div id="step-folder">
      <h1>Onde salvar seus dados?</h1>
      <p>Escolha a pasta onde os apps configurados, manifests, scripts do k6 e resultados de execuções vão ficar salvos.</p>
      <button id="pick-btn">Escolher pasta</button>
      <div id="path"></div>
      <button id="continue-btn" class="hidden">Continuar</button>
    </div>
    <div id="step-check" class="hidden">
      <h1>Verificando pré-requisitos…</h1>
      <p>kind, kubectl, k6, Docker Desktop e o módulo powershell-yaml precisam estar instalados.</p>
      <pre id="check-output"></pre>
      <button id="retry-btn" class="hidden">Verificar novamente</button>
    </div>
  </div>
  <script src="bootstrap.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `interface/electron/renderer/bootstrap.js`**

```javascript
const folderStep = document.getElementById('step-folder');
const checkStep = document.getElementById('step-check');
const pickBtn = document.getElementById('pick-btn');
const continueBtn = document.getElementById('continue-btn');
const pathDiv = document.getElementById('path');
const checkOutput = document.getElementById('check-output');
const retryBtn = document.getElementById('retry-btn');

let chosenPath = null;

pickBtn.addEventListener('click', async () => {
  const picked = await window.electronAPI.pickDataFolder();
  if (!picked) return;
  chosenPath = picked;
  pathDiv.textContent = picked;
  continueBtn.classList.remove('hidden');
});

continueBtn.addEventListener('click', async () => {
  await window.electronAPI.saveDataRoot(chosenPath);
  folderStep.classList.add('hidden');
  checkStep.classList.remove('hidden');
  await runCheck();
});

async function runCheck() {
  retryBtn.classList.add('hidden');
  checkOutput.textContent = 'verificando…';
  const result = await window.electronAPI.runRequirementsCheck();
  checkOutput.textContent = result.output;
  if (!result.ready) {
    retryBtn.classList.remove('hidden');
  }
  // When ready, main.ts's 'run-requirements-check' handler itself
  // triggers the transition to the real app window - this renderer
  // doesn't need to do anything further on success.
}

retryBtn.addEventListener('click', runCheck);
```

- [ ] **Step 4: Compile to verify no syntax/type errors**

```bash
cd interface/electron
npx tsc --noEmit
```
Expected: no output (this only typechecks `preload.ts`; `bootstrap.js`/`bootstrap.html` are plain renderer files with no build step, loaded directly by `loadFile()` in Task 12).

- [ ] **Step 5: Commit**

```bash
git add interface/electron/src/preload.ts interface/electron/renderer/bootstrap.html interface/electron/renderer/bootstrap.js
git commit -m "Add Electron bootstrap screens: first-run folder picker + requirements check"
```

---

### Task 12: Electron `main.ts` — spawn the API, load the app, handle Settings restarts

**Files:**
- Create: `interface/electron/src/main.ts`

**Interfaces:**
- Consumes: `readSettings`/`writeSettings`/`Settings` from Task 10, `runRequirementsCheck` from Task 10, the IPC channel names Task 11's preload script invokes.
- Produces: the packaged app's actual entry point (`dist/main.js`, per Task 10's `package.json` `"main"` field).

- [ ] **Step 1: Create `interface/electron/src/main.ts`**

```typescript
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import { readSettings, writeSettings, Settings } from './settings.js';
import { runRequirementsCheck } from './requirements.js';

const PORT = 8026;
// In development this file runs from interface/electron/dist/main.js, so
// the repo root is four directories up. In a packaged build, electron-builder
// places bundled engine/API/frontend files under process.resourcesPath
// (see Task 13's extraResources config) instead - both cases are handled
// here so `npm start` in this folder works against the real repo during
// development without needing a full package first.
const isPackaged = app.isPackaged;
const engineRoot = isPackaged
  ? path.join(process.resourcesPath, 'engine')
  : path.resolve(__dirname, '..', '..', '..');
const apiEntry = isPackaged
  ? path.join(process.resourcesPath, 'api', 'server.js')
  : path.resolve(__dirname, '..', '..', 'API', 'dist', 'server.js');

let mainWindow: BrowserWindow | null = null;
let apiProcess: ChildProcess | null = null;

function userDataDir(): string {
  return app.getPath('userData');
}

function startApiProcess(dataRoot: string): void {
  if (apiProcess) {
    apiProcess.kill();
    apiProcess = null;
  }
  apiProcess = spawn(process.execPath, [apiEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(PORT),
      ENGINE_ROOT: engineRoot,
      DATA_ROOT: dataRoot,
    },
  });
  apiProcess.stdout?.on('data', (chunk) => console.log(`[api] ${chunk}`));
  apiProcess.stderr?.on('data', (chunk) => console.error(`[api] ${chunk}`));
}

function waitForApiHealth(retries = 30): Promise<void> {
  return new Promise((resolve, reject) => {
    const attempt = (remaining: number) => {
      fetch(`http://localhost:${PORT}/health`)
        .then(() => resolve())
        .catch(() => {
          if (remaining <= 0) {
            reject(new Error('A API não respondeu a tempo'));
            return;
          }
          setTimeout(() => attempt(remaining - 1), 500);
        });
    };
    attempt(retries);
  });
}

function loadBootstrap(): void {
  mainWindow!.loadFile(path.join(__dirname, '..', 'renderer', 'bootstrap.html'));
}

async function loadMainApp(): Promise<void> {
  try {
    await waitForApiHealth();
    mainWindow!.loadURL(`http://localhost:${PORT}`);
  } catch (err) {
    mainWindow!.loadURL(
      `data:text/html,<pre style="color:red;font-family:monospace;padding:2rem">${encodeURIComponent(
        String(err)
      )}</pre>`
    );
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('pick-data-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('save-data-root', async (_event, dataRoot: string) => {
    const settings: Settings = { dataRoot };
    writeSettings(userDataDir(), settings);
  });

  ipcMain.handle('get-data-root', async () => {
    return readSettings(userDataDir())?.dataRoot ?? '';
  });

  ipcMain.handle('set-data-root', async (_event, dataRoot: string) => {
    writeSettings(userDataDir(), { dataRoot });
    startApiProcess(dataRoot);
    await waitForApiHealth();
  });

  ipcMain.handle('run-requirements-check', async () => {
    const result = await runRequirementsCheck(engineRoot);
    if (result.ready) {
      const settings = readSettings(userDataDir());
      if (settings) {
        startApiProcess(settings.dataRoot);
        await loadMainApp();
      }
    }
    return result;
  });
}

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  registerIpcHandlers();

  const settings = readSettings(userDataDir());
  if (settings) {
    startApiProcess(settings.dataRoot);
    void loadMainApp();
  } else {
    loadBootstrap();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      app.whenReady();
    }
  });
});

app.on('window-all-closed', () => {
  if (apiProcess) apiProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (apiProcess) apiProcess.kill();
});
```

- [ ] **Step 2: Compile**

```bash
cd interface/electron
npx tsc --noEmit
```
Expected: no output. (If `fetch` is reported as not defined: Electron's main process runs on a Node version with global `fetch` available from Node 18+ — confirm `interface/electron/package.json`'s `@types/node` version supports it, or add `"lib": ["ES2022"]` to `tsconfig.json`'s `compilerOptions` if the type is missing.)

- [ ] **Step 3: Build the API and this project, then manually run against the real repo (development mode, not packaged)**

```bash
cd interface/API
npm run build
cd ../electron
npm run build
```

Before running, create a throwaway settings file so this manual check exercises the "already configured" path rather than the first-run bootstrap screen (the bootstrap screen's own IPC-driven flow is exercised end-to-end once Task 13's real package exists to test against; this step is checking that `main.ts` itself boots and serves correctly):

```bash
node -e "
const fs = require('fs');
const os = require('os');
const path = require('path');
const dir = path.join(os.homedir(), 'AppData', 'Roaming', 'perftest-electron');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ dataRoot: process.cwd().replace(/electron$/, '..\\\\..') }));
console.log(dir);
"
```

(Adjust `dataRoot` to the actual repo root path if the relative substitution above doesn't resolve correctly on this machine — the goal is a `settings.json` with `dataRoot` pointing at the real repo root, which already has `configs/example.yaml` from earlier manual testing.)

```bash
npx electron .
```
Expected: a window opens, briefly shows nothing/loading, then loads the real frontend UI (note: at this point Task 7's `frontend-dist` doesn't exist yet under `engineRoot` unless you've also run `npm run build:electron` in `interface/frontend` and copied its output there — if that folder is absent, `server.ts`'s static-serving registration is skipped and the API has no frontend to serve, so this specific manual check will show a 404/blank page from the API instead of the real UI; that's expected at this point in the plan and not a bug — full end-to-end verification with the real static frontend happens in Task 14). What this step actually proves: the Electron window opens, `main.ts` successfully spawns the compiled API as a child process, and `/health` responds — check this via a separate terminal:

```bash
curl -s http://localhost:8026/health
```
Expected: `{"ok":true}` while the Electron window is open. Close the Electron window when done (this also kills the spawned API child process, per the `window-all-closed`/`before-quit` handlers).

- [ ] **Step 4: Commit**

```bash
git add interface/electron/src/main.ts
git commit -m "Add Electron main process: spawn API child process, bootstrap flow, Settings restart"
```

---

### Task 13: Packaging config — electron-builder, extraResources, Makefile target

**Files:**
- Modify: `interface/electron/package.json` (add `build` config block)
- Create: `interface/electron/electron-builder.yml`
- Modify: `Makefile`

**Interfaces:**
- Consumes: `interface/API/dist/` (Task 6), `interface/frontend/dist/` (Task 7), the engine files at the repo root, `interface/electron/dist/` (Tasks 10-12).
- Produces: `make electron-installer` — builds everything and produces a single `.exe` installer under `interface/electron/release/`.

- [ ] **Step 1: Create `interface/electron/electron-builder.yml`**

```yaml
appId: com.k8s-perftest.desktop
productName: k8s-perftest
directories:
  output: release
files:
  - dist/**/*
  - renderer/**/*
  - package.json
extraResources:
  - from: ../../perftest.ps1
    to: engine/perftest.ps1
  - from: ../../modules
    to: engine/modules
  - from: ../../manifests
    to: engine/manifests
  - from: ../../templates
    to: engine/templates
  - from: ../API/dist
    to: api
  - from: ../API/node_modules
    to: api/node_modules
  - from: ../API/package.json
    to: api/package.json
  - from: ../frontend/dist
    to: engine/frontend-dist
win:
  target: nsis
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
```

Notes on the two path assumptions this config makes, both matching Task 12's `main.ts` in packaged mode:
- `engineRoot` = `process.resourcesPath/engine` → this config places `perftest.ps1`, `modules/`, `manifests/`, `templates/`, and (critically) `frontend-dist/` all directly under `resources/engine/`, matching `server.ts`'s expectation (Task 5) that `frontend-dist` sits next to the engine files it resolves `engineRoot`-relative paths against.
- `apiEntry` = `process.resourcesPath/api/server.js` → this config places the API's compiled `dist/` contents (flattened, since `from: ../API/dist` copies dist's *contents* to `to: api`) plus its `node_modules` (the API's runtime dependencies — Fastify, `@fastify/cors`, `@fastify/static`, `yaml` — needed since the packaged app runs the compiled JS directly with plain `node`, not through `npm`) directly under `resources/api/`.

- [ ] **Step 2: Add the `build` config block to `interface/electron/package.json`**

Add a `"build"` key pointing at the YAML config (electron-builder supports either inline JSON or a separate file; this plan uses the separate file from Step 1 — add just enough in `package.json` for electron-builder to find it, plus the packaging script):

```json
{
  "name": "perftest-electron",
  "version": "0.1.0",
  "private": true,
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc",
    "start": "npm run build && electron .",
    "package": "npm run build && electron-builder --config electron-builder.yml"
  },
  "devDependencies": {
    "@types/node": "^20.14.15",
    "electron": "^31.3.1",
    "electron-builder": "^24.13.3",
    "typescript": "^5.5.4"
  }
}
```

- [ ] **Step 3: Add the root `Makefile` target**

```makefile
# Builds a single-file Windows installer: compiles the API, builds the
# frontend as a static SPA (not the SSR dev build), then packages both
# plus the PowerShell engine into one electron-builder NSIS .exe.
electron-installer:
	@printf "$(CYAN)Compilando a API...$(RESET)\n"
	cd interface/API && npm run build
	@printf "$(CYAN)Compilando o frontend (build estatico)...$(RESET)\n"
	cd interface/frontend && npm run build:electron
	@printf "$(CYAN)Empacotando o instalador Electron...$(RESET)\n"
	cd interface/electron && npm run package
	@printf "$(GREEN)Instalador pronto em interface/electron/release/$(RESET)\n"
```

Add `electron-installer` to the `.PHONY` line at the top of the `Makefile` (alongside the existing targets) and one `help` line matching the existing style:

```
	@printf "\tmake $(CYAN)electron-installer$(RESET) ......... gera o instalador .exe do desktop app (Electron)\n"
```

- [ ] **Step 4: Run the full packaging build**

```bash
make electron-installer
```
Expected: completes without error (this takes a few minutes — electron-builder downloads Electron binaries on first run if not already cached). Final output line confirms the installer path.

```bash
ls interface/electron/release/*.exe
```
Expected: exactly one `.exe` file — confirms "single shareable file" (NSIS's default target produces one installer executable, not an MSI-with-cabs bundle or an unpacked directory).

- [ ] **Step 5: Verify the unpacked resource layout matches what `main.ts` expects, before the full installer walkthrough**

electron-builder's `extraResources` `from`/`to` copy semantics are worth confirming directly rather than assuming — a wrong mapping here fails silently until the packaged app tries to spawn a path that doesn't exist. electron-builder always writes an unpacked directory alongside the installer (`release/win-unpacked/`) even when building the NSIS target:

```bash
ls interface/electron/release/win-unpacked/resources/engine/perftest.ps1
ls interface/electron/release/win-unpacked/resources/engine/frontend-dist/index.html
ls interface/electron/release/win-unpacked/resources/api/server.js
ls interface/electron/release/win-unpacked/resources/api/node_modules/fastify
```
Expected: all four paths exist. If any is missing (e.g. files landed one level deeper, under a nested `dist`/`API` subfolder instead of flattened), fix the corresponding `from`/`to` pair in `electron-builder.yml` and re-run `npm run package` before proceeding — don't move on to a full NSIS install/uninstall cycle to debug a path mapping, `win-unpacked/` is much faster to iterate against.

- [ ] **Step 6: Commit**

```bash
git add interface/electron/package.json interface/electron/electron-builder.yml Makefile
git commit -m "Add electron-builder packaging config and make electron-installer target"
```

---

### Task 14: Final verification — install and walk through the real installer

**Files:** none created/modified — this task only verifies Tasks 1-13's combined behavior via the real built installer.

**Interfaces:**
- Consumes: everything from Tasks 1-13.

- [ ] **Step 1: Confirm nothing regressed in the source checkout**

```bash
cd interface/API
npm test
npx tsc --noEmit
cd ../frontend
npx tsc --noEmit
```
Expected: all API tests pass, both typechecks clean.

- [ ] **Step 2: Confirm the existing dev flow is unaffected**

```bash
make interface
```
Expected: both servers start exactly as before (API on 8026, frontend on Vite's chosen port); open the frontend URL in a browser, confirm the Dashboard loads normally, no Settings icon appears (not running under Electron). Stop with Ctrl+C.

- [ ] **Step 3: Install the real built installer**

Run the `.exe` from `interface/electron/release/` built in Task 13. Expected: standard NSIS installer wizard (choose install location, since `allowToChangeInstallationDirectory: true`), completes, creates a Start Menu / Desktop shortcut per NSIS defaults.

- [ ] **Step 4: First launch — folder picker and requirements check**

Launch the installed app (not `npx electron .` — the real installed shortcut, to exercise `app.isPackaged` being `true` and the `extraResources` paths for real). Expected: the bootstrap screen appears (Task 11's `bootstrap.html`), asks for a data folder — pick or create a new empty folder (e.g. a fresh temp directory, to prove this doesn't depend on the git checkout's `configs/`/`output/` at all). After confirming, the requirements check runs and shows pass/fail per prerequisite, matching what `perftest.ps1 -Check` already reports on this machine (which Task 1's earlier manual check confirmed is all green).

- [ ] **Step 5: Main app loads and works end-to-end**

Once requirements pass, expected: the window transitions to the real frontend (Task 7's static build, served by the spawned API). Confirm:
1. Dashboard loads (empty — the freshly chosen data folder has no apps yet).
2. Settings icon is present in the header (running under Electron now) — open it, confirm it shows the chosen data folder path.
3. Create a new app via **Novo app** → **Usar o exemplo httpbin**, walk through the wizard, save.
4. Confirm `configs/httpbin-example.yaml` (or whatever name the example uses) now exists in the folder chosen in Step 4 — proves the packaged app is actually writing to the user-chosen `dataRoot`, not the git checkout.
5. From Settings, click **Trocar pasta**, pick a second empty folder, confirm the toast shows and the Dashboard goes back to empty (now pointed at the new, different folder) — proves the API restart-on-settings-change flow works.

- [ ] **Step 6: Clean up**

Uninstall the app via Windows' standard "Apps" settings (NSIS installers register an uninstaller automatically). Delete the temporary data folders created during Steps 4-5.

- [ ] **Step 7: No commit needed** — this task is validation only, nothing to add to git beyond what Tasks 1-13 already committed.

---

## Post-plan state

`k8s-perftest` can be packaged into a single-file Windows installer (`make electron-installer`) that installs a real desktop app: on first launch it asks where to keep its data, verifies kind/kubectl/k6/docker/pwsh are present, then runs the existing API + frontend exactly as they work today, pointed at the user's chosen folder instead of a git checkout. The API always listens on a fixed port (8026) the user never has to think about. `make interface`/`npm run dev`/`npm test` in the source checkout are all unaffected — every change in this plan is additive, gated behind new optional parameters/environment variables that default to today's exact behavior.

**Known limitation, out of scope for this round:** the installer isn't code-signed, so Windows SmartScreen will show an "unrecognized publisher" warning on first run (a "More info → Run anyway" click gets past it). Fixing that needs a code-signing certificate, a separate acquisition process this plan doesn't cover.
