import Fastify, { FastifyInstance } from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

export function buildServer(options?: { repoRoot?: string }): FastifyInstance {
  const repoRoot = options?.repoRoot ?? DEFAULT_REPO_ROOT;

  const app = Fastify({ logger: true });
  app.get('/health', async () => ({ ok: true }));

  // Later tasks register more routes here, using `repoRoot`.
  void repoRoot;

  return app;
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  const app = buildServer();
  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  app.listen({ port, host: '0.0.0.0' }).then(() => {
    app.log.info(`perftest-api listening on port ${port}`);
  });
}
