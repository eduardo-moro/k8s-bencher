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
