import type { FastifyInstance } from 'fastify';
import { ConfigFiles, AppDetail } from '../lib/configFiles.js';
import { statusForError } from '../lib/errors.js';

const stageSchema = {
  type: 'object',
  required: ['duration', 'target'],
  properties: {
    duration: { type: 'string' },
    target: { type: 'number' },
  },
};

const appBodySchema = {
  type: 'object',
  required: ['name', 'container', 'resources', 'load', 'manifestContent', 'scriptContent'],
  properties: {
    name: { type: 'string', minLength: 1 },
    container: { type: 'string', minLength: 1 },
    resources: {
      type: 'object',
      required: ['memory', 'cpu'],
      properties: {
        memory: { type: 'array', items: { type: 'string' }, minItems: 1 },
        cpu: { type: 'array', items: { type: 'string' }, minItems: 1 },
      },
    },
    load: {
      type: 'object',
      required: ['vus', 'stages'],
      properties: {
        vus: { type: 'number' },
        stages: { type: 'array', items: stageSchema, minItems: 1 },
      },
    },
    manifestContent: { type: 'string' },
    scriptContent: { type: 'string' },
  },
};

export function registerAppRoutes(app: FastifyInstance, configFiles: ConfigFiles): void {
  app.get('/apps', async () => configFiles.listApps());

  app.get('/apps/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      return await configFiles.getApp(name);
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });

  app.post('/apps', { schema: { body: appBodySchema } }, async (req, reply) => {
    const detail = req.body as AppDetail;
    try {
      await configFiles.createApp(detail);
      reply.code(201);
      return await configFiles.getApp(detail.name);
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });

  app.put('/apps/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    const partial = req.body as Partial<AppDetail>;
    try {
      return await configFiles.updateApp(name, partial);
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });

  app.delete('/apps/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      await configFiles.deleteApp(name);
      reply.code(204);
      return null;
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });

  app.get('/templates/example', async () => configFiles.getTemplateExample());
}
