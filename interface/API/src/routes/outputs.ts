import type { FastifyInstance } from 'fastify';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ConfigFiles } from '../lib/configFiles.js';
import { parseResultsCsv } from '../lib/resultsCsv.js';
import { statusForError, NotFoundError, ValidationError } from '../lib/errors.js';

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
          return { folder, timestamp: stat.birthtime.toISOString() };
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
