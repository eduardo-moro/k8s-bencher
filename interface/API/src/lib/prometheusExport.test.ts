import { describe, it, expect } from 'vitest';
import { buildPrometheusExport } from './prometheusExport.js';
import type { ResultRow } from './resultsCsv.js';

const ROW: ResultRow = {
  memory: '128Mi',
  cpu: '100m',
  start_time: '2026-08-12T13:45:00.000Z',
  end_time: '2026-08-12T13:46:00.000Z',
  duration_seconds: 60,
  p95_ms: 12.5,
  p99_ms: 20.1,
  error_rate: 0,
  http_reqs_total: 570,
  oom_killed: false,
  restart_count: 0,
};

describe('buildPrometheusExport', () => {
  it('emits one HELP/TYPE pair and a labeled sample per metric', () => {
    const text = buildPrometheusExport('myapp', 'myapp-2026-08-12T13-45-00', [ROW], []);

    expect(text).toContain('# TYPE k8s_perftest_http_request_duration_p95_milliseconds gauge');
    expect(text).toContain(
      'k8s_perftest_http_request_duration_p95_milliseconds{app="myapp",run="myapp-2026-08-12T13-45-00",memory="128Mi",cpu="100m"} 12.5'
    );
    expect(text).toContain(
      'k8s_perftest_oom_killed{app="myapp",run="myapp-2026-08-12T13-45-00",memory="128Mi",cpu="100m"} 0'
    );
  });

  it('skips a metric line when the underlying value is null (rollout never became ready)', () => {
    const brokenRow: ResultRow = { ...ROW, p95_ms: null, p99_ms: null, error_rate: null, http_reqs_total: null };
    const text = buildPrometheusExport('myapp', 'run-folder', [brokenRow], []);

    expect(text).not.toContain('k8s_perftest_http_request_duration_p95_milliseconds{');
    // oom/restart/duration are never null, so those families still emit a sample.
    expect(text).toContain('k8s_perftest_run_duration_seconds{');
  });

  it('emits a timestamped sample per memory point, and omits the family when there is no memory data', () => {
    const withMemory = buildPrometheusExport('myapp', 'run-folder', [ROW], [
      {
        memory: '128Mi',
        cpu: '100m',
        points: [{ timestampMs: 1755006300000, elapsedSeconds: 0, memoryMi: 36, cpuMillicores: 25 }],
      },
    ]);
    expect(withMemory).toContain('# TYPE k8s_perftest_pod_memory_usage_mib gauge');
    expect(withMemory).toContain(
      'k8s_perftest_pod_memory_usage_mib{app="myapp",run="run-folder",memory="128Mi",cpu="100m"} 36 1755006300000'
    );

    const withoutMemory = buildPrometheusExport('myapp', 'run-folder', [ROW], []);
    expect(withoutMemory).not.toContain('k8s_perftest_pod_memory_usage_mib');
  });

  it('escapes quotes and backslashes in label values', () => {
    const weirdRow: ResultRow = { ...ROW, memory: '128"Mi\\x' };
    const text = buildPrometheusExport('myapp', 'run-folder', [weirdRow], []);
    expect(text).toContain('memory="128\\"Mi\\\\x"');
  });
});
