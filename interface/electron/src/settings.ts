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
