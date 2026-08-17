export interface RestartEvent {
  timestampMs: number;
  restartCount: number;
  // The container's lastState.terminated.reason at the moment this restart
  // was detected. 'OOMKilled' is the only reason Kubernetes sets for a real
  // out-of-memory kill; anything else (usually 'Error') is typically a
  // livenessProbe timeout - at low CPU tiers, that's most often the app
  // being too CPU-throttled to answer the probe in time, not a crash.
  reason: string;
}

// A line looks like: "<ISO timestamp>\t<restart count after this event>\t<reason>"
// e.g. "2026-08-12T20:51:14.850Z\t3\tOOMKilled" - written by the same
// background sampler that writes top-<mem>-<cpu>.log, once per detected
// restart-count increase.
const LINE = /^(\S+)\t(\d+)\t(\S+)\s*$/;

export function parseRestartsLog(logText: string): RestartEvent[] {
  const events: RestartEvent[] = [];
  for (const line of logText.split(/\r?\n/)) {
    const match = line.match(LINE);
    if (!match) continue;

    const timestampMs = Date.parse(match[1]);
    if (Number.isNaN(timestampMs)) continue;

    events.push({ timestampMs, restartCount: Number(match[2]), reason: match[3] });
  }
  return events;
}
