export interface ResultRow {
  memory: string;
  cpu: string;
  start_time: string;
  end_time: string;
  duration_seconds: number;
  p95_ms: number | null;
  p99_ms: number | null;
  error_rate: number | null;
  http_reqs_total: number | null;
  oom_killed: boolean;
  restart_count: number;
}

function parseNumberOrNull(value: string): number | null {
  if (value === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

export function parseResultsCsv(csvText: string): ResultRow[] {
  const lines = csvText.trim().split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length <= 1) return [];

  const header = lines[0].split(',');
  const dataLines = lines.slice(1);

  return dataLines.map((line) => {
    const cells = line.split(',');
    const row: Record<string, string> = {};
    header.forEach((col, i) => {
      row[col] = cells[i] ?? '';
    });

    return {
      memory: row.memory,
      cpu: row.cpu,
      start_time: row.start_time,
      end_time: row.end_time,
      duration_seconds: Number(row.duration_seconds),
      p95_ms: parseNumberOrNull(row.p95_ms),
      p99_ms: parseNumberOrNull(row.p99_ms),
      error_rate: parseNumberOrNull(row.error_rate),
      http_reqs_total: parseNumberOrNull(row.http_reqs_total),
      oom_killed: row.oom_killed === 'yes',
      restart_count: Number(row.restart_count),
    };
  });
}
