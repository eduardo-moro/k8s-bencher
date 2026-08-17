import type { ResultRow } from './resultsCsv.js';
import type { MemorySample } from './memoryTimeseries.js';

export interface MemoryExportSeries {
  memory: string;
  cpu: string;
  points: MemorySample[];
}

interface MetricFamily {
  name: string;
  help: string;
  type: 'gauge';
}

const RESULT_METRICS: { key: 'p95_ms' | 'p99_ms' | 'error_rate' | 'http_reqs_total' | 'restart_count' | 'duration_seconds'; family: MetricFamily }[] = [
  {
    key: 'p95_ms',
    family: {
      name: 'k8s_perftest_http_request_duration_p95_milliseconds',
      help: 'p95 HTTP request duration observed during the load test, in milliseconds',
      type: 'gauge',
    },
  },
  {
    key: 'p99_ms',
    family: {
      name: 'k8s_perftest_http_request_duration_p99_milliseconds',
      help: 'p99 HTTP request duration observed during the load test, in milliseconds',
      type: 'gauge',
    },
  },
  {
    key: 'error_rate',
    family: {
      name: 'k8s_perftest_http_error_rate',
      help: 'Fraction of HTTP requests that failed during the load test (0-1)',
      type: 'gauge',
    },
  },
  {
    key: 'http_reqs_total',
    family: {
      name: 'k8s_perftest_http_requests_total',
      help: 'Total HTTP requests made during the load test',
      type: 'gauge',
    },
  },
  {
    key: 'restart_count',
    family: {
      name: 'k8s_perftest_container_restarts_total',
      help: 'Container restarts observed during the load test',
      type: 'gauge',
    },
  },
  {
    key: 'duration_seconds',
    family: {
      name: 'k8s_perftest_run_duration_seconds',
      help: 'Wall-clock duration of the load test for this resource tier, in seconds',
      type: 'gauge',
    },
  },
];

const OOM_FAMILY: MetricFamily = {
  name: 'k8s_perftest_oom_killed',
  help: 'Whether the container was OOMKilled during the load test (1 = yes, 0 = no)',
  type: 'gauge',
};

const MEMORY_FAMILY: MetricFamily = {
  name: 'k8s_perftest_pod_memory_usage_mib',
  help: 'Pod memory usage sampled via kubectl top pod during the load test, in mebibytes',
  type: 'gauge',
};

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function formatLabels(labels: Record<string, string>): string {
  const pairs = Object.entries(labels).map(([k, v]) => `${k}="${escapeLabelValue(v)}"`);
  return `{${pairs.join(',')}}`;
}

function metricLine(name: string, labels: Record<string, string>, value: number, timestampMs?: number): string {
  const ts = timestampMs !== undefined ? ` ${timestampMs}` : '';
  return `${name}${formatLabels(labels)} ${value}${ts}`;
}

// Prometheus text exposition format (https://prometheus.io/docs/instrumenting/exposition_formats/).
// A run's results are a snapshot, not a live scrape, so this is meant to be
// fed into a Prometheus-compatible tool for offline analysis (promtool,
// a local Prometheus/VictoriaMetrics import, Grafana's static datasource,
// etc.) rather than scraped directly.
export function buildPrometheusExport(
  appName: string,
  folder: string,
  rows: ResultRow[],
  memorySeries: MemoryExportSeries[]
): string {
  const lines: string[] = [];
  const tierLabels = (row: { memory: string; cpu: string }): Record<string, string> => ({
    app: appName,
    run: folder,
    memory: row.memory,
    cpu: row.cpu,
  });

  for (const { key, family } of RESULT_METRICS) {
    lines.push(`# HELP ${family.name} ${family.help}`);
    lines.push(`# TYPE ${family.name} ${family.type}`);
    for (const row of rows) {
      const value = row[key];
      if (value === null || value === undefined) continue;
      lines.push(metricLine(family.name, tierLabels(row), value));
    }
  }

  lines.push(`# HELP ${OOM_FAMILY.name} ${OOM_FAMILY.help}`);
  lines.push(`# TYPE ${OOM_FAMILY.name} ${OOM_FAMILY.type}`);
  for (const row of rows) {
    lines.push(metricLine(OOM_FAMILY.name, tierLabels(row), row.oom_killed ? 1 : 0));
  }

  if (memorySeries.length) {
    lines.push(`# HELP ${MEMORY_FAMILY.name} ${MEMORY_FAMILY.help}`);
    lines.push(`# TYPE ${MEMORY_FAMILY.name} ${MEMORY_FAMILY.type}`);
    for (const series of memorySeries) {
      const labels = tierLabels(series);
      for (const point of series.points) {
        lines.push(metricLine(MEMORY_FAMILY.name, labels, point.memoryMi, point.timestampMs));
      }
    }
  }

  return lines.join('\n') + '\n';
}
