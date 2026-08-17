import { describe, it, expect } from 'vitest';
import { parseTopLog } from './memoryTimeseries.js';

describe('parseTopLog', () => {
  it('parses timestamped samples into elapsed seconds and MiB', () => {
    const log =
      '2026-08-12T13:45:00.000Z\thttpbin-945864884-6cws4   25m   36Mi\n' +
      '2026-08-12T13:45:10.000Z\thttpbin-945864884-6cws4   17m   37Mi\n';
    expect(parseTopLog(log)).toEqual([
      { timestampMs: Date.parse('2026-08-12T13:45:00.000Z'), elapsedSeconds: 0, memoryMi: 36, cpuMillicores: 25 },
      { timestampMs: Date.parse('2026-08-12T13:45:10.000Z'), elapsedSeconds: 10, memoryMi: 37, cpuMillicores: 17 },
    ]);
  });

  it('converts Ki and Gi units to MiB', () => {
    const log =
      '2026-08-12T13:45:00.000Z\tpod   10m   2048Ki\n' +
      '2026-08-12T13:45:10.000Z\tpod   10m   1Gi\n';
    const samples = parseTopLog(log);
    expect(samples[0].memoryMi).toBe(2);
    expect(samples[1].memoryMi).toBe(1024);
  });

  it('skips unparseable lines like kubectl error output', () => {
    const log =
      'Error from server (NotFound): podmetrics.metrics.k8s.io "default/pod" not found\n' +
      '2026-08-12T13:45:00.000Z\tpod   25m   36Mi\n' +
      'Unable to connect to the server: dial tcp 127.0.0.1:1234: connectex\n';
    expect(parseTopLog(log)).toEqual([
      { timestampMs: Date.parse('2026-08-12T13:45:00.000Z'), elapsedSeconds: 0, memoryMi: 36, cpuMillicores: 25 },
    ]);
  });

  it('returns an empty array when no sample lines are present', () => {
    expect(parseTopLog('Error from server (NotFound)\n')).toEqual([]);
  });

  it('captures CPU in millicores alongside memory', () => {
    const log = '2026-08-12T13:45:00.000Z\tpod   1500m   512Mi\n';
    expect(parseTopLog(log)[0].cpuMillicores).toBe(1500);
  });

  it('caps a huge gap between samples instead of letting it dominate elapsedSeconds (e.g. the machine slept mid-run)', () => {
    const log =
      '2026-08-12T17:46:59.000Z\tpod   10m   400Mi\n' +
      '2026-08-12T17:47:09.000Z\tpod   10m   410Mi\n' +
      // ~15 hour gap here - a suspended machine, not a real sampling interval.
      '2026-08-13T08:42:38.000Z\tpod   10m   420Mi\n' +
      '2026-08-13T08:42:48.000Z\tpod   10m   430Mi\n';
    const samples = parseTopLog(log);
    expect(samples.map((s) => s.elapsedSeconds)).toEqual([0, 10, 40, 50]);
  });
});
