import { describe, it, expect } from 'vitest';
import { parseK6ThroughputLog } from './k6Throughput.js';

function point(metric: string, time: string, value: number): string {
  return JSON.stringify({ type: 'Point', metric, data: { time, value, tags: {} } });
}

describe('parseK6ThroughputLog', () => {
  it('counts only successful requests (http_req_failed value 0), bucketed per second', () => {
    const lines = [
      point('http_req_failed', '2026-08-13T10:00:00.100Z', 0),
      point('http_req_failed', '2026-08-13T10:00:00.400Z', 0),
      point('http_reqs', '2026-08-13T10:00:00.400Z', 1), // not http_req_failed - ignored
      point('http_req_failed', '2026-08-13T10:00:01.200Z', 0),
      point('http_req_failed', '2026-08-13T10:00:01.500Z', 0),
      point('http_req_failed', '2026-08-13T10:00:01.900Z', 0),
    ];
    expect(parseK6ThroughputLog(lines.join('\n'))).toEqual([
      { elapsedSeconds: 0, requestsPerSecond: 2 },
      { elapsedSeconds: 1, requestsPerSecond: 3 },
    ]);
  });

  it('does not count failed requests, so a burst of fast failures reads as a drop, not a spike', () => {
    // Simulates the pod restarting: 200 requests fail near-instantly (connection
    // refused) within the same second - none of them should inflate the rate.
    const failures = Array.from({ length: 200 }, (_, i) =>
      point('http_req_failed', `2026-08-13T10:00:05.${String(i % 900).padStart(3, '0')}Z`, 1),
    );
    const successesBefore = [point('http_req_failed', '2026-08-13T10:00:04.000Z', 0)];
    const lines = [...successesBefore, ...failures];

    const samples = parseK6ThroughputLog(lines.join('\n'));
    expect(samples).toEqual([{ elapsedSeconds: 0, requestsPerSecond: 1 }]);
  });

  it('skips human-readable progress lines and other non-JSON noise', () => {
    const log =
      'running (0m54.0s), 20/20 VUs, 383 complete and 0 interrupted iterations\n' +
      point('http_req_failed', '2026-08-13T10:00:00.000Z', 0) +
      '\n';
    expect(parseK6ThroughputLog(log)).toEqual([{ elapsedSeconds: 0, requestsPerSecond: 1 }]);
  });

  it('returns an empty array when there are no successful requests', () => {
    expect(parseK6ThroughputLog('')).toEqual([]);
    expect(parseK6ThroughputLog(point('http_req_failed', '2026-08-13T10:00:00.000Z', 1))).toEqual([]);
  });
});
