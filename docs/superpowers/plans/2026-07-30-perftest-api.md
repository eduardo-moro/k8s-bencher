# Perftest API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `interface/API/`, a Node.js + TypeScript (Fastify) server that lets a client configure apps (config/manifest/script CRUD), trigger a full perftest run, and read past run results — entirely by editing the files `perftest.ps1` already reads and reading the files it already writes, never by touching the PowerShell engine itself.

**Architecture:** Three library modules (`configFiles.ts`, `jobRunner.ts`, `resultsCsv.ts`) each own one filesystem/process responsibility; four route modules (`apps.ts`, `runs.ts`, `outputs.ts`, `check.ts`) wire them to HTTP. `jobRunner.ts` spawns `pwsh -File perftest.ps1 -Full -Config <path>` as a child process and tracks it in a single in-memory job slot — no database, no in-process PowerShell module import.

**Tech Stack:** Node.js 20+, TypeScript (strict), Fastify, the `yaml` npm package, Vitest.

## Global Constraints

- Never `Import-Module Perftest.psm1` and never edit `perftest.ps1` or `modules/Perftest.psm1`. Runs are triggered only by spawning `perftest.ps1` as a child process.
- Only one run at a time — enforced by a single in-memory job slot in `JobRunner`, not a queue. `POST /apps/:name/runs` returns `409` if a job is already `starting`/`running`.
- `config.yaml` round-trips as structured JSON; `manifest.yaml`/`script.js` are always raw text in and out.
- Output-folder discovery must key off the config file's **internal** `name:` field, not the URL app-name (the config's filename stem) — they can differ (e.g. `configs/example.yaml` has `name: httpbin-example` inside it). For apps created through this API, the two are kept equal by construction, but existing configs may not follow that.
- `results.csv`'s numeric columns (`p95_ms`, `p99_ms`, `error_rate`, `http_reqs_total`) can be **empty strings**, not just numbers — `Invoke-PerftestMatrix` records an empty value for a resource combo whose rollout never became ready, rather than aborting the run. The parser must turn those into `null`, never `NaN` or a thrown error.
- No authentication — local, single-user tool.
- File writes (`configs/*.yaml`, `manifests/*.yaml`, `loadtest/*.js`) are atomic: write to a temp file in the same directory, then rename over the real path.
- All cross-file relative imports use the `.js` extension even though the source is `.ts` (standard TS+ESM convention `tsx` and Node's ESM loader both expect).

---

### Task 1: Project scaffolding + health check

**Files:**
- Create: `interface/API/package.json`
- Create: `interface/API/tsconfig.json`
- Create: `interface/API/.gitignore`
- Create: `interface/API/src/server.ts`
- Test: `interface/API/src/server.test.ts`
- Delete: `interface/API/.gitkeep` (no longer needed once real tracked files exist in the directory)

**Interfaces:**
- Produces: `buildServer(options?: { repoRoot?: string }): FastifyInstance` — every later task's route-registration function is wired into this function. `repoRoot` defaults to the actual repo root (three directories up from `src/`) but tests override it to point at a temp fixture directory.

- [ ] **Step 1: Create `interface/API/package.json`**

```json
{
  "name": "perftest-api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "tsx src/server.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "fastify": "^4.28.1",
    "yaml": "^2.5.1"
  },
  "devDependencies": {
    "@types/node": "^20.14.15",
    "tsx": "^4.16.5",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `interface/API/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `interface/API/.gitignore`**

```gitignore
node_modules/
dist/
```

- [ ] **Step 4: Install dependencies**

```bash
cd interface/API
npm install
```

Expected: `node_modules/` and `package-lock.json` are created, no errors.

- [ ] **Step 5: Write the failing test**

Create `interface/API/src/server.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildServer } from './server.js';

describe('GET /health', () => {
  it('returns ok', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
cd interface/API
npm test
```

Expected: FAIL — `Cannot find module './server.js'` (or similar; `server.ts` doesn't exist yet).

- [ ] **Step 7: Create `interface/API/src/server.ts`**

```typescript
import Fastify, { FastifyInstance } from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

export function buildServer(options?: { repoRoot?: string }): FastifyInstance {
  const repoRoot = options?.repoRoot ?? DEFAULT_REPO_ROOT;

  const app = Fastify({ logger: true });
  app.get('/health', async () => ({ ok: true }));

  // Later tasks register more routes here, using `repoRoot`.
  void repoRoot;

  return app;
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  const app = buildServer();
  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  app.listen({ port, host: '0.0.0.0' }).then(() => {
    app.log.info(`perftest-api listening on port ${port}`);
  });
}
```

- [ ] **Step 8: Run test to verify it passes**

```bash
cd interface/API
npm test
```

Expected: PASS, 1 test.

- [ ] **Step 9: Manually verify the real server starts and responds**

```bash
cd interface/API
npm start &
sleep 2
curl -s http://localhost:3001/health
kill %1
```

Expected: `{"ok":true}` printed.

- [ ] **Step 10: Remove the now-redundant placeholder and commit**

```bash
git rm interface/API/.gitkeep
git add interface/API/package.json interface/API/package-lock.json interface/API/tsconfig.json interface/API/.gitignore interface/API/src/server.ts interface/API/src/server.test.ts
git commit -m "Scaffold perftest-api: Fastify + TypeScript + Vitest, health check"
```

---

### Task 2: `resultsCsv.ts` — parse `results.csv` into typed rows

**Files:**
- Create: `interface/API/src/lib/resultsCsv.ts`
- Test: `interface/API/src/lib/resultsCsv.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ResultRow` type and `parseResultsCsv(csvText: string): ResultRow[]`, used by Task 7 (`routes/outputs.ts`).

- [ ] **Step 1: Write the failing tests**

Create `interface/API/src/lib/resultsCsv.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseResultsCsv } from './resultsCsv.js';

const HEADER =
  'memory,cpu,start_time,end_time,duration_seconds,p95_ms,p99_ms,error_rate,http_reqs_total,oom_killed,restart_count';

describe('parseResultsCsv', () => {
  it('parses a normal row with all fields populated', () => {
    const csv = `${HEADER}\n256Mi,250m,2026-07-30T09:00:00.000Z,2026-07-30T09:01:00.000Z,60,1.5,2.1,0,570,no,0\n`;
    const rows = parseResultsCsv(csv);
    expect(rows).toEqual([
      {
        memory: '256Mi',
        cpu: '250m',
        start_time: '2026-07-30T09:00:00.000Z',
        end_time: '2026-07-30T09:01:00.000Z',
        duration_seconds: 60,
        p95_ms: 1.5,
        p99_ms: 2.1,
        error_rate: 0,
        http_reqs_total: 570,
        oom_killed: false,
        restart_count: 0,
      },
    ]);
  });

  it('parses oom_killed=yes as true', () => {
    const csv = `${HEADER}\n128Mi,100m,2026-07-30T09:00:00.000Z,2026-07-30T09:01:00.000Z,60,1.5,2.1,0,570,yes,1\n`;
    const rows = parseResultsCsv(csv);
    expect(rows[0].oom_killed).toBe(true);
    expect(rows[0].restart_count).toBe(1);
  });

  it('parses empty numeric fields (rollout never became ready) as null, not NaN', () => {
    const csv = `${HEADER}\n64Mi,50m,2026-07-30T09:00:00.000Z,2026-07-30T09:01:05.000Z,65,,,,,no,0\n`;
    const rows = parseResultsCsv(csv);
    expect(rows[0].p95_ms).toBeNull();
    expect(rows[0].p99_ms).toBeNull();
    expect(rows[0].error_rate).toBeNull();
    expect(rows[0].http_reqs_total).toBeNull();
  });

  it('returns an empty array for a header-only CSV', () => {
    const rows = parseResultsCsv(`${HEADER}\n`);
    expect(rows).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd interface/API
npm test
```

Expected: FAIL — `Cannot find module './resultsCsv.js'`.

- [ ] **Step 3: Create `interface/API/src/lib/resultsCsv.ts`**

```typescript
export interface ResultRow {
  memory: string;
  cpu: string;
  start_time: string;
  end_time: string;
  duration_seconds: number;
  p95_ms: number | null;
  p99_ms: number | null;
  error_rate: number | null;
  http_reqs_total: number | null;
  oom_killed: boolean;
  restart_count: number;
}

function parseNumberOrNull(value: string): number | null {
  if (value === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

export function parseResultsCsv(csvText: string): ResultRow[] {
  const lines = csvText.trim().split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length <= 1) return [];

  const header = lines[0].split(',');
  const dataLines = lines.slice(1);

  return dataLines.map((line) => {
    const cells = line.split(',');
    const row: Record<string, string> = {};
    header.forEach((col, i) => {
      row[col] = cells[i] ?? '';
    });

    return {
      memory: row.memory,
      cpu: row.cpu,
      start_time: row.start_time,
      end_time: row.end_time,
      duration_seconds: Number(row.duration_seconds),
      p95_ms: parseNumberOrNull(row.p95_ms),
      p99_ms: parseNumberOrNull(row.p99_ms),
      error_rate: parseNumberOrNull(row.error_rate),
      http_reqs_total: parseNumberOrNull(row.http_reqs_total),
      oom_killed: row.oom_killed === 'yes',
      restart_count: Number(row.restart_count),
    };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd interface/API
npm test
```

Expected: PASS, 5 tests total (1 from Task 1 + 4 here).

- [ ] **Step 5: Commit**

```bash
git add interface/API/src/lib/resultsCsv.ts interface/API/src/lib/resultsCsv.test.ts
git commit -m "Add resultsCsv parser with null-safe numeric fields"
```

---

### Task 3: `errors.ts` + `configFiles.ts` — config/manifest/script CRUD

**Files:**
- Create: `interface/API/src/lib/errors.ts`
- Create: `interface/API/src/lib/configFiles.ts`
- Test: `interface/API/src/lib/configFiles.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `errors.ts`: `NotFoundError`, `ConflictError`, `ValidationError` (all `extends Error`), `statusForError(err: unknown): number`.
  - `configFiles.ts`: types `StageConfig { duration: string; target: number }`, `ResourcesConfig { memory: string[]; cpu: string[] }`, `LoadConfig { vus: number; stages: StageConfig[] }`, `AppConfig { name: string; container: string; resources: ResourcesConfig; load: LoadConfig }`, `AppDetail extends AppConfig { manifestContent: string; scriptContent: string }`, `AppSummary { name: string; container: string; resources: ResourcesConfig }`. Class `ConfigFiles` with constructor `(repoRoot: string)` and methods `listApps(): Promise<AppSummary[]>`, `getApp(name: string): Promise<AppDetail>`, `createApp(detail: AppDetail): Promise<void>`, `updateApp(name: string, partial: Partial<AppDetail>): Promise<AppDetail>`, `deleteApp(name: string): Promise<void>`, `getTemplateExample(): Promise<AppDetail>`. Used by Tasks 4, 5, 7.

- [ ] **Step 1: Create `interface/API/src/lib/errors.ts`**

```typescript
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function statusForError(err: unknown): number {
  if (err instanceof NotFoundError) return 404;
  if (err instanceof ConflictError) return 409;
  if (err instanceof ValidationError) return 400;
  return 500;
}
```

- [ ] **Step 2: Write the failing tests**

Create `interface/API/src/lib/configFiles.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConfigFiles, AppDetail } from './configFiles.js';
import { NotFoundError, ConflictError } from './errors.js';

let repoRoot: string;
let configFiles: ConfigFiles;

const sampleDetail: AppDetail = {
  name: 'myapp',
  container: 'myapp',
  resources: { memory: ['128Mi', '256Mi'], cpu: ['100m', '250m'] },
  load: { vus: 10, stages: [{ duration: '10s', target: 10 }] },
  manifestContent: 'kind: Deployment\nmetadata:\n  name: myapp\n',
  scriptContent: "import http from 'k6/http';\nexport default function () { http.get('http://myapp'); }\n",
};

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'perftest-api-test-'));
  await fs.mkdir(path.join(repoRoot, 'configs'), { recursive: true });
  await fs.mkdir(path.join(repoRoot, 'manifests'), { recursive: true });
  await fs.mkdir(path.join(repoRoot, 'loadtest'), { recursive: true });
  await fs.mkdir(path.join(repoRoot, 'templates'), { recursive: true });
  configFiles = new ConfigFiles(repoRoot);
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

describe('ConfigFiles', () => {
  it('listApps returns [] when configs/ is empty', async () => {
    expect(await configFiles.listApps()).toEqual([]);
  });

  it('createApp writes config/manifest/script with matching names, listApps and getApp reflect it', async () => {
    await configFiles.createApp(sampleDetail);

    const summaries = await configFiles.listApps();
    expect(summaries).toEqual([
      { name: 'myapp', container: 'myapp', resources: sampleDetail.resources },
    ]);

    const detail = await configFiles.getApp('myapp');
    expect(detail).toEqual(sampleDetail);

    const manifestOnDisk = await fs.readFile(path.join(repoRoot, 'manifests/myapp.yaml'), 'utf8');
    expect(manifestOnDisk).toBe(sampleDetail.manifestContent);
    const scriptOnDisk = await fs.readFile(path.join(repoRoot, 'loadtest/myapp.js'), 'utf8');
    expect(scriptOnDisk).toBe(sampleDetail.scriptContent);
  });

  it('createApp throws ConflictError if the app already exists', async () => {
    await configFiles.createApp(sampleDetail);
    await expect(configFiles.createApp(sampleDetail)).rejects.toThrow(ConflictError);
  });

  it('getApp throws NotFoundError for a missing app', async () => {
    await expect(configFiles.getApp('nope')).rejects.toThrow(NotFoundError);
  });

  it('updateApp updates only the fields provided, leaves the rest untouched', async () => {
    await configFiles.createApp(sampleDetail);

    const updated = await configFiles.updateApp('myapp', {
      resources: { memory: ['512Mi'], cpu: ['500m'] },
    });

    expect(updated.resources).toEqual({ memory: ['512Mi'], cpu: ['500m'] });
    expect(updated.container).toBe('myapp');
    expect(updated.manifestContent).toBe(sampleDetail.manifestContent);
  });

  it('updateApp writes new manifestContent/scriptContent when provided', async () => {
    await configFiles.createApp(sampleDetail);

    const updated = await configFiles.updateApp('myapp', {
      manifestContent: 'kind: Deployment\nmetadata:\n  name: myapp-v2\n',
    });

    expect(updated.manifestContent).toBe('kind: Deployment\nmetadata:\n  name: myapp-v2\n');
    expect(updated.scriptContent).toBe(sampleDetail.scriptContent);
  });

  it('deleteApp removes all three files', async () => {
    await configFiles.createApp(sampleDetail);
    await configFiles.deleteApp('myapp');

    await expect(configFiles.getApp('myapp')).rejects.toThrow(NotFoundError);
    await expect(fs.access(path.join(repoRoot, 'manifests/myapp.yaml'))).rejects.toThrow();
    await expect(fs.access(path.join(repoRoot, 'loadtest/myapp.js'))).rejects.toThrow();
  });

  it('deleteApp throws NotFoundError for a missing app', async () => {
    await expect(configFiles.deleteApp('nope')).rejects.toThrow(NotFoundError);
  });

  it('getTemplateExample reads from templates/', async () => {
    await fs.writeFile(
      path.join(repoRoot, 'templates/config.example.yaml'),
      'name: httpbin-example\nmanifest: manifests/httpbin.yaml\ncontainer: httpbin\nscript: loadtest/httpbin.js\nresources:\n  memory: [128Mi]\n  cpu: [100m]\nload:\n  vus: 15\n  stages:\n    - {duration: 10s, target: 15}\n'
    );
    await fs.writeFile(path.join(repoRoot, 'templates/manifest.example.yaml'), 'kind: Deployment\n');
    await fs.writeFile(path.join(repoRoot, 'templates/loadtest.example.js'), "export default function(){}\n");

    const template = await configFiles.getTemplateExample();
    expect(template.name).toBe('httpbin-example');
    expect(template.container).toBe('httpbin');
    expect(template.manifestContent).toBe('kind: Deployment\n');
    expect(template.scriptContent).toBe('export default function(){}\n');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd interface/API
npm test
```

Expected: FAIL — `Cannot find module './configFiles.js'`.

- [ ] **Step 4: Create `interface/API/src/lib/configFiles.ts`**

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
  constructor(private repoRoot: string) {}

  private configPath(name: string): string {
    return path.join(this.repoRoot, 'configs', `${name}.yaml`);
  }

  async listApps(): Promise<AppSummary[]> {
    const configsDir = path.join(this.repoRoot, 'configs');
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
    const manifestContent = await fs.readFile(path.join(this.repoRoot, parsed.manifest), 'utf8');
    const scriptContent = await fs.readFile(path.join(this.repoRoot, parsed.script), 'utf8');

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

    await fs.mkdir(path.join(this.repoRoot, 'manifests'), { recursive: true });
    await fs.mkdir(path.join(this.repoRoot, 'loadtest'), { recursive: true });
    await fs.mkdir(path.join(this.repoRoot, 'configs'), { recursive: true });

    await atomicWrite(path.join(this.repoRoot, manifestRelPath), detail.manifestContent);
    await atomicWrite(path.join(this.repoRoot, scriptRelPath), detail.scriptContent);
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
      await atomicWrite(path.join(this.repoRoot, parsed.manifest), partial.manifestContent);
    }
    if (partial.scriptContent !== undefined) {
      await atomicWrite(path.join(this.repoRoot, parsed.script), partial.scriptContent);
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

    await fs.rm(path.join(this.repoRoot, parsed.manifest), { force: true });
    await fs.rm(path.join(this.repoRoot, parsed.script), { force: true });
    await fs.rm(configFile, { force: true });
  }

  async getTemplateExample(): Promise<AppDetail> {
    const templatesDir = path.join(this.repoRoot, 'templates');
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

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd interface/API
npm test
```

Expected: PASS, 14 tests total (5 from Tasks 1-2 + 9 here).

- [ ] **Step 6: Commit**

```bash
git add interface/API/src/lib/errors.ts interface/API/src/lib/configFiles.ts interface/API/src/lib/configFiles.test.ts
git commit -m "Add ConfigFiles: CRUD over configs/manifests/loadtest with atomic writes"
```

---

### Task 4: `routes/apps.ts` — wire config CRUD to HTTP

**Files:**
- Create: `interface/API/src/routes/apps.ts`
- Test: `interface/API/src/routes/apps.test.ts`
- Modify: `interface/API/src/server.ts`

**Interfaces:**
- Consumes: `ConfigFiles` and its types from Task 3, `statusForError` from Task 3.
- Produces: `registerAppRoutes(app: FastifyInstance, configFiles: ConfigFiles): void`, registered inside `buildServer`.

- [ ] **Step 1: Write the failing tests**

Create `interface/API/src/routes/apps.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServer } from '../server.js';

let repoRoot: string;

const sampleBody = {
  name: 'myapp',
  container: 'myapp',
  resources: { memory: ['128Mi'], cpu: ['100m'] },
  load: { vus: 10, stages: [{ duration: '10s', target: 10 }] },
  manifestContent: 'kind: Deployment\n',
  scriptContent: 'export default function(){}\n',
};

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'perftest-api-test-'));
  for (const dir of ['configs', 'manifests', 'loadtest', 'templates']) {
    await fs.mkdir(path.join(repoRoot, dir), { recursive: true });
  }
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

describe('apps routes', () => {
  it('GET /apps returns [] with no apps yet', async () => {
    const app = buildServer({ repoRoot });
    const res = await app.inject({ method: 'GET', url: '/apps' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('POST /apps creates an app, GET /apps/:name returns it', async () => {
    const app = buildServer({ repoRoot });

    const createRes = await app.inject({ method: 'POST', url: '/apps', payload: sampleBody });
    expect(createRes.statusCode).toBe(201);

    const getRes = await app.inject({ method: 'GET', url: '/apps/myapp' });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toEqual(sampleBody);
  });

  it('POST /apps with a missing required field returns 400', async () => {
    const app = buildServer({ repoRoot });
    const { container, ...withoutContainer } = sampleBody;
    void container;
    const res = await app.inject({ method: 'POST', url: '/apps', payload: withoutContainer });
    expect(res.statusCode).toBe(400);
  });

  it('POST /apps twice with the same name returns 409', async () => {
    const app = buildServer({ repoRoot });
    await app.inject({ method: 'POST', url: '/apps', payload: sampleBody });
    const res = await app.inject({ method: 'POST', url: '/apps', payload: sampleBody });
    expect(res.statusCode).toBe(409);
  });

  it('GET /apps/:name for an unknown app returns 404', async () => {
    const app = buildServer({ repoRoot });
    const res = await app.inject({ method: 'GET', url: '/apps/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('PUT /apps/:name updates fields', async () => {
    const app = buildServer({ repoRoot });
    await app.inject({ method: 'POST', url: '/apps', payload: sampleBody });

    const res = await app.inject({
      method: 'PUT',
      url: '/apps/myapp',
      payload: { resources: { memory: ['256Mi'], cpu: ['250m'] } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().resources).toEqual({ memory: ['256Mi'], cpu: ['250m'] });
  });

  it('DELETE /apps/:name removes it', async () => {
    const app = buildServer({ repoRoot });
    await app.inject({ method: 'POST', url: '/apps', payload: sampleBody });

    const deleteRes = await app.inject({ method: 'DELETE', url: '/apps/myapp' });
    expect(deleteRes.statusCode).toBe(204);

    const getRes = await app.inject({ method: 'GET', url: '/apps/myapp' });
    expect(getRes.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd interface/API
npm test
```

Expected: FAIL — `buildServer({ repoRoot })` doesn't register `/apps` yet, all requests 404 from Fastify's default not-found handler.

- [ ] **Step 3: Create `interface/API/src/routes/apps.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import { ConfigFiles, AppDetail } from '../lib/configFiles.js';
import { statusForError } from '../lib/errors.js';

const stageSchema = {
  type: 'object',
  required: ['duration', 'target'],
  properties: {
    duration: { type: 'string' },
    target: { type: 'number' },
  },
};

const appBodySchema = {
  type: 'object',
  required: ['name', 'container', 'resources', 'load', 'manifestContent', 'scriptContent'],
  properties: {
    name: { type: 'string', minLength: 1 },
    container: { type: 'string', minLength: 1 },
    resources: {
      type: 'object',
      required: ['memory', 'cpu'],
      properties: {
        memory: { type: 'array', items: { type: 'string' }, minItems: 1 },
        cpu: { type: 'array', items: { type: 'string' }, minItems: 1 },
      },
    },
    load: {
      type: 'object',
      required: ['vus', 'stages'],
      properties: {
        vus: { type: 'number' },
        stages: { type: 'array', items: stageSchema, minItems: 1 },
      },
    },
    manifestContent: { type: 'string' },
    scriptContent: { type: 'string' },
  },
};

export function registerAppRoutes(app: FastifyInstance, configFiles: ConfigFiles): void {
  app.get('/apps', async () => configFiles.listApps());

  app.get('/apps/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      return await configFiles.getApp(name);
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });

  app.post('/apps', { schema: { body: appBodySchema } }, async (req, reply) => {
    const detail = req.body as AppDetail;
    try {
      await configFiles.createApp(detail);
      reply.code(201);
      return await configFiles.getApp(detail.name);
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });

  app.put('/apps/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    const partial = req.body as Partial<AppDetail>;
    try {
      return await configFiles.updateApp(name, partial);
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });

  app.delete('/apps/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      await configFiles.deleteApp(name);
      reply.code(204);
      return null;
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });

  app.get('/templates/example', async () => configFiles.getTemplateExample());
}
```

- [ ] **Step 4: Wire it into `interface/API/src/server.ts`**

Replace the whole file with:

```typescript
import Fastify, { FastifyInstance } from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigFiles } from './lib/configFiles.js';
import { registerAppRoutes } from './routes/apps.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

export function buildServer(options?: { repoRoot?: string }): FastifyInstance {
  const repoRoot = options?.repoRoot ?? DEFAULT_REPO_ROOT;

  const app = Fastify({ logger: true });
  app.get('/health', async () => ({ ok: true }));

  const configFiles = new ConfigFiles(repoRoot);
  registerAppRoutes(app, configFiles);

  return app;
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  const app = buildServer();
  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  app.listen({ port, host: '0.0.0.0' }).then(() => {
    app.log.info(`perftest-api listening on port ${port}`);
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd interface/API
npm test
```

Expected: PASS, 21 tests total (14 from Tasks 1-3 + 7 here).

- [ ] **Step 6: Commit**

```bash
git add interface/API/src/routes/apps.ts interface/API/src/routes/apps.test.ts interface/API/src/server.ts
git commit -m "Add /apps routes with JSON schema validation"
```

---

### Task 5: `jobRunner.ts` — spawn perftest.ps1 and track the current run

**Files:**
- Create: `interface/API/src/lib/jobRunner.ts`
- Test: `interface/API/src/lib/jobRunner.test.ts`

**Interfaces:**
- Consumes: `ConfigFiles`/`AppDetail` from Task 3, `ConflictError` from Task 3.
- Produces: `JobStatus`, `JobState`, `CommandSpec` types and class `JobRunner` with constructor `(repoRoot: string, options?: { buildRunCommand?: (configRelPath: string) => CommandSpec; buildTeardownCommand?: () => CommandSpec; pollIntervalMs?: number })` and methods `startRun(appName: string): Promise<JobState>`, `getCurrentJob(): JobState | null`, `cancelCurrentJob(): Promise<void>`. Used by Task 6 (`routes/runs.ts`).

- [ ] **Step 1: Write the failing tests**

Create `interface/API/src/lib/jobRunner.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JobRunner } from './jobRunner.js';
import { ConflictError } from './errors.js';

let repoRoot: string;
let fixtureScriptPath: string;

// Stands in for perftest.ps1: creates an output/<prefix>-<ts> folder (so
// JobRunner's polling has something real to find) then exits with whatever
// code the test asked for, after a short delay so tests can observe the
// 'running' state.
const FIXTURE_SCRIPT = `
const fs = require('fs');
const path = require('path');
const prefix = process.argv[2];
const exitCode = Number(process.argv[3] ?? '0');
const outputDir = path.join(process.cwd(), 'output', prefix + '-' + Date.now());
fs.mkdirSync(outputDir, { recursive: true });
console.log('fixture running for ' + prefix);
setTimeout(() => process.exit(exitCode), 300);
`;

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'perftest-api-jobrunner-'));
  for (const dir of ['configs', 'manifests', 'loadtest']) {
    await fs.mkdir(path.join(repoRoot, dir), { recursive: true });
  }
  await fs.writeFile(
    path.join(repoRoot, 'configs/testapp.yaml'),
    'name: testapp\nmanifest: manifests/testapp.yaml\ncontainer: testapp\nscript: loadtest/testapp.js\nresources:\n  memory: [128Mi]\n  cpu: [100m]\nload:\n  vus: 5\n  stages:\n    - {duration: 5s, target: 5}\n'
  );
  await fs.writeFile(path.join(repoRoot, 'manifests/testapp.yaml'), 'kind: Deployment\n');
  await fs.writeFile(path.join(repoRoot, 'loadtest/testapp.js'), 'export default function(){}\n');

  fixtureScriptPath = path.join(repoRoot, 'fixture.cjs');
  await fs.writeFile(fixtureScriptPath, FIXTURE_SCRIPT);
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

function makeRunner(exitCode = 0) {
  return new JobRunner(repoRoot, {
    pollIntervalMs: 50,
    buildRunCommand: () => ({
      command: process.execPath,
      args: [fixtureScriptPath, 'testapp', String(exitCode)],
    }),
    buildTeardownCommand: () => ({ command: process.execPath, args: ['-e', 'process.exit(0)'] }),
  });
}

describe('JobRunner', () => {
  it('transitions starting -> running -> done and discovers outputDir', async () => {
    const runner = makeRunner(0);
    const job = await runner.startRun('testapp');
    expect(['starting', 'running']).toContain(job.status);

    await waitFor(() => runner.getCurrentJob()?.status === 'done');

    const finalJob = runner.getCurrentJob();
    expect(finalJob?.status).toBe('done');
    expect(finalJob?.exitCode).toBe(0);
    expect(finalJob?.outputDir).toMatch(/^testapp-/);
    expect(finalJob?.logTail).toContain('fixture running for testapp');
  });

  it('transitions to failed when the process exits non-zero', async () => {
    const runner = makeRunner(1);
    await runner.startRun('testapp');

    await waitFor(() => runner.getCurrentJob()?.status === 'failed');

    expect(runner.getCurrentJob()?.exitCode).toBe(1);
  });

  it('rejects a second startRun while one is in progress', async () => {
    const runner = makeRunner(0);
    await runner.startRun('testapp');
    await expect(runner.startRun('testapp')).rejects.toThrow(ConflictError);
  });

  it('getCurrentJob returns null before any run has started', () => {
    const runner = makeRunner(0);
    expect(runner.getCurrentJob()).toBeNull();
  });

  it('cancelCurrentJob kills the process and clears the slot', async () => {
    const runner = new JobRunner(repoRoot, {
      pollIntervalMs: 50,
      buildRunCommand: () => ({
        command: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 60000)'], // hangs until killed
      }),
      buildTeardownCommand: () => ({ command: process.execPath, args: ['-e', 'process.exit(0)'] }),
    });

    await runner.startRun('testapp');
    expect(runner.getCurrentJob()).not.toBeNull();

    await runner.cancelCurrentJob();
    expect(runner.getCurrentJob()).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd interface/API
npm test
```

Expected: FAIL — `Cannot find module './jobRunner.js'`.

- [ ] **Step 3: Create `interface/API/src/lib/jobRunner.ts`**

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
    private repoRoot: string,
    options?: {
      buildRunCommand?: (configRelPath: string) => CommandSpec;
      buildTeardownCommand?: () => CommandSpec;
      pollIntervalMs?: number;
    }
  ) {
    this.configFiles = new ConfigFiles(repoRoot);
    this.buildRunCommand =
      options?.buildRunCommand ??
      ((configRelPath: string) => ({
        command: 'pwsh',
        args: ['-File', path.join(repoRoot, 'perftest.ps1'), '-Full', '-Config', path.join(repoRoot, configRelPath)],
      }));
    this.buildTeardownCommand =
      options?.buildTeardownCommand ??
      (() => ({ command: 'pwsh', args: ['-File', path.join(repoRoot, 'perftest.ps1'), '-Teardown'] }));
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

    const child = spawn(command, args, { cwd: this.repoRoot });
    this.currentProcess = child;
    job.status = 'running';

    const appendLog = (chunk: Buffer) => {
      job.logTail = (job.logTail + chunk.toString()).slice(-MAX_LOG_CHARS);
    };
    child.stdout?.on('data', appendLog);
    child.stderr?.on('data', appendLog);

    child.on('exit', (code) => {
      job.status = code === 0 ? 'done' : 'failed';
      job.exitCode = code ?? undefined;
      job.finishedAt = new Date().toISOString();
      this.stopPolling();
      this.currentProcess = null;
    });

    this.outputPollTimer = setInterval(() => {
      void this.findNewOutputDir(outputPrefix, spawnTime).then((dir) => {
        if (dir) {
          job.outputDir = dir;
          this.stopPolling();
        }
      });
    }, this.pollIntervalMs);

    return job;
  }

  private stopPolling(): void {
    if (this.outputPollTimer) {
      clearInterval(this.outputPollTimer);
      this.outputPollTimer = null;
    }
  }

  private async findNewOutputDir(prefix: string, afterMs: number): Promise<string | undefined> {
    const outputRoot = path.join(this.repoRoot, 'output');
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
      const teardown = spawn(command, args, { cwd: this.repoRoot });
      teardown.on('exit', () => resolve());
      teardown.on('error', () => resolve());
    });

    this.currentJob = null;
    this.currentProcess = null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd interface/API
npm test
```

Expected: PASS, 26 tests total (21 from Tasks 1-4 + 5 here).

- [ ] **Step 5: Commit**

```bash
git add interface/API/src/lib/jobRunner.ts interface/API/src/lib/jobRunner.test.ts
git commit -m "Add JobRunner: spawn perftest.ps1, track current job, discover outputDir"
```

---

### Task 6: `routes/runs.ts` — wire run trigger + status to HTTP

**Files:**
- Create: `interface/API/src/routes/runs.ts`
- Test: `interface/API/src/routes/runs.test.ts`
- Modify: `interface/API/src/server.ts`

**Interfaces:**
- Consumes: `JobRunner` from Task 5, `statusForError` from Task 3.
- Produces: `registerRunRoutes(app: FastifyInstance, jobRunner: JobRunner): void`, registered inside `buildServer`.

- [ ] **Step 1: Write the failing tests**

Create `interface/API/src/routes/runs.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerRunRoutes } from './runs.js';
import { JobRunner } from '../lib/jobRunner.js';

let repoRoot: string;
let fixtureScriptPath: string;

const FIXTURE_SCRIPT = `
const fs = require('fs');
const path = require('path');
const prefix = process.argv[2];
const exitCode = Number(process.argv[3] ?? '0');
const outputDir = path.join(process.cwd(), 'output', prefix + '-' + Date.now());
fs.mkdirSync(outputDir, { recursive: true });
setTimeout(() => process.exit(exitCode), 200);
`;

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'perftest-api-runs-test-'));
  for (const dir of ['configs', 'manifests', 'loadtest']) {
    await fs.mkdir(path.join(repoRoot, dir), { recursive: true });
  }
  await fs.writeFile(
    path.join(repoRoot, 'configs/testapp.yaml'),
    'name: testapp\nmanifest: manifests/testapp.yaml\ncontainer: testapp\nscript: loadtest/testapp.js\nresources:\n  memory: [128Mi]\n  cpu: [100m]\nload:\n  vus: 5\n  stages:\n    - {duration: 5s, target: 5}\n'
  );
  await fs.writeFile(path.join(repoRoot, 'manifests/testapp.yaml'), 'kind: Deployment\n');
  await fs.writeFile(path.join(repoRoot, 'loadtest/testapp.js'), 'export default function(){}\n');

  fixtureScriptPath = path.join(repoRoot, 'fixture.cjs');
  await fs.writeFile(fixtureScriptPath, FIXTURE_SCRIPT);
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

function buildTestApp(exitCode = 0): { app: FastifyInstance; jobRunner: JobRunner } {
  const jobRunner = new JobRunner(repoRoot, {
    pollIntervalMs: 50,
    buildRunCommand: () => ({
      command: process.execPath,
      args: [fixtureScriptPath, 'testapp', String(exitCode)],
    }),
    buildTeardownCommand: () => ({ command: process.execPath, args: ['-e', 'process.exit(0)'] }),
  });
  const app = Fastify({ logger: false });
  registerRunRoutes(app, jobRunner);
  return { app, jobRunner };
}

describe('runs routes', () => {
  it('GET /jobs/current returns 404 when nothing has run', async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/jobs/current' });
    expect(res.statusCode).toBe(404);
  });

  it('POST /apps/:name/runs starts a run and GET /jobs/current reflects it to completion', async () => {
    const { app, jobRunner } = buildTestApp(0);

    const postRes = await app.inject({ method: 'POST', url: '/apps/testapp/runs' });
    expect(postRes.statusCode).toBe(202);
    expect(postRes.json().appName).toBe('testapp');

    await waitFor(() => jobRunner.getCurrentJob()?.status === 'done');

    const getRes = await app.inject({ method: 'GET', url: '/jobs/current' });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().status).toBe('done');
    expect(getRes.json().outputDir).toMatch(/^testapp-/);
  });

  it('POST /apps/:name/runs while one is already running returns 409', async () => {
    const { app } = buildTestApp(0);
    await app.inject({ method: 'POST', url: '/apps/testapp/runs' });
    const res = await app.inject({ method: 'POST', url: '/apps/testapp/runs' });
    expect(res.statusCode).toBe(409);
  });

  it('DELETE /jobs/current cancels the run', async () => {
    const { app, jobRunner } = buildTestApp(0);
    await app.inject({ method: 'POST', url: '/apps/testapp/runs' });

    const res = await app.inject({ method: 'DELETE', url: '/jobs/current' });
    expect(res.statusCode).toBe(200);
    expect(jobRunner.getCurrentJob()).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd interface/API
npm test
```

Expected: FAIL — `Cannot find module './runs.js'`.

- [ ] **Step 3: Create `interface/API/src/routes/runs.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import { JobRunner } from '../lib/jobRunner.js';
import { statusForError } from '../lib/errors.js';

export function registerRunRoutes(app: FastifyInstance, jobRunner: JobRunner): void {
  app.post('/apps/:name/runs', async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      const job = await jobRunner.startRun(name);
      reply.code(202);
      return job;
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });

  app.get('/jobs/current', async (req, reply) => {
    const job = jobRunner.getCurrentJob();
    if (!job) {
      reply.code(404);
      return { error: 'No job has run yet' };
    }
    return job;
  });

  app.delete('/jobs/current', async () => {
    await jobRunner.cancelCurrentJob();
    return { cancelled: true };
  });
}
```

- [ ] **Step 4: Wire it into `interface/API/src/server.ts`**

```typescript
import Fastify, { FastifyInstance } from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigFiles } from './lib/configFiles.js';
import { JobRunner } from './lib/jobRunner.js';
import { registerAppRoutes } from './routes/apps.js';
import { registerRunRoutes } from './routes/runs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

export function buildServer(options?: { repoRoot?: string }): FastifyInstance {
  const repoRoot = options?.repoRoot ?? DEFAULT_REPO_ROOT;

  const app = Fastify({ logger: true });
  app.get('/health', async () => ({ ok: true }));

  const configFiles = new ConfigFiles(repoRoot);
  const jobRunner = new JobRunner(repoRoot);
  registerAppRoutes(app, configFiles);
  registerRunRoutes(app, jobRunner);

  return app;
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  const app = buildServer();
  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  app.listen({ port, host: '0.0.0.0' }).then(() => {
    app.log.info(`perftest-api listening on port ${port}`);
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd interface/API
npm test
```

Expected: PASS, 30 tests total (26 from Tasks 1-5 + 4 here).

- [ ] **Step 6: Commit**

```bash
git add interface/API/src/routes/runs.ts interface/API/src/routes/runs.test.ts interface/API/src/server.ts
git commit -m "Add /apps/:name/runs and /jobs/current routes"
```

---

### Task 7: `routes/outputs.ts` — list and read past run results

**Files:**
- Create: `interface/API/src/routes/outputs.ts`
- Test: `interface/API/src/routes/outputs.test.ts`
- Modify: `interface/API/src/server.ts`

**Interfaces:**
- Consumes: `ConfigFiles` from Task 3, `parseResultsCsv` from Task 2, `statusForError`/`NotFoundError`/`ValidationError` from Task 3.
- Produces: `registerOutputRoutes(app: FastifyInstance, configFiles: ConfigFiles, repoRoot: string): void`, registered inside `buildServer`.

- [ ] **Step 1: Write the failing tests**

Create `interface/API/src/routes/outputs.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerOutputRoutes } from './outputs.js';
import { ConfigFiles } from '../lib/configFiles.js';

let repoRoot: string;

const RESULTS_CSV =
  'memory,cpu,start_time,end_time,duration_seconds,p95_ms,p99_ms,error_rate,http_reqs_total,oom_killed,restart_count\n' +
  '128Mi,100m,2026-07-30T09:00:00.000Z,2026-07-30T09:01:00.000Z,60,1.5,2.1,0,570,no,0\n';

async function buildTestApp() {
  const configFiles = new ConfigFiles(repoRoot);
  const app = Fastify({ logger: false });
  registerOutputRoutes(app, configFiles, repoRoot);
  return app;
}

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'perftest-api-outputs-test-'));
  for (const dir of ['configs', 'manifests', 'loadtest', 'output']) {
    await fs.mkdir(path.join(repoRoot, dir), { recursive: true });
  }
  await fs.writeFile(
    path.join(repoRoot, 'configs/myapp.yaml'),
    'name: internal-name\nmanifest: manifests/myapp.yaml\ncontainer: myapp\nscript: loadtest/myapp.js\nresources:\n  memory: [128Mi]\n  cpu: [100m]\nload:\n  vus: 5\n  stages:\n    - {duration: 5s, target: 5}\n'
  );
  await fs.writeFile(path.join(repoRoot, 'manifests/myapp.yaml'), 'kind: Deployment\n');
  await fs.writeFile(path.join(repoRoot, 'loadtest/myapp.js'), 'export default function(){}\n');

  // The output folder is named after the config's INTERNAL name field
  // ("internal-name"), not the URL app-name ("myapp") - same distinction
  // documented in the API spec/plan constraints.
  await fs.mkdir(path.join(repoRoot, 'output/internal-name-2026-07-30T09-00-00'), { recursive: true });
  await fs.writeFile(
    path.join(repoRoot, 'output/internal-name-2026-07-30T09-00-00/results.csv'),
    RESULTS_CSV
  );
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

describe('outputs routes', () => {
  it('GET /apps/:name/outputs lists folders matching the config internal name, not the URL name', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/apps/myapp/outputs' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { folder: 'internal-name-2026-07-30T09-00-00', timestamp: expect.any(String) },
    ]);
  });

  it('GET /apps/:name/outputs for an unknown app returns 404', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/apps/nope/outputs' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /apps/:name/outputs/:folder returns parsed rows', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rows).toHaveLength(1);
    expect(res.json().rows[0].memory).toBe('128Mi');
    expect(res.json().rows[0].p95_ms).toBe(1.5);
  });

  it('GET /apps/:name/outputs/:folder for a folder that does not belong to the app returns 404', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/some-other-app-2026-01-01T00-00-00',
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /apps/:name/outputs/:folder rejects a folder param containing path traversal', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/' + encodeURIComponent('../../etc'),
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /apps/:name/outputs/:folder/raw returns the raw CSV text', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/raw',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(RESULTS_CSV);
    expect(res.headers['content-type']).toContain('text/csv');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd interface/API
npm test
```

Expected: FAIL — `Cannot find module './outputs.js'`.

- [ ] **Step 3: Create `interface/API/src/routes/outputs.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ConfigFiles } from '../lib/configFiles.js';
import { parseResultsCsv } from '../lib/resultsCsv.js';
import { statusForError, NotFoundError, ValidationError } from '../lib/errors.js';

async function assertOwnedOutputFolder(
  configFiles: ConfigFiles,
  repoRoot: string,
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

  const folderPath = path.join(repoRoot, 'output', folder);
  const stat = await fs.stat(folderPath).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new NotFoundError(`Output folder '${folder}' not found`);
  }
}

export function registerOutputRoutes(app: FastifyInstance, configFiles: ConfigFiles, repoRoot: string): void {
  app.get('/apps/:name/outputs', async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      const appDetail = await configFiles.getApp(name);
      const outputRoot = path.join(repoRoot, 'output');
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
      await assertOwnedOutputFolder(configFiles, repoRoot, name, folder);
      const csvText = await fs.readFile(path.join(repoRoot, 'output', folder, 'results.csv'), 'utf8');
      return { rows: parseResultsCsv(csvText) };
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });

  app.get('/apps/:name/outputs/:folder/raw', async (req, reply) => {
    const { name, folder } = req.params as { name: string; folder: string };
    try {
      await assertOwnedOutputFolder(configFiles, repoRoot, name, folder);
      const csvText = await fs.readFile(path.join(repoRoot, 'output', folder, 'results.csv'), 'utf8');
      reply.header('Content-Type', 'text/csv');
      return csvText;
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });
}
```

- [ ] **Step 4: Wire it into `interface/API/src/server.ts`**

```typescript
import Fastify, { FastifyInstance } from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigFiles } from './lib/configFiles.js';
import { JobRunner } from './lib/jobRunner.js';
import { registerAppRoutes } from './routes/apps.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerOutputRoutes } from './routes/outputs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

export function buildServer(options?: { repoRoot?: string }): FastifyInstance {
  const repoRoot = options?.repoRoot ?? DEFAULT_REPO_ROOT;

  const app = Fastify({ logger: true });
  app.get('/health', async () => ({ ok: true }));

  const configFiles = new ConfigFiles(repoRoot);
  const jobRunner = new JobRunner(repoRoot);
  registerAppRoutes(app, configFiles);
  registerRunRoutes(app, jobRunner);
  registerOutputRoutes(app, configFiles, repoRoot);

  return app;
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  const app = buildServer();
  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  app.listen({ port, host: '0.0.0.0' }).then(() => {
    app.log.info(`perftest-api listening on port ${port}`);
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd interface/API
npm test
```

Expected: PASS, 36 tests total (30 from Tasks 1-6 + 6 here).

- [ ] **Step 6: Commit**

```bash
git add interface/API/src/routes/outputs.ts interface/API/src/routes/outputs.test.ts interface/API/src/server.ts
git commit -m "Add /apps/:name/outputs routes for listing and reading run results"
```

---

### Task 8: `routes/check.ts` — prerequisite check endpoint

**Files:**
- Create: `interface/API/src/routes/check.ts`
- Test: `interface/API/src/routes/check.test.ts`
- Modify: `interface/API/src/server.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (self-contained).
- Produces: `registerCheckRoute(app: FastifyInstance, repoRoot: string, options?: { runCheck?: () => Promise<{ready: boolean; output: string}> }): void`, registered inside `buildServer`.

- [ ] **Step 1: Write the failing tests**

Create `interface/API/src/routes/check.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerCheckRoute } from './check.js';

describe('GET /check', () => {
  it('returns the injected check result', async () => {
    const app = Fastify({ logger: false });
    registerCheckRoute(app, '/fake/repo', {
      runCheck: async () => ({ ready: true, output: '[  OK  ]    kind\n' }),
    });

    const res = await app.inject({ method: 'GET', url: '/check' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ready: true, output: '[  OK  ]    kind\n' });
  });

  it('propagates ready:false when the check fails', async () => {
    const app = Fastify({ logger: false });
    registerCheckRoute(app, '/fake/repo', {
      runCheck: async () => ({ ready: false, output: '[ FAIL ] docker - ...\n' }),
    });

    const res = await app.inject({ method: 'GET', url: '/check' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ready).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd interface/API
npm test
```

Expected: FAIL — `Cannot find module './check.js'`.

- [ ] **Step 3: Create `interface/API/src/routes/check.ts`**

```typescript
import type { FastifyInstance } from 'fastify';
import { spawn } from 'node:child_process';
import path from 'node:path';

export interface CheckResult {
  ready: boolean;
  output: string;
}

function defaultRunCheck(repoRoot: string): Promise<CheckResult> {
  return new Promise((resolve) => {
    const child = spawn('pwsh', ['-File', path.join(repoRoot, 'perftest.ps1'), '-Check'], { cwd: repoRoot });
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
  repoRoot: string,
  options?: { runCheck?: () => Promise<CheckResult> }
): void {
  const runCheck = options?.runCheck ?? (() => defaultRunCheck(repoRoot));
  app.get('/check', async () => runCheck());
}
```

- [ ] **Step 4: Wire it into `interface/API/src/server.ts`**

```typescript
import Fastify, { FastifyInstance } from 'fastify';
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

export function buildServer(options?: { repoRoot?: string }): FastifyInstance {
  const repoRoot = options?.repoRoot ?? DEFAULT_REPO_ROOT;

  const app = Fastify({ logger: true });
  app.get('/health', async () => ({ ok: true }));

  const configFiles = new ConfigFiles(repoRoot);
  const jobRunner = new JobRunner(repoRoot);
  registerAppRoutes(app, configFiles);
  registerRunRoutes(app, jobRunner);
  registerOutputRoutes(app, configFiles, repoRoot);
  registerCheckRoute(app, repoRoot);

  return app;
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  const app = buildServer();
  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  app.listen({ port, host: '0.0.0.0' }).then(() => {
    app.log.info(`perftest-api listening on port ${port}`);
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd interface/API
npm test
```

Expected: PASS, 38 tests total (36 from Tasks 1-7 + 2 here).

- [ ] **Step 6: Commit**

```bash
git add interface/API/src/routes/check.ts interface/API/src/routes/check.test.ts interface/API/src/server.ts
git commit -m "Add /check route wrapping perftest.ps1 -Check"
```

---

### Task 9: Real end-to-end verification against the live engine

**Files:** none created/modified — this task only verifies Tasks 1-8's combined behavior against the real `perftest.ps1`, real `kind`, real `kubectl`, real `k6`, real Docker Desktop.

**Interfaces:**
- Consumes: everything from Tasks 1-8 (`buildServer()` with its default, real `repoRoot`).

- [ ] **Step 1: Confirm the repo's own prerequisites are ready**

```bash
cd interface/API
npm test
```

Expected: PASS, all 38 tests (confirms nothing regressed before the real-infra test).

- [ ] **Step 2: Start the real API server in the background**

```bash
cd interface/API
npm start &
sleep 2
curl -s http://localhost:3001/health
```

Expected: `{"ok":true}`.

- [ ] **Step 3: Confirm prerequisites via the real `/check` endpoint**

```bash
curl -s http://localhost:3001/check
```

Expected: `{"ready":true,"output":"..."}` (matches what `make check` already showed working).

- [ ] **Step 4: Create a fresh app via the API, using the bundled example's content**

The bundled example's own matrix is 3 memory × 4 cpu = 12 combinations,
which would make this one-off validation take upwards of 15 minutes for no
extra confidence. Shrink `resources` to 2 combinations (still real,
still exercises the whole pipeline) when creating the test app:

```bash
curl -s http://localhost:3001/templates/example > /tmp/template.json
node --input-type=commonjs -e "
const t = require('/tmp/template.json');
t.name = 'api-e2e-test';
t.resources = { memory: ['128Mi'], cpu: ['100m', '250m'] };
console.log(JSON.stringify(t));
" > /tmp/create-body.json
curl -s -X POST http://localhost:3001/apps -H 'Content-Type: application/json' -d @/tmp/create-body.json
curl -s http://localhost:3001/apps/api-e2e-test
```

Expected: `POST` returns `201` with the created app's detail; `GET` returns the same content back.

- [ ] **Step 5: Trigger a real run and poll until done**

```bash
curl -s -X POST http://localhost:3001/apps/api-e2e-test/runs
```

Expected: `202` with `{"appName":"api-e2e-test","status":"running",...}`.

```bash
while true; do
  status=$(curl -s http://localhost:3001/jobs/current | node --input-type=commonjs -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).status))")
  echo "status: $status"
  if [ "$status" = "done" ] || [ "$status" = "failed" ]; then break; fi
  sleep 10
done
curl -s http://localhost:3001/jobs/current
```

Expected: eventually prints `status: done` (this takes a few minutes — real cluster create + deploy + 2-combo matrix + teardown, same as a manual `make full` run, just with a smaller matrix per Step 4). The final `GET /jobs/current` shows `status: "done"`, `exitCode: 0`, and a populated `outputDir` starting with `api-e2e-test-`.

- [ ] **Step 6: Confirm results are readable through the API**

```bash
curl -s http://localhost:3001/apps/api-e2e-test/outputs
curl -s "http://localhost:3001/apps/api-e2e-test/outputs/$(curl -s http://localhost:3001/jobs/current | node --input-type=commonjs -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).outputDir))")"
```

Expected: the first call lists at least one folder; the second returns `{"rows": [...]}` with 2 rows (one per resource combo from Step 4's shrunk matrix), each with numeric `p95_ms`/`p99_ms`/`error_rate`/`http_reqs_total`, boolean `oom_killed`, numeric `restart_count`.

- [ ] **Step 7: Clean up the test app and stop the server**

```bash
curl -s -X DELETE http://localhost:3001/apps/api-e2e-test
kill %1
```

Expected: `DELETE` returns `204`; the background `npm start` process is stopped. Confirm `kind get clusters` shows no lingering cluster from this test run (the real run's own `-Full` teardown already handled that).

- [ ] **Step 8: No commit needed** — this task is validation only, nothing to add to git beyond what Tasks 1-8 already committed.

---

## Post-plan state

`interface/API/` is a working Fastify server exposing config CRUD, run trigger/status/cancel, and results reading — verified against the real engine, real `kind` cluster, real k6 load test. `perftest.ps1`/`modules/Perftest.psm1` were never touched. The Lovable frontend (a separate, later effort) can now be built against this API's endpoints.
