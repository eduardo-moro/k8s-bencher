import type { FastifyInstance } from 'fastify';
import { JobRunner } from '../lib/jobRunner.js';
import { statusForError } from '../lib/errors.js';

export function registerRunRoutes(app: FastifyInstance, jobRunner: JobRunner): void {
  app.post('/apps/:name/runs', async (req, reply) => {
    const { name } = req.params as { name: string };
    try {
      const job = await jobRunner.startRun(name);
      reply.code(202);
      return job;
    } catch (err) {
      reply.code(statusForError(err));
      return { error: (err as Error).message };
    }
  });

  app.get('/jobs/current', async (req, reply) => {
    const job = jobRunner.getCurrentJob();
    if (!job) {
      reply.code(404);
      return { error: 'No job has run yet' };
    }
    return job;
  });

  app.delete('/jobs/current', async () => {
    await jobRunner.cancelCurrentJob();
    return { cancelled: true };
  });
}
