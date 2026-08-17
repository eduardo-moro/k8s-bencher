export interface ThroughputSample {
  elapsedSeconds: number;
  requestsPerSecond: number;
}

interface K6MetricPoint {
  metric?: string;
  data?: { time?: string; value?: number };
}

// Parses k6's `--out json=<file>` raw metrics stream (newline-delimited
// JSON, one point per line - written to k6-metrics-<mem>-<cpu>.ndjson
// alongside k6-logs-<mem>-<cpu>.log, which only has the human progress bar).
//
// http_req_failed is a per-request 0/1 metric; value===0 means that
// specific request succeeded. Counting those, bucketed by the real
// wall-clock second each one completed in, gives actual successful
// throughput. A naive "iterations completed" count (what this used to
// parse from the progress bar) spikes to nonsense when the app is down:
// requests that fail instantly (connection refused) complete their
// iteration just as fast, so many "iterations" finish in the same tick
// even though nothing actually succeeded. Counting only http_req_failed=0
// makes that show up as a drop in the chart instead of a fake spike.
export function parseK6ThroughputLog(ndjsonText: string): ThroughputSample[] {
  const perSecond = new Map<number, number>();

  for (const line of ndjsonText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;

    let point: K6MetricPoint;
    try {
      point = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (point.metric !== 'http_req_failed' || point.data?.value !== 0) continue;

    const timestamp = Date.parse(point.data?.time ?? '');
    if (Number.isNaN(timestamp)) continue;

    const bucket = Math.floor(timestamp / 1000);
    perSecond.set(bucket, (perSecond.get(bucket) ?? 0) + 1);
  }

  const buckets = [...perSecond.keys()].sort((a, b) => a - b);
  if (!buckets.length) return [];

  const start = buckets[0];
  return buckets.map((b) => ({
    elapsedSeconds: b - start,
    requestsPerSecond: perSecond.get(b) as number,
  }));
}
