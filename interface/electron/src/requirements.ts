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
