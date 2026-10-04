import type { WebPushSubscriptionRecord } from '../../src/domain/models';
import type { StoredPushSubscription, SubscriptionStore } from '../contracts';
import type { D1DatabaseLike } from '../runtime-types';
import { asBoolean, utcNow } from './d1-helpers';

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  expiration_time: number | null;
  active: number;
  created_at: string;
  updated_at: string;
}

function toSubscription(row: SubscriptionRow): StoredPushSubscription {
  return {
    id: row.id,
    endpoint: row.endpoint,
    expirationTime: row.expiration_time,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth,
    },
    active: asBoolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class D1SubscriptionStore implements SubscriptionStore {
  constructor(private readonly db: D1DatabaseLike) {}

  async upsert(subscription: WebPushSubscriptionRecord): Promise<StoredPushSubscription> {
    const now = utcNow();
    const existing = await this.db.prepare(
      'SELECT id FROM push_subscriptions WHERE endpoint = ?1 LIMIT 1',
    ).bind(subscription.endpoint).first<{ id: string }>();

    const id = existing?.id ?? crypto.randomUUID();

    await this.db.prepare(
      `INSERT INTO push_subscriptions (
        id, endpoint, p256dh, auth, expiration_time, active, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)
      ON CONFLICT(endpoint) DO UPDATE SET
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        expiration_time = excluded.expiration_time,
        active = 1,
        updated_at = excluded.updated_at`,
    ).bind(
      id,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      subscription.expirationTime,
      now,
    ).run();

    const row = await this.db.prepare(
      `SELECT id, endpoint, p256dh, auth, expiration_time, active, created_at, updated_at
      FROM push_subscriptions
      WHERE endpoint = ?1
      LIMIT 1`,
    ).bind(subscription.endpoint).first<SubscriptionRow>();

    if (!row) throw new Error('Push subscription was not stored.');
    return toSubscription(row);
  }

  async deactivateByEndpoint(endpoint: string): Promise<void> {
    await this.db.prepare(
      'UPDATE push_subscriptions SET active = 0, updated_at = ?2 WHERE endpoint = ?1',
    ).bind(endpoint, utcNow()).run();
  }

  async listActive(): Promise<StoredPushSubscription[]> {
    const result = await this.db.prepare(
      `SELECT id, endpoint, p256dh, auth, expiration_time, active, created_at, updated_at
      FROM push_subscriptions
      WHERE active = 1
      ORDER BY created_at ASC, id ASC`,
    ).all<SubscriptionRow>();

    return result.results.map(toSubscription);
  }
}
