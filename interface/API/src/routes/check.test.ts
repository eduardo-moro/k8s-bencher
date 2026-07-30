import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerCheckRoute } from './check.js';

describe('GET /check', () => {
  it('returns the injected check result', async () => {
    const app = Fastify({ logger: false });
    registerCheckRoute(app, '/fake/repo', {
      runCheck: async () => ({ ready: true, output: '[  OK  ]    kind\n' }),
    });

    const res = await app.inject({ method: 'GET', url: '/check' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ready: true, output: '[  OK  ]    kind\n' });
  });

  it('propagates ready:false when the check fails', async () => {
    const app = Fastify({ logger: false });
    registerCheckRoute(app, '/fake/repo', {
      runCheck: async () => ({ ready: false, output: '[ FAIL ] docker - ...\n' }),
    });

    const res = await app.inject({ method: 'GET', url: '/check' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ready).toBe(false);
  });
});
