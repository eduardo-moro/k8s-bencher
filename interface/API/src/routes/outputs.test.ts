import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerOutputRoutes } from './outputs.js';
import { ConfigFiles } from '../lib/configFiles.js';

let repoRoot: string;

const RESULTS_CSV =
  'memory,cpu,start_time,end_time,duration_seconds,p95_ms,p99_ms,error_rate,http_reqs_total,oom_killed,restart_count\n' +
  '128Mi,100m,2026-07-30T09:00:00.000Z,2026-07-30T09:01:00.000Z,60,1.5,2.1,0,570,no,0\n';

async function buildTestApp() {
  const configFiles = new ConfigFiles(repoRoot);
  const app = Fastify({ logger: false });
  registerOutputRoutes(app, configFiles, repoRoot);
  return app;
}

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'perftest-api-outputs-test-'));
  for (const dir of ['configs', 'manifests', 'loadtest', 'output']) {
    await fs.mkdir(path.join(repoRoot, dir), { recursive: true });
  }
  await fs.writeFile(
    path.join(repoRoot, 'configs/myapp.yaml'),
    'name: internal-name\nmanifest: manifests/myapp.yaml\ncontainer: myapp\nscript: loadtest/myapp.js\nresources:\n  memory: [128Mi]\n  cpu: [100m]\nload:\n  vus: 5\n  stages:\n    - {duration: 5s, target: 5}\n'
  );
  await fs.writeFile(path.join(repoRoot, 'manifests/myapp.yaml'), 'kind: Deployment\n');
  await fs.writeFile(path.join(repoRoot, 'loadtest/myapp.js'), 'export default function(){}\n');

  // The output folder is named after the config's INTERNAL name field
  // ("internal-name"), not the URL app-name ("myapp") - same distinction
  // documented in the API spec/plan constraints.
  await fs.mkdir(path.join(repoRoot, 'output/internal-name-2026-07-30T09-00-00'), { recursive: true });
  await fs.writeFile(
    path.join(repoRoot, 'output/internal-name-2026-07-30T09-00-00/results.csv'),
    RESULTS_CSV
  );
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

describe('outputs routes', () => {
  it('GET /apps/:name/outputs lists folders matching the config internal name, not the URL name', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/apps/myapp/outputs' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        folder: 'internal-name-2026-07-30T09-00-00',
        timestamp: expect.any(String),
        rowCount: 1,
        totalDurationSeconds: undefined,
      },
    ]);
  });

  it('GET /apps/:name/outputs reports rowCount 0 for a folder whose results.csv is missing or unreadable', async () => {
    await fs.mkdir(path.join(repoRoot, 'output/internal-name-2026-07-30T10-00-00'), { recursive: true });
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/apps/myapp/outputs' });
    expect(res.statusCode).toBe(200);
    const entry = res.json().find((e: { folder: string }) => e.folder === 'internal-name-2026-07-30T10-00-00');
    expect(entry.rowCount).toBe(0);
  });

  it('GET /apps/:name/outputs includes totalDurationSeconds from run-meta.json when present', async () => {
    await fs.writeFile(
      path.join(repoRoot, 'output/internal-name-2026-07-30T09-00-00/run-meta.json'),
      JSON.stringify({ totalDurationSeconds: 1800 })
    );
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/apps/myapp/outputs' });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].totalDurationSeconds).toBe(1800);
  });

  it('GET /apps/:name/outputs for an unknown app returns 404', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/apps/nope/outputs' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /apps/:name/outputs/:folder returns parsed rows', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rows).toHaveLength(1);
    expect(res.json().rows[0].memory).toBe('128Mi');
    expect(res.json().rows[0].p95_ms).toBe(1.5);
  });

  it('GET /apps/:name/outputs/:folder for a folder that does not belong to the app returns 404', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/some-other-app-2026-01-01T00-00-00',
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /apps/:name/outputs/:folder rejects a folder param containing path traversal', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/' + encodeURIComponent('../../etc'),
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /apps/:name/outputs/:folder/raw returns the raw CSV text', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/raw',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(RESULTS_CSV);
    expect(res.headers['content-type']).toContain('text/csv');
  });

  it('GET /apps/:name/outputs/:folder/memory returns a RAM-over-time series per tier', async () => {
    await fs.writeFile(
      path.join(repoRoot, 'output/internal-name-2026-07-30T09-00-00/top-128Mi-100m.log'),
      '2026-07-30T09:00:00.000Z\tmyapp-abc123   25m   36Mi\n' +
        '2026-07-30T09:00:10.000Z\tmyapp-abc123   17m   40Mi\n'
    );
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/memory',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().series).toEqual([
      {
        tier: '128Mi/100m',
        memory: '128Mi',
        cpu: '100m',
        points: [
          { timestampMs: Date.parse('2026-07-30T09:00:00.000Z'), elapsedSeconds: 0, memoryMi: 36, cpuMillicores: 25 },
          { timestampMs: Date.parse('2026-07-30T09:00:10.000Z'), elapsedSeconds: 10, memoryMi: 40, cpuMillicores: 17 },
        ],
      },
    ]);
  });

  it('GET /apps/:name/outputs/:folder/memory skips tiers with no top log (rollout never became ready)', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/memory',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().series).toEqual([]);
  });

  it('GET /apps/:name/outputs/:folder/memory-series returns points for a single combo, including a combo with no results.csv row yet', async () => {
    // 256Mi/200m deliberately has no row in RESULTS_CSV - simulates a combo
    // that's still running (matrix hasn't appended its row yet), which is
    // exactly why this endpoint looks up the file directly instead of going
    // through results.csv rows like /memory does.
    await fs.writeFile(
      path.join(repoRoot, 'output/internal-name-2026-07-30T09-00-00/top-256Mi-200m.log'),
      '2026-07-30T09:00:00.000Z\tmyapp-abc123   50m   100Mi\n'
    );
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/memory-series?memory=256Mi&cpu=200m',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().points).toEqual([
      { timestampMs: Date.parse('2026-07-30T09:00:00.000Z'), elapsedSeconds: 0, memoryMi: 100, cpuMillicores: 50 },
    ]);
  });

  it('GET /apps/:name/outputs/:folder/memory-series returns an empty array when the combo has no top log yet', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/memory-series?memory=999Mi&cpu=999m',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().points).toEqual([]);
  });

  it('GET /apps/:name/outputs/:folder/memory-series rejects memory/cpu values containing path separators', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url:
        '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/memory-series?memory=' +
        encodeURIComponent('../../etc') +
        '&cpu=100m',
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /apps/:name/outputs/:folder/restarts returns timestamped restart events with their reason', async () => {
    await fs.writeFile(
      path.join(repoRoot, 'output/internal-name-2026-07-30T09-00-00/restarts-128Mi-100m.log'),
      '2026-07-30T09:00:30.000Z\t1\tOOMKilled\n2026-07-30T09:01:15.000Z\t2\tError\n'
    );
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/restarts?memory=128Mi&cpu=100m',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().events).toEqual([
      { timestampMs: Date.parse('2026-07-30T09:00:30.000Z'), restartCount: 1, reason: 'OOMKilled' },
      { timestampMs: Date.parse('2026-07-30T09:01:15.000Z'), restartCount: 2, reason: 'Error' },
    ]);
  });

  it('GET /apps/:name/outputs/:folder/restarts returns an empty array when the combo never restarted', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/restarts?memory=128Mi&cpu=100m',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().events).toEqual([]);
  });

  it('GET /apps/:name/outputs/:folder/throughput returns successful requests/sec derived from the k6 metrics stream', async () => {
    const point = (time: string, value: number) =>
      JSON.stringify({ type: 'Point', metric: 'http_req_failed', data: { time, value, tags: {} } });
    await fs.writeFile(
      path.join(repoRoot, 'output/internal-name-2026-07-30T09-00-00/k6-metrics-128Mi-100m.ndjson'),
      [
        point('2026-07-30T09:00:00.100Z', 0),
        point('2026-07-30T09:00:00.400Z', 0),
        point('2026-07-30T09:00:01.200Z', 0),
      ].join('\n')
    );
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/throughput?memory=128Mi&cpu=100m',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().points).toEqual([
      { elapsedSeconds: 0, requestsPerSecond: 2 },
      { elapsedSeconds: 1, requestsPerSecond: 1 },
    ]);
  });

  it('GET /apps/:name/outputs/:folder/throughput returns an empty array when there is no k6 metrics file yet', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/throughput?memory=999Mi&cpu=999m',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().points).toEqual([]);
  });

  it('GET /apps/:name/outputs/:folder/prometheus returns Prometheus-format metrics including RAM samples', async () => {
    await fs.writeFile(
      path.join(repoRoot, 'output/internal-name-2026-07-30T09-00-00/top-128Mi-100m.log'),
      '2026-07-30T09:00:00.000Z\tmyapp-abc123   25m   36Mi\n'
    );
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/prometheus',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.headers['content-type']).toContain('version=0.0.4');
    expect(res.body).toContain('# TYPE k8s_perftest_http_request_duration_p95_milliseconds gauge');
    expect(res.body).toContain(
      'k8s_perftest_http_request_duration_p95_milliseconds{app="myapp",run="internal-name-2026-07-30T09-00-00",memory="128Mi",cpu="100m"} 1.5'
    );
    expect(res.body).toContain(
      `k8s_perftest_pod_memory_usage_mib{app="myapp",run="internal-name-2026-07-30T09-00-00",memory="128Mi",cpu="100m"} 36 ${Date.parse('2026-07-30T09:00:00.000Z')}`
    );
  });

  it('GET /apps/:name/outputs/:folder/prometheus for a folder that does not belong to the app returns 404', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/some-other-app-2026-01-01T00-00-00/prometheus',
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /apps/:name/outputs/:folder/logs returns the last page of the captured pod log for that combo', async () => {
    await fs.writeFile(
      path.join(repoRoot, 'output/internal-name-2026-07-30T09-00-00/logs-128Mi-100m.log'),
      'Hosting environment: Development\nNow listening on: http://0.0.0.0:8100\n'
    );
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/logs?memory=128Mi&cpu=100m',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      lines: ['Hosting environment: Development', 'Now listening on: http://0.0.0.0:8100'],
      hasMore: false,
      startIndex: 0,
    });
  });

  it('GET /apps/:name/outputs/:folder/logs returns an empty page when the combo has no captured log yet (still running)', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/logs?memory=256Mi&cpu=200m',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ lines: [], hasMore: false, startIndex: 0 });
  });

  it('GET /apps/:name/outputs/:folder/logs paginates: first page is the tail, before=startIndex walks backwards', async () => {
    const logPath = path.join(repoRoot, 'output/internal-name-2026-07-30T09-00-00/logs-128Mi-100m.log');
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
    await fs.writeFile(logPath, lines.join('\n') + '\n');
    const app = await buildTestApp();

    const firstPage = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/logs?memory=128Mi&cpu=100m&limit=4',
    });
    expect(firstPage.json()).toEqual({ lines: ['line 6', 'line 7', 'line 8', 'line 9'], hasMore: true, startIndex: 6 });

    const secondPage = await app.inject({
      method: 'GET',
      url: `/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/logs?memory=128Mi&cpu=100m&limit=4&before=${firstPage.json().startIndex}`,
    });
    expect(secondPage.json()).toEqual({ lines: ['line 2', 'line 3', 'line 4', 'line 5'], hasMore: true, startIndex: 2 });

    const thirdPage = await app.inject({
      method: 'GET',
      url: `/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/logs?memory=128Mi&cpu=100m&limit=4&before=${secondPage.json().startIndex}`,
    });
    expect(thirdPage.json()).toEqual({ lines: ['line 0', 'line 1'], hasMore: false, startIndex: 0 });
  });

  it('GET /apps/:name/outputs/:folder/logs: a page fetched with a fixed before stays stable even if the file grows in between (regression for the repeating-lines bug)', async () => {
    const logPath = path.join(repoRoot, 'output/internal-name-2026-07-30T09-00-00/logs-128Mi-100m.log');
    const initialLines = Array.from({ length: 10 }, (_, i) => `line ${i}`);
    await fs.writeFile(logPath, initialLines.join('\n') + '\n');
    const app = await buildTestApp();

    const firstPage = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/logs?memory=128Mi&cpu=100m&limit=5',
    });
    expect(firstPage.json()).toEqual({
      lines: ['line 5', 'line 6', 'line 7', 'line 8', 'line 9'],
      hasMore: true,
      startIndex: 5,
    });

    // The combo is still live-tailing: 3 more lines land before the user
    // scrolls up to load older history.
    const grownLines = [...initialLines, 'line 10', 'line 11', 'line 12'];
    await fs.writeFile(logPath, grownLines.join('\n') + '\n');

    const secondPage = await app.inject({
      method: 'GET',
      url: `/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/logs?memory=128Mi&cpu=100m&limit=5&before=${firstPage.json().startIndex}`,
    });
    // Must be exactly the 5 lines preceding "line 5" (lines 0-4), not a
    // slice shifted by the 3 newly-appended lines - which would duplicate
    // "line 5"-"line 7" that are already in firstPage.
    expect(secondPage.json()).toEqual({
      lines: ['line 0', 'line 1', 'line 2', 'line 3', 'line 4'],
      hasMore: false,
      startIndex: 0,
    });
  });

  it('GET /apps/:name/outputs/:folder/logs rejects an invalid before/limit', async () => {
    const app = await buildTestApp();
    const negativeBefore = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/logs?memory=128Mi&cpu=100m&before=-1',
    });
    expect(negativeBefore.statusCode).toBe(400);

    const zeroLimit = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/logs?memory=128Mi&cpu=100m&limit=0',
    });
    expect(zeroLimit.statusCode).toBe(400);

    const hugeLimit = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/logs?memory=128Mi&cpu=100m&limit=999999',
    });
    expect(hugeLimit.statusCode).toBe(400);
  });

  it('GET /apps/:name/outputs/:folder/logs rejects memory/cpu values containing path separators', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url:
        '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/logs?memory=' +
        encodeURIComponent('../../etc') +
        '&cpu=100m',
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /apps/:name/outputs/:folder/logs requires both memory and cpu query params', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/logs?memory=128Mi',
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /apps/:name/outputs/:folder/logs?kind=k6 returns the k6 job pod log, separate from the app log', async () => {
    const folderPath = path.join(repoRoot, 'output/internal-name-2026-07-30T09-00-00');
    await fs.writeFile(path.join(folderPath, 'logs-128Mi-100m.log'), 'app log content\n');
    await fs.writeFile(
      path.join(folderPath, 'k6-logs-128Mi-100m.log'),
      'level=error msg="request failed" status=0 error="dial: connection refused"\n'
    );
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/logs?memory=128Mi&cpu=100m&kind=k6',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      lines: ['level=error msg="request failed" status=0 error="dial: connection refused"'],
      hasMore: false,
      startIndex: 0,
    });
  });

  it('GET /apps/:name/outputs/:folder/logs rejects an invalid kind value', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: '/apps/myapp/outputs/internal-name-2026-07-30T09-00-00/logs?memory=128Mi&cpu=100m&kind=bogus',
    });
    expect(res.statusCode).toBe(400);
  });
});
