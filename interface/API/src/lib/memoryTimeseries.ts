export interface MemorySample {
  timestampMs: number;
  elapsedSeconds: number;
  memoryMi: number;
  cpuMillicores: number | null;
}

// A sample line looks like: "<ISO timestamp>\t<pod name>   <cpu>   <memory>"
// e.g. "2026-08-12T13:45:00.123Z\thttpbin-6d8f8b7c9d-abcde   17m   37Mi"
// kubectl top pod always reports CPU in millicores with an "m" suffix
// (e.g. "17m", "1500m" for 1.5 cores), never a bare core count, and always
// alongside memory - a line with one but not the other doesn't happen in
// practice, so both are required for a line to count as a sample.
const SAMPLE_LINE = /^(\S+)\t\S+\s+(\d+)m\s+(\d+)(Ki|Mi|Gi)\s*$/;

function toMebibytes(value: number, unit: string): number {
  switch (unit) {
    case 'Ki':
      return value / 1024;
    case 'Gi':
      return value * 1024;
    default:
      return value;
  }
}

export function parseTopLog(logText: string): MemorySample[] {
  const timestamped: { timestamp: number; memoryMi: number; cpuMillicores: number | null }[] = [];

  for (const line of logText.split(/\r?\n/)) {
    const match = line.match(SAMPLE_LINE);
    if (!match) continue;

    const timestamp = Date.parse(match[1]);
    if (Number.isNaN(timestamp)) continue;

    timestamped.push({
      timestamp,
      memoryMi: toMebibytes(Number(match[3]), match[4]),
      cpuMillicores: Number(match[2]),
    });
  }

  if (timestamped.length === 0) return [];

  // elapsedSeconds tracks active sampling time, not raw wall-clock delta:
  // the sampler polls every ~10s, so a gap far larger than that means the
  // machine (or WSL) was suspended, not that the combo actually ran that
  // long. An uncapped gap would stretch a chart's shared time axis out to
  // match it, squashing every normal-duration sample into a sliver near 0 -
  // capping each gap's contribution keeps a multi-hour sleep from doing that
  // while still counting genuine (if slow) elapsed time up to the cap.
  const MAX_GAP_MS = 30_000;
  let elapsedMs = 0;
  return timestamped.map((s, i) => {
    if (i > 0) {
      const gap = s.timestamp - timestamped[i - 1].timestamp;
      elapsedMs += Math.min(gap, MAX_GAP_MS);
    }
    return {
      timestampMs: s.timestamp,
      elapsedSeconds: Math.round(elapsedMs / 1000),
      memoryMi: s.memoryMi,
      cpuMillicores: s.cpuMillicores,
    };
  });
}
