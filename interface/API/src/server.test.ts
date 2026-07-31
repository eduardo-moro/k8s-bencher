import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServer } from './server.js';

describe('GET /health', () => {
  it('returns ok', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe('static frontend serving', () => {
  it('does not error when no frontend-dist folder exists next to engineRoot', async () => {
    const app = buildServer();
    const res = await app.inject({ method: 'GET', url: '/some-spa-route' });
    // No static folder in this test's engineRoot, so this 404s through
    // Fastify's default not-found handler rather than crashing - proving
    // the static-serving registration is conditional, not a hard dependency.
    expect(res.statusCode).toBe(404);
  });

  describe('when frontend-dist exists', () => {
    let engineRoot: string;

    beforeEach(async () => {
      engineRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'perftest-api-static-test-'));
      await fs.mkdir(path.join(engineRoot, 'frontend-dist'), { recursive: true });
      await fs.writeFile(path.join(engineRoot, 'frontend-dist', 'index.html'), '<html>spa</html>');
    });

    afterEach(async () => {
      await fs.rm(engineRoot, { recursive: true, force: true });
    });

    it('serves index.html for an unmatched client-side route', async () => {
      // Regression test: this registration path (the actual @fastify/static
      // plugin loading) is only reachable when frontend-dist exists, which
      // is never true in any other test/dev-mode run in this project - a
      // real version mismatch between @fastify/static and the pinned
      // Fastify major went undetected until a packaged build exercised it
      // for the first time. This test exists so that class of bug fails
      // here instead of only in a built Electron package.
      const app = buildServer({ dataRoot: engineRoot, engineRoot });
      // A path with no registered API route at all (unlike e.g. /apps/:name,
      // which always matches its own handler regardless of whether the app
      // exists) - this is what a client-side-only frontend route looks like.
      const res = await app.inject({ method: 'GET', url: '/dashboard' });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('<html>spa</html>');
    });

    it('still returns a JSON 404 for a genuine unknown API route, not the SPA fallback', async () => {
      const app = buildServer({ dataRoot: engineRoot, engineRoot });
      const res = await app.inject({ method: 'GET', url: '/apps/nonexistent-app' });
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toContain('application/json');
    });
  });
});
