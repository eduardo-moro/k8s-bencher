import { describe, it, expect } from 'vitest';
import { parseResultsCsv } from './resultsCsv.js';

const HEADER =
  'memory,cpu,start_time,end_time,duration_seconds,p95_ms,p99_ms,error_rate,http_reqs_total,oom_killed,restart_count';

describe('parseResultsCsv', () => {
  it('parses a normal row with all fields populated', () => {
    const csv = `${HEADER}\n256Mi,250m,2026-07-30T09:00:00.000Z,2026-07-30T09:01:00.000Z,60,1.5,2.1,0,570,no,0\n`;
    const rows = parseResultsCsv(csv);
    expect(rows).toEqual([
      {
        memory: '256Mi',
        cpu: '250m',
        start_time: '2026-07-30T09:00:00.000Z',
        end_time: '2026-07-30T09:01:00.000Z',
        duration_seconds: 60,
        p95_ms: 1.5,
        p99_ms: 2.1,
        error_rate: 0,
        http_reqs_total: 570,
        oom_killed: false,
        restart_count: 0,
      },
    ]);
  });

  it('parses oom_killed=yes as true', () => {
    const csv = `${HEADER}\n128Mi,100m,2026-07-30T09:00:00.000Z,2026-07-30T09:01:00.000Z,60,1.5,2.1,0,570,yes,1\n`;
    const rows = parseResultsCsv(csv);
    expect(rows[0].oom_killed).toBe(true);
    expect(rows[0].restart_count).toBe(1);
  });

  it('parses empty numeric fields (rollout never became ready) as null, not NaN', () => {
    const csv = `${HEADER}\n64Mi,50m,2026-07-30T09:00:00.000Z,2026-07-30T09:01:05.000Z,65,,,,,no,0\n`;
    const rows = parseResultsCsv(csv);
    expect(rows[0].p95_ms).toBeNull();
    expect(rows[0].p99_ms).toBeNull();
    expect(rows[0].error_rate).toBeNull();
    expect(rows[0].http_reqs_total).toBeNull();
  });

  it('returns an empty array for a header-only CSV', () => {
    const rows = parseResultsCsv(`${HEADER}\n`);
    expect(rows).toEqual([]);
  });
});
