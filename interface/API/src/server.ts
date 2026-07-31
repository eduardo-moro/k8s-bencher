import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
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

export function buildServer(options?: { dataRoot?: string; engineRoot?: string }): FastifyInstance {
  const dataRoot = options?.dataRoot ?? DEFAULT_REPO_ROOT;
  const engineRoot = options?.engineRoot ?? DEFAULT_REPO_ROOT;

  const app = Fastify({ logger: true });
  // Local, single-user dev tool (same trust model as running perftest.ps1
  // directly) - the frontend's dev server port isn't fixed, so reflect
  // whatever Origin the browser sends rather than hardcoding one.
  void app.register(cors, { origin: true });
  app.get('/health', async () => ({ ok: true }));

  const configFiles = new ConfigFiles(dataRoot, engineRoot);
  const jobRunner = new JobRunner(dataRoot, engineRoot);
  registerAppRoutes(app, configFiles);
  registerRunRoutes(app, jobRunner);
  registerOutputRoutes(app, configFiles, dataRoot);
  registerCheckRoute(app, engineRoot);

  // Packaged (Electron) builds place the frontend's static SPA output at
  // <engineRoot>/frontend-dist (see Task 7); plain git-checkout dev mode
  // never has this folder, so this registration is a silent no-op there -
  // `make interface`/`npm run dev` always talk to the frontend's own dev
  // server instead, never to this route.
  const frontendDist = path.join(engineRoot, 'frontend-dist');
  if (existsSync(frontendDist)) {
    void app.register(fastifyStatic, { root: frontendDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/apps') && !req.url.startsWith('/jobs') &&
          !req.url.startsWith('/check') && !req.url.startsWith('/health') && !req.url.startsWith('/templates')) {
        return reply.sendFile('index.html');
      }
      reply.code(404).send({ error: 'Not Found' });
    });
  }

  return app;
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  const app = buildServer({
    dataRoot: process.env.DATA_ROOT ?? DEFAULT_REPO_ROOT,
    engineRoot: process.env.ENGINE_ROOT ?? DEFAULT_REPO_ROOT,
  });
  const port = process.env.PORT ? Number(process.env.PORT) : 8026;
  app.listen({ port, host: '0.0.0.0' }).then(() => {
    app.log.info(`perftest-api listening on port ${port}`);
  });
}
