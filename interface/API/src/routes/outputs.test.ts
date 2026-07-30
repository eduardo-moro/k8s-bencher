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
