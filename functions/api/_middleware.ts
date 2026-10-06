import { handleApiRequest } from '../../worker/api';
import { createProviderRuntime } from '../../worker/providers/runtime';
import type { WorkerEnv } from '../../worker/runtime-types';

interface PagesContext {
  request: Request;
  env: WorkerEnv;
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const providerRuntime = createProviderRuntime(
    context.env,
    globalThis.fetch.bind(globalThis),
  );
  return handleApiRequest(context.request, context.env, providerRuntime);
}
