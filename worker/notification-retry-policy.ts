import type {
  NotificationJob,
  NotificationRetryPolicy,
} from './contracts';

export class FixedDelayNotificationRetryPolicy implements NotificationRetryPolicy {
  private readonly delaysMs: number[];

  constructor(delaysSeconds: number[]) {
    if (!delaysSeconds.length) {
      throw new Error('At least one retry delay is required.');
    }

    this.delaysMs = delaysSeconds.map((value) => {
      if (!Number.isFinite(value) || value < 0) {
        throw new Error('Retry delays must be finite non-negative seconds.');
      }
      return Math.round(value * 1000);
    });
  }

  nextAttempt(job: NotificationJob, _error: Error, now: Date): string | null {
    const attemptIndex = Math.max(0, job.attempts - 1);
    const delayMs = this.delaysMs[attemptIndex];
    if (delayMs == null) return null;
    return new Date(now.getTime() + delayMs).toISOString();
  }
}
