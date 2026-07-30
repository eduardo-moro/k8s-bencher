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

    // Wait for the fixture process to exit before the test ends: on Windows,
    // afterEach's recursive rm of repoRoot can hit EBUSY if a child process
    // still has that directory as its cwd when cleanup runs.
    await waitFor(() => runner.getCurrentJob()?.status === 'done');
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
