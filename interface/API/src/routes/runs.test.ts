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
  const jobRunner = new JobRunner(repoRoot, repoRoot, {
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
    const { app, jobRunner } = buildTestApp(0);
    await app.inject({ method: 'POST', url: '/apps/testapp/runs' });
    const res = await app.inject({ method: 'POST', url: '/apps/testapp/runs' });
    expect(res.statusCode).toBe(409);

    // afterEach's recursive rm of repoRoot can hit EBUSY if the fixture child
    // still has that directory as its cwd when cleanup runs - wait for it to
    // exit first, same convention as jobRunner.test.ts.
    await waitFor(() => jobRunner.getCurrentJob()?.status === 'done');
  });

  it('DELETE /jobs/current cancels the run', async () => {
    const { app, jobRunner } = buildTestApp(0);
    await app.inject({ method: 'POST', url: '/apps/testapp/runs' });

    const res = await app.inject({ method: 'DELETE', url: '/jobs/current' });
    expect(res.statusCode).toBe(200);
    expect(jobRunner.getCurrentJob()).toBeNull();
  });
});
