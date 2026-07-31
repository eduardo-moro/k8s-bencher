import { describe, it, expect } from 'vitest';
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
});
