import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { JobRunner } from './jobRunner.js';
import { ConflictError } from './errors.js';

// node:child_process's ESM named exports are non-configurable (verified: Node
// throws "Cannot redefine property: spawn" from Object.defineProperty), so
// vi.spyOn on the live module namespace can never work here regardless of
// jobRunner.ts's implementation. vi.mock replaces the module in the registry
// instead of mutating the real object, sidestepping that restriction. Must be
// declared at module scope (hoisted by vitest) since jobRunner.ts's own
// `import { spawn } from 'node:child_process'` binds at that module's load
// time, before any in-test vi.doMock could take effect.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

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
  return new JobRunner(repoRoot, repoRoot, {
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

  it('does not mistake a pre-existing output folder for the new run\'s (birthtime is unreliable on some filesystems, e.g. WSL2 DrvFS)', async () => {
    const staleDir = path.join(repoRoot, 'output', 'testapp-stale-from-a-previous-run');
    await fs.mkdir(staleDir, { recursive: true });

    const runner = makeRunner(0);
    await runner.startRun('testapp');
    await waitFor(() => runner.getCurrentJob()?.status === 'done');

    const finalJob = runner.getCurrentJob();
    expect(finalJob?.outputDir).toMatch(/^testapp-/);
    expect(finalJob?.outputDir).not.toBe('testapp-stale-from-a-previous-run');
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

  it('default buildRunCommand points at engineRoot/perftest.ps1 and passes -DataRoot dataRoot', async () => {
    const engineRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'perftest-api-jobrunner-engine-'));
    const runner = new JobRunner(repoRoot, engineRoot, { pollIntervalMs: 50 });

    const expectedPerftestPath = path.join(engineRoot, 'perftest.ps1');
    const expectedConfigPath = path.join(repoRoot, 'configs/testapp.yaml');

    // startRun will fail fast (no real pwsh needed to fail) once it tries to
    // spawn a literal 'pwsh' - what matters is the args array shape it built
    // before spawning, so fake a minimal ChildProcess-shaped EventEmitter for
    // this one call rather than letting the real spawn run (spawn is the
    // module-mocked vi.fn() declared at the top of this file).
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockImplementationOnce((..._args: unknown[]) => {
      const fake = new EventEmitter() as unknown as ChildProcess;
      (fake as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
      (fake as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
      return fake;
    });

    await runner.startRun('testapp');

    expect(spawnMock).toHaveBeenCalledWith(
      'pwsh',
      ['-File', expectedPerftestPath, '-Full', '-Config', expectedConfigPath, '-DataRoot', repoRoot],
      { cwd: repoRoot }
    );

    await fs.rm(engineRoot, { recursive: true, force: true });
  });

  it('cancelCurrentJob kills the process and clears the slot', async () => {
    const runner = new JobRunner(repoRoot, repoRoot, {
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

  // Regression test for a stale-identity race: a cancelled run's own late-resolving
  // output-poll tick (started before cancellation, but landing after a subsequent run
  // has already been assigned a *new* timer/process) must not be able to stop the new
  // run's polling. Note: on Windows, child.kill() forcefully and immediately terminates
  // the process (Node ignores the signal name and kills it like SIGKILL), and
  // cancelCurrentJob() itself spawns+awaits a real teardown process before returning
  // (empirically ~25-85ms) -- which is *slower* than a killed process's own exit
  // notification (empirically ~7-10ms). So a killed child's 'exit' event always fires
  // and is fully handled *before* cancelCurrentJob() can return, making the literal
  // "child ignores SIGTERM so its exit event arrives late" scenario unreproducible via
  // real OS processes on this platform. This test instead drives the *other* half of
  // the same bug -- the output-poll timer's stale in-flight tick -- deterministically,
  // by gating a single fs.readdir() call with a manually-controlled promise instead of
  // relying on wall-clock timing.
  it("does not let a cancelled run's stale poll tick clobber a subsequently started run", async () => {
    const realReaddir = fs.readdir.bind(fs);
    let callIndex = 0;
    let releaseFirstCall: (() => void) | null = null;
    const firstCallGate = new Promise<void>((resolve) => {
      releaseFirstCall = resolve;
    });

    const readdirSpy = vi.spyOn(fs, 'readdir').mockImplementation(async (...args: Parameters<typeof fs.readdir>) => {
      const isFirst = callIndex === 0;
      callIndex++;
      if (isFirst) {
        await firstCallGate;
      }
      return (realReaddir as (...a: Parameters<typeof fs.readdir>) => ReturnType<typeof fs.readdir>)(...args);
    });

    try {
      let callCount = 0;
      const runner = new JobRunner(repoRoot, repoRoot, {
        pollIntervalMs: 200, // generous: long enough that neither job's own tick fires within our engineered window
        buildRunCommand: () => {
          callCount++;
          if (callCount === 1) {
            // job1: hangs until killed, creates no output dir of its own.
            return { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000);'] };
          }
          // job2: the real fixture, creates its own output dir promptly at startup.
          return { command: process.execPath, args: [fixtureScriptPath, 'testapp', '0'] };
        },
        buildTeardownCommand: () => ({ command: process.execPath, args: ['-e', 'process.exit(0)'] }),
      });

      await runner.startRun('testapp'); // job1
      // Wait for job1's first poll tick to have started (called readdir); it's now
      // blocked on firstCallGate, i.e. a stale in-flight tick for job1.
      await waitFor(() => callIndex >= 1);

      await runner.cancelCurrentJob(); // kills job1, clears job1's timer reference
      const second = await runner.startRun('testapp'); // job2: assigns a NEW timer/process
      expect(second.status).toBe('running');

      // Give job2's fixture script real wall-clock time to start up and create its own
      // output dir (well under pollIntervalMs, so job2's own tick can't have fired yet).
      await new Promise((r) => setTimeout(r, 50));

      // Release job1's stale, gated readdir call now: it resolves using the *current*
      // real directory listing (which already includes job2's dir), while job2's own
      // timer is still the active one and hasn't ticked on its own yet.
      releaseFirstCall!();

      await waitFor(() => runner.getCurrentJob()?.status === 'done');
      const finalJob = runner.getCurrentJob();
      expect(finalJob?.outputDir).toMatch(/^testapp-/);
    } finally {
      readdirSpy.mockRestore();
    }
  });
});
