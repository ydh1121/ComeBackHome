import { handleApiRequest } from '../api';
import type { ExecutionContextLike, WorkerEnv } from '../runtime-types';

export default {
  async fetch(request: Request, env: WorkerEnv, _ctx: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);
    // Test-only readback: this module is selected solely by wrangler.local.jsonc.
    // It never exists in canonical Pages/server runtime.
    if (url.pathname === '/api/__phase-g-state' && request.method === 'GET') {
      if (request.headers.get('x-phase-g-test-token') !== 'local-integration-only') {
        return new Response('Forbidden', { status: 403 });
      }
      const id = url.searchParams.get('personId') ?? '';
      const jobs = await env.DB.prepare(
        'SELECT id, person_id, job_type, dedupe_key, status FROM notification_jobs WHERE person_id = ?1 ORDER BY dedupe_key',
      ).bind(id).all();
      const receipts = await env.DB.prepare(
        'SELECT event_id, person_id, event_type, accepted_at FROM presence_events WHERE person_id = ?1 ORDER BY event_id',
      ).bind(id).all();
      const state = await env.DB.prepare(
        'SELECT person_id, work_date, left_work_at, arrived_home_at FROM presence_state WHERE person_id = ?1 LIMIT 1',
      ).bind(id).first();
      return Response.json({ jobs: jobs.results, receipts: receipts.results, state });
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, env, null);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Local static asset binding is unavailable.', { status: 503 });
  },
};
