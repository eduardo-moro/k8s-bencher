import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServer } from '../server.js';

let repoRoot: string;

const sampleBody = {
  name: 'myapp',
  container: 'myapp',
  resources: { memory: ['128Mi'], cpu: ['100m'] },
  load: { vus: 10, stages: [{ duration: '10s', target: 10 }] },
  manifestContent: 'kind: Deployment\n',
  scriptContent: 'export default function(){}\n',
};

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'perftest-api-test-'));
  for (const dir of ['configs', 'manifests', 'loadtest', 'templates']) {
    await fs.mkdir(path.join(repoRoot, dir), { recursive: true });
  }
});

afterEach(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
});

describe('apps routes', () => {
  it('GET /apps returns [] with no apps yet', async () => {
    const app = buildServer({ dataRoot: repoRoot, engineRoot: repoRoot });
    const res = await app.inject({ method: 'GET', url: '/apps' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('POST /apps creates an app, GET /apps/:name returns it', async () => {
    const app = buildServer({ dataRoot: repoRoot, engineRoot: repoRoot });

    const createRes = await app.inject({ method: 'POST', url: '/apps', payload: sampleBody });
    expect(createRes.statusCode).toBe(201);

    const getRes = await app.inject({ method: 'GET', url: '/apps/myapp' });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toEqual(sampleBody);
  });

  it('POST /apps with a missing required field returns 400', async () => {
    const app = buildServer({ dataRoot: repoRoot, engineRoot: repoRoot });
    const { container, ...withoutContainer } = sampleBody;
    void container;
    const res = await app.inject({ method: 'POST', url: '/apps', payload: withoutContainer });
    expect(res.statusCode).toBe(400);
  });

  it('POST /apps twice with the same name returns 409', async () => {
    const app = buildServer({ dataRoot: repoRoot, engineRoot: repoRoot });
    await app.inject({ method: 'POST', url: '/apps', payload: sampleBody });
    const res = await app.inject({ method: 'POST', url: '/apps', payload: sampleBody });
    expect(res.statusCode).toBe(409);
  });

  it('GET /apps/:name for an unknown app returns 404', async () => {
    const app = buildServer({ dataRoot: repoRoot, engineRoot: repoRoot });
    const res = await app.inject({ method: 'GET', url: '/apps/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('PUT /apps/:name updates fields', async () => {
    const app = buildServer({ dataRoot: repoRoot, engineRoot: repoRoot });
    await app.inject({ method: 'POST', url: '/apps', payload: sampleBody });

    const res = await app.inject({
      method: 'PUT',
      url: '/apps/myapp',
      payload: { resources: { memory: ['256Mi'], cpu: ['250m'] } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().resources).toEqual({ memory: ['256Mi'], cpu: ['250m'] });
  });

  it('DELETE /apps/:name removes it', async () => {
    const app = buildServer({ dataRoot: repoRoot, engineRoot: repoRoot });
    await app.inject({ method: 'POST', url: '/apps', payload: sampleBody });

    const deleteRes = await app.inject({ method: 'DELETE', url: '/apps/myapp' });
    expect(deleteRes.statusCode).toBe(204);

    const getRes = await app.inject({ method: 'GET', url: '/apps/myapp' });
    expect(getRes.statusCode).toBe(404);
  });
});
