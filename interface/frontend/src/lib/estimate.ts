import type { AppDetail, OutputEntry } from "./api";

// One-time cluster lifecycle buffer - conservative, since a reused kind
// cluster (New-PerftestCluster skips creation if one already exists) can be
// near-instant, while a cold create + metrics-server rollout takes much
// longer. Without run history there's no reliable way to tell which case
// applies, so this stays modest rather than guessing high.
const SETUP_BUFFER_SECONDS = 30;
// Per-combo overhead beyond the k6 stage time itself: kubectl set resources
// + rollout wait + the harness's own polling granularity. Observed 30-110s
// per combo across a real 12-combo run - a flat one-time buffer badly
// undercounted this since it scales with combo count, not with the run as
// a whole.
const PER_COMBO_OVERHEAD_SECONDS = 60;
// How many of the most recent full runs to average - recent-weighted so the
// estimate tracks environment changes (e.g. moving the engine from native
// Windows to WSL) instead of averaging over a run history that may no
// longer be representative.
const HISTORY_SAMPLE_SIZE = 3;

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

// Theoretical (stages x combos) badly under-estimates real wall-clock time:
// it ignores cluster create/teardown and the per-combo kubectl rollout wait,
// which in practice dwarf the buffer this used to add. Once we have actual
// full-run history for this app, prefer an empirical seconds-per-combo rate
// (total run time / how many combos it actually covered) averaged over the
// last few runs - that bakes in the real overhead without having to model
// kind/metrics-server/rollout timing by hand.
function historicalSecondsPerCombo(outputs: OutputEntry[]): number | null {
  const samples = outputs
    .filter((o) => o.totalDurationSeconds !== undefined && o.rowCount > 0)
    .slice(0, HISTORY_SAMPLE_SIZE)
    .map((o) => o.totalDurationSeconds! / o.rowCount);
  if (!samples.length) return null;
  return samples.reduce((sum, s) => sum + s, 0) / samples.length;
}

export function estimateRunSeconds(
  app: Pick<AppDetail, "load" | "resources">,
  outputs: OutputEntry[] = [],
): number {
  const combos = app.resources.memory.length * app.resources.cpu.length;

  const perCombo = historicalSecondsPerCombo(outputs);
  if (perCombo !== null) return perCombo * combos;

  const stageSeconds = app.load.stages.reduce((sum, s) => sum + parseDurationSeconds(s.duration), 0);
  return (stageSeconds + PER_COMBO_OVERHEAD_SECONDS) * combos + SETUP_BUFFER_SECONDS;
}

export function formatEstimate(totalSeconds: number): string {
  if (totalSeconds < 60) return `~${Math.round(totalSeconds)}s`;
  return `~${Math.round(totalSeconds / 60)} min`;
}
