import { handleProductRequest } from '../../worker/modules/gateway';
import { createProviderRuntime } from '../../worker/providers/runtime';
import type { WorkerEnv } from '../../worker/runtime-types';

interface PagesContext {
  request: Request;
  env: WorkerEnv;
}

export async function onRequest(context: PagesContext): Promise<Response> {
  // Owner activated authentication after provisioning. An absent dashboard
  // variable on a later build must not silently expose the shared workspace.
  // Explicit "0" remains the owner's deliberate rollout rollback switch.
  const env = { ...context.env, PRIVATE_WORK_ENABLED: context.env.PRIVATE_WORK_ENABLED ?? "1" };
  const providerRuntime = createProviderRuntime(
    env,
    globalThis.fetch.bind(globalThis),
  );
  return handleProductRequest(context.request, env, providerRuntime);
}
