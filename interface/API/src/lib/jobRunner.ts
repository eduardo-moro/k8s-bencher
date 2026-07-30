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
