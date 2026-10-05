import { handleApiRequest } from './api';
import { runScheduledNotificationCycle } from './scheduler';
import { createProviderRuntime } from './providers/runtime';
import type { ExecutionContextLike, ScheduledControllerLike, WorkerEnv } from './runtime-types';

export default {
  async fetch(request: Request, env: WorkerEnv, _ctx: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const providerRuntime = createProviderRuntime(env, globalThis.fetch.bind(globalThis));
      return handleApiRequest(request, env, providerRuntime);
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
    ctx.waitUntil(runScheduledNotificationCycle(env, controller.scheduledTime).then(() => undefined));
  },
};
