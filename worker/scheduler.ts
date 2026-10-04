import type { WorkerEnv } from './runtime-types';

export interface SchedulerRunResult {
  status: 'disabled' | 'not-configured';
  scheduledAt: string;
}

export async function runScheduledTick(env: WorkerEnv, scheduledTime: number): Promise<SchedulerRunResult> {
  const scheduledAt = new Date(scheduledTime).toISOString();

  if (env.PUSH_DELIVERY_ENABLED !== '1') {
    return { status: 'disabled', scheduledAt };
  }

  throw new Error('Push delivery gateway is not configured yet.');
}
