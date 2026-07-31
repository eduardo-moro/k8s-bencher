import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigFiles } from './lib/configFiles.js';
import { JobRunner } from './lib/jobRunner.js';
import { registerAppRoutes } from './routes/apps.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerOutputRoutes } from './routes/outputs.js';
import { registerCheckRoute } from './routes/check.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

export function buildServer(options?: { repoRoot?: string }): FastifyInstance {
  const repoRoot = options?.repoRoot ?? DEFAULT_REPO_ROOT;

  const app = Fastify({ logger: true });
  // Local, single-user dev tool (same trust model as running perftest.ps1
  // directly) - the frontend's dev server port isn't fixed, so reflect
  // whatever Origin the browser sends rather than hardcoding one.
  void app.register(cors, { origin: true });
  app.get('/health', async () => ({ ok: true }));

  const configFiles = new ConfigFiles(repoRoot);
  const jobRunner = new JobRunner(repoRoot);
  registerAppRoutes(app, configFiles);
  registerRunRoutes(app, jobRunner);
  registerOutputRoutes(app, configFiles, repoRoot);
  registerCheckRoute(app, repoRoot);

  return app;
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  const app = buildServer();
  const port = process.env.PORT ? Number(process.env.PORT) : 8026;
  app.listen({ port, host: '0.0.0.0' }).then(() => {
    app.log.info(`perftest-api listening on port ${port}`);
  });
}
