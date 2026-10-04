import { handleApiRequest } from './api';
import { runScheduledTick } from './scheduler';
import type { ExecutionContextLike, ScheduledControllerLike, WorkerEnv } from './runtime-types';

export default {
  async fetch(request: Request, env: WorkerEnv, _ctx: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, env);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Static asset binding is not configured.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  },

  async scheduled(
    controller: ScheduledControllerLike,
    env: WorkerEnv,
    ctx: ExecutionContextLike,
  ): Promise<void> {
    ctx.waitUntil(runScheduledTick(env, controller.scheduledTime).then(() => undefined));
  },
};
