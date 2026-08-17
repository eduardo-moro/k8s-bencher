import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ConfigFiles } from '../lib/configFiles.js';
import { parseResultsCsv, type ResultRow } from '../lib/resultsCsv.js';
import { parseTopLog } from '../lib/memoryTimeseries.js';
import { parseRestartsLog } from '../lib/restartEvents.js';
import { parseK6ThroughputLog } from '../lib/k6Throughput.js';
import { paginateLog } from '../lib/logPagination.js';
import { buildPrometheusExport, type MemoryExportSeries } from '../lib/prometheusExport.js';
import { statusForError, NotFoundError, ValidationError } from '../lib/errors.js';

const DEFAULT_LOG_PAGE_LINES = 500;
const MAX_LOG_PAGE_LINES = 5000;

async function assertOwnedOutputFolder(
  configFiles: ConfigFiles,
  dataRoot: string,
  name: string,
  folder: string
): Promise<void> {
  if (folder.includes('..') || folder.includes('/') || folder.includes('\\')) {
    throw new ValidationError(`Invalid output folder name '${folder}'`);
  }

  const appDetail = await configFiles.getApp(name);
  if (!folder.startsWith(`${appDetail.name}-`)) {
    throw new NotFoundError(`Output folder '${folder}' does not belong to app '${name}'`);
  }

  const folderPath = path.join(dataRoot, 'output', folder);
  const stat = await fs.stat(folderPath).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new NotFoundError(`Output folder '${folder}' not found`);
  }
}

async function loadMemorySeries(folderPath: string, rows: ResultRow[]): Promise<MemoryExportSeries[]> {
  const series: MemoryExportSeries[] = [];
  for (const row of rows) {
    // Each combo's kubectl-top samples live in a sibling log named after its
    // tier; a combo whose rollout never became ready has no such log.
    const logText = await fs
      .readFile(path.join(folderPath, `top-${row.memory}-${row.cpu}.log`), 'utf8')
      .catch(() => null);
    if (!logText) continue;

    const points = parseTopLog(logText);
    if (!points.length) continue;

    series.push({ memory: row.memory, cpu: row.cpu, points });
  }
  return series;
}

export function registerOutputRoutes(app: FastifyInstance, configFiles: ConfigFiles, dataRoot: string): void {
  app.get('/apps/:name/outputs', async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      const appDetail = await configFiles.getApp(name);
      const outputRoot = path.join(dataRoot, 'output');
      let entries: string[];
      try {
        entries = await fs.readdir(outputRoot);
      } catch {
        entries = [];
      }

      const matches = entries.filter((e) => e.startsWith(`${appDetail.name}-`));
      const withStats = await Promise.all(
        matches.map(async (folder) => {
          const stat = await fs.stat(path.join(outputRoot, folder));
          const rowCount = await fs
            .readFile(path.join(outputRoot, folder, 'results.csv'), 'utf8')
            .then((csvText) => parseResultsCsv(csvText).length)
            .catch(() => 0);
          // Only present for runs kicked off through the web UI (jobRunner writes
          // it at process exit) - a bare `make full` from the terminal has no
          // wall-clock total to report, so estimateRunSeconds treats it as unknown.
          const totalDurationSeconds = await fs
            .readFile(path.join(outputRoot, folder, 'run-meta.json'), 'utf8')
            .then((text) => (JSON.parse(text) as { totalDurationSeconds?: number }).totalDurationSeconds)
            .catch(() => undefined);
          return { folder, timestamp: stat.birthtime.toISOString(), rowCount, totalDurationSeconds };
        })
      );
      withStats.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
      return withStats;
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });

  app.get('/apps/:name/outputs/:folder', async (req, reply) => {
    const { name, folder } = req.params as { name: string; folder: string };
    try {
      await assertOwnedOutputFolder(configFiles, dataRoot, name, folder);
      const csvText = await fs.readFile(path.join(dataRoot, 'output', folder, 'results.csv'), 'utf8');
      return { rows: parseResultsCsv(csvText) };
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });

  app.get('/apps/:name/outputs/:folder/memory', async (req, reply) => {
    const { name, folder } = req.params as { name: string; folder: string };
    try {
      await assertOwnedOutputFolder(configFiles, dataRoot, name, folder);
      const folderPath = path.join(dataRoot, 'output', folder);
      const csvText = await fs.readFile(path.join(folderPath, 'results.csv'), 'utf8');
      const rows = parseResultsCsv(csvText);
      const memorySeries = await loadMemorySeries(folderPath, rows);

      return { series: memorySeries.map((s) => ({ tier: `${s.memory}/${s.cpu}`, ...s })) };
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });

  app.get('/apps/:name/outputs/:folder/memory-series', async (req, reply) => {
    const { name, folder } = req.params as { name: string; folder: string };
    const { memory, cpu } = req.query as { memory?: string; cpu?: string };
    try {
      if (!memory || !cpu) {
        throw new ValidationError("Query params 'memory' and 'cpu' are required");
      }
      if (/[./\\]/.test(memory) || /[./\\]/.test(cpu)) {
        throw new ValidationError('Invalid memory/cpu value');
      }
      await assertOwnedOutputFolder(configFiles, dataRoot, name, folder);
      // Same top-<mem>-<cpu>.log the /memory endpoint reads via results.csv
      // rows, but looked up directly by filename for one combo - works for
      // a combo that's still running (no CSV row yet) as well as a finished
      // one, same as /logs.
      const logText = await fs
        .readFile(path.join(dataRoot, 'output', folder, `top-${memory}-${cpu}.log`), 'utf8')
        .catch(() => '');
      return { points: logText ? parseTopLog(logText) : [] };
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });

  app.get('/apps/:name/outputs/:folder/restarts', async (req, reply) => {
    const { name, folder } = req.params as { name: string; folder: string };
    const { memory, cpu } = req.query as { memory?: string; cpu?: string };
    try {
      if (!memory || !cpu) {
        throw new ValidationError("Query params 'memory' and 'cpu' are required");
      }
      if (/[./\\]/.test(memory) || /[./\\]/.test(cpu)) {
        throw new ValidationError('Invalid memory/cpu value');
      }
      await assertOwnedOutputFolder(configFiles, dataRoot, name, folder);
      const logText = await fs
        .readFile(path.join(dataRoot, 'output', folder, `restarts-${memory}-${cpu}.log`), 'utf8')
        .catch(() => '');
      return { events: logText ? parseRestartsLog(logText) : [] };
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });

  app.get('/apps/:name/outputs/:folder/throughput', async (req, reply) => {
    const { name, folder } = req.params as { name: string; folder: string };
    const { memory, cpu } = req.query as { memory?: string; cpu?: string };
    try {
      if (!memory || !cpu) {
        throw new ValidationError("Query params 'memory' and 'cpu' are required");
      }
      if (/[./\\]/.test(memory) || /[./\\]/.test(cpu)) {
        throw new ValidationError('Invalid memory/cpu value');
      }
      await assertOwnedOutputFolder(configFiles, dataRoot, name, folder);
      // k6's raw --out json metrics stream, not the human progress log -
      // counts genuinely successful requests (http_req_failed=0) rather than
      // "iterations completed", which spikes falsely when requests fail fast.
      const logText = await fs
        .readFile(path.join(dataRoot, 'output', folder, `k6-metrics-${memory}-${cpu}.ndjson`), 'utf8')
        .catch(() => '');
      return { points: logText ? parseK6ThroughputLog(logText) : [] };
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });

  app.get('/apps/:name/outputs/:folder/prometheus', async (req, reply) => {
    const { name, folder } = req.params as { name: string; folder: string };
    try {
      await assertOwnedOutputFolder(configFiles, dataRoot, name, folder);
      const folderPath = path.join(dataRoot, 'output', folder);
      const csvText = await fs.readFile(path.join(folderPath, 'results.csv'), 'utf8');
      const rows = parseResultsCsv(csvText);
      const memorySeries = await loadMemorySeries(folderPath, rows);

      reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      return buildPrometheusExport(name, folder, rows, memorySeries);
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });

  app.get('/apps/:name/outputs/:folder/logs', async (req, reply) => {
    const { name, folder } = req.params as { name: string; folder: string };
    const { memory, cpu, kind, before, limit } = req.query as {
      memory?: string;
      cpu?: string;
      kind?: string;
      before?: string;
      limit?: string;
    };
    try {
      if (!memory || !cpu) {
        throw new ValidationError("Query params 'memory' and 'cpu' are required");
      }
      if (/[./\\]/.test(memory) || /[./\\]/.test(cpu)) {
        throw new ValidationError('Invalid memory/cpu value');
      }
      if (kind !== undefined && kind !== 'app' && kind !== 'k6') {
        throw new ValidationError("Query param 'kind' must be 'app' or 'k6'");
      }
      // Omitted means "the live tail" - defaulting it to 0 would instead mean
      // "the 0 lines before absolute index 0", i.e. always an empty page.
      const beforeLines = before !== undefined ? Number(before) : undefined;
      const limitLines = limit !== undefined ? Number(limit) : DEFAULT_LOG_PAGE_LINES;
      if (beforeLines !== undefined && (!Number.isInteger(beforeLines) || beforeLines < 0)) {
        throw new ValidationError("Query param 'before' must be a non-negative integer");
      }
      if (!Number.isInteger(limitLines) || limitLines <= 0 || limitLines > MAX_LOG_PAGE_LINES) {
        throw new ValidationError(`Query param 'limit' must be a positive integer up to ${MAX_LOG_PAGE_LINES}`);
      }

      await assertOwnedOutputFolder(configFiles, dataRoot, name, folder);
      // Same files Invoke-PerftestMatrix's background `kubectl logs -f` jobs
      // write to, live - reading them works identically whether that
      // combo's run just finished or is still in progress right now.
      // 'app' is the container under test; 'k6' is the load-test pod's own
      // output (HTTP errors, check failures) - separate processes/pods.
      // Paginated (tail-first, walking backwards) rather than returning the
      // whole file: a long-running combo's app log can reach multiple MB of
      // verbose framework logging, and shipping/rendering all of it at once
      // is what was making the page lag.
      const filename = kind === 'k6' ? `k6-logs-${memory}-${cpu}.log` : `logs-${memory}-${cpu}.log`;
      const logText = await fs
        .readFile(path.join(dataRoot, 'output', folder, filename), 'utf8')
        .catch(() => '');
      return paginateLog(logText, beforeLines, limitLines);
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });

  app.get('/apps/:name/outputs/:folder/raw', async (req, reply) => {
    const { name, folder } = req.params as { name: string; folder: string };
    try {
      await assertOwnedOutputFolder(configFiles, dataRoot, name, folder);
      const csvText = await fs.readFile(path.join(dataRoot, 'output', folder, 'results.csv'), 'utf8');
      reply.header('Content-Type', 'text/csv');
      return csvText;
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });
}
