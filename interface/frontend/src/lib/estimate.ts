import type { AppDetail } from "./api";

const SETUP_BUFFER_SECONDS = 30;

function parseDurationSeconds(duration: string): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(duration.trim());
  if (!match) return 0;
  const value = Number(match[1]);
  switch (match[2]) {
    case "ms":
      return value / 1000;
    case "s":
      return value;
    case "m":
      return value * 60;
    case "h":
      return value * 3600;
    default:
      return 0;
  }
}

export function estimateRunSeconds(app: Pick<AppDetail, "load" | "resources">): number {
  const stageSeconds = app.load.stages.reduce((sum, s) => sum + parseDurationSeconds(s.duration), 0);
  const combos = app.resources.memory.length * app.resources.cpu.length;
  return stageSeconds * combos + SETUP_BUFFER_SECONDS;
}

export function formatEstimate(totalSeconds: number): string {
  if (totalSeconds < 60) return `~${Math.round(totalSeconds)}s`;
  return `~${Math.round(totalSeconds / 60)} min`;
}
