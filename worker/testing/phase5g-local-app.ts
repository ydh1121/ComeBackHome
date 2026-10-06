import { handleApiRequest } from '../api';
import type { ExecutionContextLike, WorkerEnv } from '../runtime-types';

export default {
  async fetch(request: Request, env: WorkerEnv, _ctx: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, env, null);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Local static asset binding is unavailable.', { status: 503 });
  },
};
