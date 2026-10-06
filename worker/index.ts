import type { ExecutionContextLike, ScheduledControllerLike, SchedulerWorkerEnv } from './runtime-types';

const CANONICAL_PAGES_ORIGIN = 'https://come-back-home.pages.dev';

export async function invokePagesScheduler(env: SchedulerWorkerEnv, scheduledTime: number): Promise<void> {
  const origin = (env.PAGES_ORIGIN ?? '').trim().replace(/\/$/, '');
  const token = (env.SCHEDULER_INVOKE_TOKEN ?? '').trim();
  if (origin !== CANONICAL_PAGES_ORIGIN) throw new Error('Scheduler target must be canonical Pages.');
  if (!token) throw new Error('Scheduler authentication is unavailable.');
  const response = await fetch(origin + '/api/internal/scheduler-tick', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ scheduledTime }),
  });
  if (!response.ok) throw new Error('Canonical Pages scheduler tick failed with HTTP ' + response.status + '.');
}

export default {
  async scheduled(controller: ScheduledControllerLike, env: SchedulerWorkerEnv, ctx: ExecutionContextLike): Promise<void> {
    ctx.waitUntil(invokePagesScheduler(env, controller.scheduledTime));
  },
};
